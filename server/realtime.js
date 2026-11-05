// Tiempo real con socket.io: tablero, fichas, escena, iniciativa, chat y tiradas.
const crypto = require('crypto');
const { db, save } = require('./db');
const auth = require('./auth');
const camp = require('./campaigns');
const dice = require('./dice');
const { log, countEvent } = require('./logger');

const TOKEN_LIMIT = 200;
const MAP_LIMIT = 60;
const TRACK_LIMIT = 80;
const TRACK_KINDS = ['musica', 'ambiente', 'efecto'];
const URL_RE = /^\/(uploads|assets)\/[\w./-]+$/;

function safeUrl(v) {
  return typeof v === 'string' && URL_RE.test(v) && !v.includes('..') ? v : null;
}

/** "Goblin", "Goblin 2", "Goblin 3"… para poder distinguir fichas repetidas. */
function uniqueName(tokens, base) {
  const taken = new Set(tokens.map((t) => t.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** Quita una entrada de la iniciativa manteniendo el turno en quien estaba actuando. */
function withoutEntry(ini, tokenId) {
  const idx = ini.entries.findIndex((e) => e.tokenId === tokenId);
  if (idx === -1) return ini;
  const entries = ini.entries.filter((_, i) => i !== idx);
  const turn = idx < ini.turn ? ini.turn - 1 : ini.turn;
  return { ...ini, entries, turn: Math.max(0, Math.min(turn, entries.length - 1)) };
}

function setupRealtime(io) {
  // Quién está conectado en cada campaña: campaignId -> Map(socketId -> userId)
  const presence = new Map();

  io.use((socket, next) => {
    const user = auth.userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('Sesión no válida'));
    socket.data.userId = user.id;
    next();
  });

  // Para el monitor del admin: quién está conectado en cada campaña.
  io.daPresence = () => [...presence.entries()].map(([id, sockets]) => {
    const c = camp.findCampaign(id);
    const names = [...new Set(sockets.values())].map((uid) => db().users.find((u) => u.id === uid)?.displayName || '?');
    return { campaign: c?.name || id, users: names, sockets: sockets.size };
  }).filter((p) => p.sockets > 0);

  function onlineIds(campaignId) {
    return [...new Set((presence.get(campaignId) || new Map()).values())];
  }

  /** Emite a cada socket de la sala su propia vista (respeta fichas ocultas). */
  function emitPerViewer(campaign, event, build) {
    for (const s of io.sockets.adapter.rooms.get(campaign.id) || []) {
      const sock = io.sockets.sockets.get(s);
      const user = sock && db().users.find((u) => u.id === sock.data.userId);
      if (user) sock.emit(event, build(user));
    }
  }

  function emitTokens(campaign) {
    emitPerViewer(campaign, 'tokens', (u) => (camp.isDM(u, campaign) ? campaign.tokens : campaign.tokens.filter((t) => !t.hidden)));
  }

  function emitLog(campaign, entry) {
    emitPerViewer(campaign, 'log', (u) => (camp.logVisibleTo(u, campaign, entry) ? entry : null));
  }

  io.on('connection', (socket) => {
    const me = () => db().users.find((u) => u.id === socket.data.userId);
    let campaignId = null;

    /** Ejecuta un handler con la campaña actual; avisa al cliente si falla. */
    const on = (event, { dmOnly = false } = {}, fn) => {
      socket.on(event, (payload = {}, ack) => {
        countEvent(event);
        try {
          const user = me();
          const c = campaignId && camp.findCampaign(campaignId);
          if (!user || !c || !camp.canAccess(user, c)) throw new Error('No estás en una campaña');
          if (dmOnly && !camp.isDM(user, c)) throw new Error('Solo el DM puede hacer esto');
          fn(c, user, payload);
          if (typeof ack === 'function') ack({ ok: true });
        } catch (err) {
          log.warn('evento rechazado', { event, user: me()?.username, error: err.message });
          if (typeof ack === 'function') ack({ error: err.message });
          else socket.emit('toast', { kind: 'error', text: err.message });
        }
      });
    };

    socket.on('join', ({ id } = {}, ack) => {
      const user = me();
      const c = camp.findCampaign(id);
      if (!user || !c || !camp.canAccess(user, c)) return ack?.({ error: 'Campaña no encontrada' });
      if (campaignId) leave();
      campaignId = c.id;
      socket.join(c.id);
      if (!presence.has(c.id)) presence.set(c.id, new Map());
      presence.get(c.id).set(socket.id, user.id);
      io.to(c.id).emit('presence', onlineIds(c.id));
      log.info('entra a la mesa', { user: user.username, campaign: c.name, ip: socket.handshake.address });
      ack?.({ state: camp.viewFor(user, c), online: onlineIds(c.id), serverNow: Date.now() });
    });

    function leave() {
      if (!campaignId) return;
      log.info('sale de la mesa', { user: me()?.username, campaign: camp.findCampaign(campaignId)?.name });
      presence.get(campaignId)?.delete(socket.id);
      socket.leave(campaignId);
      io.to(campaignId).emit('presence', onlineIds(campaignId));
      campaignId = null;
    }
    socket.on('leave', leave);
    socket.on('disconnect', leave);

    socket.on('refresh', (_, ack) => {
      const user = me();
      const c = campaignId && camp.findCampaign(campaignId);
      if (user && c && camp.canAccess(user, c)) ack?.({ state: camp.viewFor(user, c), online: onlineIds(c.id), serverNow: Date.now() });
    });

    // ---------- mapas y escena (DM) ----------
    on('map:add', { dmOnly: true }, (c, user, { name, url }) => {
      const clean = safeUrl(url);
      if (!clean) throw new Error('Imagen inválida');
      if (c.maps.length >= MAP_LIMIT) throw new Error('Demasiados mapas');
      const map = { id: crypto.randomUUID(), name: camp.cleanText(name, 50, 'Mapa').trim() || 'Mapa', url: clean };
      c.maps = [...c.maps, map];
      if (!c.scene.mapId) c.scene = { ...c.scene, mapId: map.id };
      save();
      io.to(c.id).emit('maps', c.maps);
      io.to(c.id).emit('scene', c.scene);
    });

    on('map:remove', { dmOnly: true }, (c, user, { id }) => {
      c.maps = c.maps.filter((m) => m.id !== id);
      if (c.scene.mapId === id) c.scene = { ...c.scene, mapId: c.maps[0]?.id || null };
      save();
      io.to(c.id).emit('maps', c.maps);
      io.to(c.id).emit('scene', c.scene);
    });

    on('scene:set', { dmOnly: true }, (c, user, p) => {
      c.scene = {
        mapId: p.mapId !== undefined && (p.mapId === null || c.maps.some((m) => m.id === p.mapId)) ? p.mapId : c.scene.mapId,
        gridSize: p.gridSize !== undefined ? camp.clampInt(p.gridSize, 20, 300, c.scene.gridSize) : c.scene.gridSize,
        showGrid: typeof p.showGrid === 'boolean' ? p.showGrid : c.scene.showGrid,
      };
      save();
      io.to(c.id).emit('scene', c.scene);
    });

    // ---------- fichas ----------
    on('token:add', {}, (c, user, p) => {
      const dm = camp.isDM(user, c);
      const character = p.characterId && db().characters.find((ch) => ch.id === p.characterId && ch.campaignId === c.id);
      if (!dm && (!character || character.ownerId !== user.id)) throw new Error('Solo puedes colocar tu propio personaje');
      if (c.tokens.length >= TOKEN_LIMIT) throw new Error('Demasiadas fichas en el tablero');
      const img = safeUrl(p.img) || safeUrl(character?.portrait) || '/assets/demo/token-goblin.svg';
      const baseName = camp.cleanText(p.name, 40, character?.name || 'Ficha').trim() || 'Ficha';
      const token = {
        id: crypto.randomUUID(),
        name: character ? baseName : uniqueName(c.tokens, baseName),
        img,
        x: camp.clampInt(p.x, -5000, 20000, 0),
        y: camp.clampInt(p.y, -5000, 20000, 0),
        size: camp.clampInt(p.size, 1, 6, 1),
        ownerId: character ? character.ownerId : (p.ownerId && c.playerIds.includes(p.ownerId) ? p.ownerId : null),
        characterId: character ? character.id : null,
        hp: camp.clampInt(p.hp, -99, 9999, 10),
        maxHp: camp.clampInt(p.maxHp, 1, 9999, 10),
        hidden: dm && p.hidden === true,
        conditions: [],
      };
      c.tokens = [...c.tokens, token];
      save();
      emitTokens(c);
    });

    on('token:update', {}, (c, user, p) => {
      const dm = camp.isDM(user, c);
      const prev = c.tokens.find((t) => t.id === p.id);
      if (!prev) throw new Error('Ficha no encontrada');
      if (!dm && prev.ownerId !== user.id) throw new Error('Esa ficha no es tuya');
      const next = {
        ...prev,
        x: p.x !== undefined ? camp.clampInt(p.x, -5000, 20000, prev.x) : prev.x,
        y: p.y !== undefined ? camp.clampInt(p.y, -5000, 20000, prev.y) : prev.y,
        hp: p.hp !== undefined ? camp.clampInt(p.hp, 0, 9999, prev.hp) : prev.hp,
        conditions: Array.isArray(p.conditions) ? p.conditions.slice(0, 12).map((x) => camp.cleanText(x, 20)).filter(Boolean) : prev.conditions,
      };
      if (dm) {
        Object.assign(next, {
          name: p.name !== undefined ? camp.cleanText(p.name, 40, prev.name).trim() || prev.name : prev.name,
          size: p.size !== undefined ? camp.clampInt(p.size, 1, 6, prev.size) : prev.size,
          maxHp: p.maxHp !== undefined ? camp.clampInt(p.maxHp, 1, 9999, prev.maxHp) : prev.maxHp,
          hidden: typeof p.hidden === 'boolean' ? p.hidden : prev.hidden,
          img: p.img !== undefined ? safeUrl(p.img) || prev.img : prev.img,
        });
      }
      c.tokens = c.tokens.map((t) => (t.id === prev.id ? next : t));
      save();
      // Movimiento: se manda solo el delta para que sea fluido; resto: lista entera.
      if (p.x !== undefined && Object.keys(p).length <= 3 && !next.hidden) {
        socket.to(c.id).emit('token:moved', { id: next.id, x: next.x, y: next.y });
      } else {
        emitTokens(c);
      }
      if (prev.hidden !== next.hidden || next.hidden) emitTokens(c);
    });

    on('token:remove', {}, (c, user, { id }) => {
      const prev = c.tokens.find((t) => t.id === id);
      if (!prev) return;
      if (!camp.isDM(user, c) && prev.ownerId !== user.id) throw new Error('Esa ficha no es tuya');
      c.tokens = c.tokens.filter((t) => t.id !== id);
      c.initiative = withoutEntry(c.initiative, id);
      save();
      emitTokens(c);
      io.to(c.id).emit('initiative', c.initiative);
    });

    on('ping', {}, (c, user, { x, y }) => {
      io.to(c.id).emit('ping', { x: Number(x) || 0, y: Number(y) || 0, name: user.displayName, userId: user.id });
    });

    // ---------- iniciativa ----------
    on('initiative:set', { dmOnly: true }, (c, user, { entries, turn, round }) => {
      const clean = (Array.isArray(entries) ? entries : []).slice(0, 40).map((e) => ({
        id: typeof e.id === 'string' ? e.id.slice(0, 40) : crypto.randomUUID(),
        tokenId: typeof e.tokenId === 'string' ? e.tokenId : null,
        name: camp.cleanText(e.name, 40, 'Combatiente'),
        value: camp.clampInt(e.value, -10, 60, 0),
        img: safeUrl(e.img),
      }));
      c.initiative = {
        entries: clean,
        turn: camp.clampInt(turn, 0, Math.max(0, clean.length - 1), 0),
        round: camp.clampInt(round, 1, 999, c.initiative.round || 1),
      };
      save();
      io.to(c.id).emit('initiative', c.initiative);
    });

    // ---------- música y sonido (DM) ----------
    const emitMusic = (c) => io.to(c.id).emit('music', { music: c.music, serverNow: Date.now() });

    on('track:add', { dmOnly: true }, (c, user, { name, url, kind }) => {
      const clean = safeUrl(url);
      if (!clean) throw new Error('Audio inválido');
      if ((c.tracks || []).length >= TRACK_LIMIT) throw new Error('Demasiadas pistas');
      const track = {
        id: crypto.randomUUID(),
        name: camp.cleanText(name, 50, 'Pista').trim() || 'Pista',
        url: clean,
        kind: TRACK_KINDS.includes(kind) ? kind : 'musica',
      };
      c.tracks = [...(c.tracks || []), track];
      save();
      io.to(c.id).emit('tracks', c.tracks);
    });

    on('track:remove', { dmOnly: true }, (c, user, { id }) => {
      c.tracks = (c.tracks || []).filter((t) => t.id !== id);
      if (c.music?.trackId === id) c.music = { ...c.music, trackId: null, playing: false, offset: 0 };
      save();
      io.to(c.id).emit('tracks', c.tracks);
      emitMusic(c);
    });

    // Estado compartido: todos calculan la posición con startedAt (reloj del servidor) + offset.
    on('music:set', { dmOnly: true }, (c, user, p) => {
      const prev = c.music || { trackId: null, playing: false, startedAt: 0, offset: 0, loop: true, volume: 0.7 };
      const now = Date.now();
      const position = prev.playing ? prev.offset + (now - prev.startedAt) / 1000 : prev.offset;
      let next = { ...prev };
      if (p.action === 'play') {
        const trackId = p.trackId || prev.trackId;
        if (!(c.tracks || []).some((t) => t.id === trackId)) throw new Error('Pista no encontrada');
        const resume = trackId === prev.trackId && !prev.playing;
        next = { ...next, trackId, playing: true, startedAt: now, offset: resume ? position : 0 };
      } else if (p.action === 'pause') {
        next = { ...next, playing: false, offset: position };
      } else if (p.action === 'stop') {
        next = { ...next, playing: false, offset: 0 };
      }
      if (typeof p.loop === 'boolean') next.loop = p.loop;
      if (p.volume !== undefined) next.volume = Math.min(1, Math.max(0, Number(p.volume) || 0));
      c.music = next;
      save();
      if (p.action) log.info('música', { campaign: c.name, action: p.action, track: (c.tracks || []).find((t) => t.id === next.trackId)?.name });
      emitMusic(c);
    });

    on('sfx', { dmOnly: true }, (c, user, { id }) => {
      const track = (c.tracks || []).find((t) => t.id === id);
      if (!track) throw new Error('Efecto no encontrado');
      io.to(c.id).emit('sfx', { url: track.url, name: track.name });
    });

    // El DM pide una tirada a un jugador (o a todos) con CD, como en las pruebas de habilidad.
    on('roll:request', { dmOnly: true }, (c, user, p) => {
      const request = {
        id: crypto.randomUUID(),
        label: camp.cleanText(p.label, 60, 'Prueba').trim() || 'Prueba',
        ability: camp.ABILITIES.includes(p.ability) ? p.ability : null,
        dc: p.dc ? camp.clampInt(p.dc, 1, 40, null) : null,
        hidden: p.hidden === true,
      };
      const targets = p.userId ? [p.userId] : c.playerIds;
      for (const sid of io.sockets.adapter.rooms.get(c.id) || []) {
        const sock = io.sockets.sockets.get(sid);
        if (sock && targets.includes(sock.data.userId)) sock.emit('roll:request', request);
      }
    });

    // ---------- chat y tiradas ----------
    on('chat', {}, (c, user, { text }) => {
      const msg = camp.cleanText(text, 1000).trim();
      if (!msg) return;
      const entry = camp.addLog(c, { type: 'chat', userId: user.id, name: user.displayName, text: msg });
      io.to(c.id).emit('log', entry);
    });

    on('roll', {}, (c, user, p) => {
      const dm = camp.isDM(user, c);
      let expr = String(p.expr || '1d20');
      const adv = p.mode === 'adv' || p.mode === 'dis';
      if (adv) expr = expr.replace(/^1?d20/i, p.mode === 'adv' ? '2d20kh1' : '2d20kl1');
      const result = dice.roll(expr);
      const natural = dice.naturalD20(result);
      const dc = p.dc !== undefined && p.dc !== null && p.dc !== '' ? camp.clampInt(p.dc, 1, 40, null) : null;
      const entry = camp.addLog(c, {
        type: 'roll',
        userId: user.id,
        name: user.displayName,
        label: camp.cleanText(p.label, 60, '').trim(),
        mode: adv ? p.mode : null,
        dc,
        hidden: p.hidden === true,
        result,
        natural,
        success: dc !== null ? (natural === 20 ? true : natural === 1 ? false : result.total >= dc) : null,
        byDM: dm,
      });
      emitLog(c, entry);
    });
  });
}

module.exports = { setupRealtime, uniqueName, withoutEntry };
