// Tiempo real con socket.io: conexión, presencia, música, chat y tiradas. El tablero va en realtime-board.js.
const crypto = require('crypto');
const { db, save } = require('./db');
const auth = require('./auth');
const camp = require('./campaigns');
const dice = require('./dice');
const sc = require('./scenes');
const { log, countEvent } = require('./logger');
const { registerBoard, uniqueName, withoutEntry, safeUrl } = require('./realtime-board');
const { registerObjects } = require('./realtime-objects');
const { registerInventory } = require('./realtime-inventory');
const { registerAttack } = require('./realtime-attack');

const TRACK_LIMIT = 80;
const TRACK_KINDS = ['musica', 'ambiente', 'efecto'];
const REQUEST_TTL_MS = 10 * 60 * 1000;

function setupRealtime(io) {
  // Ataques esperando la reacción del objetivo (compartido entre conexiones).
  const pendingAttacks = new Map();
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
      const payload = user && build(user, sock);
      if (payload !== undefined) sock.emit(event, payload);
    }
  }

  const sceneIdOf = (user, c, sock) => camp.viewedScene(user, c, sock.data.viewSceneId).id;

  /** Manda la escena a quien la está mirando (jugadores asignados y DMs que la tengan abierta). */
  function emitScene(c, scene) {
    emitPerViewer(c, 'scene:state', (u, sock) => (sceneIdOf(u, c, sock) === scene.id ? camp.sceneView(u, c, scene) : undefined));
  }

  function emitToScene(c, scene, event, payload, exceptSocketId) {
    emitPerViewer(c, event, (u, sock) => (sock.id !== exceptSocketId && sceneIdOf(u, c, sock) === scene.id ? payload : undefined));
  }

  /** Resumen de escenas (dónde está cada jugador) solo para el DM. */
  function emitScenes(c) {
    emitPerViewer(c, 'scenes', (u) => (camp.isDM(u, c) ? { scenes: sc.summary(c), activeSceneId: c.activeSceneId } : undefined));
  }

  /** Tras lanzar una escena: a cada jugador que cambió de escena se le manda la nueva con su cartel. */
  function emitPlayersMoved(c, before) {
    emitPerViewer(c, 'scene:state', (u, sock) => {
      if (camp.isDM(u, c)) return undefined;
      const sid = sceneIdOf(u, c, sock);
      if (before[u.id] === sid) return undefined;
      return { ...camp.sceneView(u, c, sc.findScene(c, sid)), arrived: true };
    });
  }

  /** Cada uno recibe su lista de personajes (los jugadores no ven la hoja de los NPC). */
  function emitCharacters(c) {
    emitPerViewer(c, 'characters', (u) => camp.charactersFor(u, c));
  }

  function emitLog(campaign, entry) {
    emitPerViewer(campaign, 'log', (u) => (camp.logVisibleTo(u, campaign, entry) ? entry : null));
  }

  // Peticiones de tirada del DM aún sin contestar: id -> { userIds, at }. Permiten tirar fuera de turno.
  const pending = new Map();

  io.on('connection', (socket) => {
    // Sala personal: avisos del lobby (te añaden a una campaña, cambian tus personajes…).
    socket.join(`user:${socket.data.userId}`);
    const me = () => db().users.find((u) => u.id === socket.data.userId);
    let campaignId = null;
    const myScene = (c, user) => camp.viewedScene(user, c, socket.data.viewSceneId);

    /** Ejecuta un handler con la campaña actual; avisa al cliente si falla. */
    const on = (event, { dmOnly = false } = {}, fn) => {
      socket.on(event, (payload = {}, ack) => {
        countEvent(event);
        try {
          const user = me();
          const c = campaignId && camp.findCampaign(campaignId);
          if (!user || !c || !camp.canAccess(user, c)) throw new Error('No estás en una campaña');
          if (dmOnly && !camp.isDM(user, c)) throw new Error('Solo el DM puede hacer esto');
          const out = fn(c, user, payload);
          if (typeof ack === 'function') ack({ ok: true, ...(out || {}) });
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
      socket.data.viewSceneId = c.activeSceneId;
      socket.join(c.id);
      if (!presence.has(c.id)) presence.set(c.id, new Map());
      presence.get(c.id).set(socket.id, user.id);
      io.to(c.id).emit('presence', onlineIds(c.id));
      log.info('entra a la mesa', { user: user.username, campaign: c.name, ip: socket.handshake.address });
      ack?.({ state: camp.viewFor(user, c, socket.data.viewSceneId), online: onlineIds(c.id), serverNow: Date.now() });
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
      if (user && c && camp.canAccess(user, c)) ack?.({ state: camp.viewFor(user, c, socket.data.viewSceneId), online: onlineIds(c.id), serverNow: Date.now() });
    });

    registerBoard({ io, socket, on, me, myScene, emitScene, emitScenes, emitToScene, emitPlayersMoved });
    registerObjects({ io, socket, on, myScene, emitScene, emitCharacters });
    registerInventory({ io, on, emitCharacters });
    registerAttack({ io, socket, on, myScene, emitScene, emitCharacters, emitLog, pendingAttacks });

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
      const now = Date.now();
      for (const [id, r] of pending) if (now - r.at > REQUEST_TTL_MS) pending.delete(id);
      pending.set(request.id, { userIds: new Set(targets), at: now });
      for (const sid of io.sockets.adapter.rooms.get(c.id) || []) {
        const sock = io.sockets.sockets.get(sid);
        if (sock && targets.includes(sock.data.userId)) sock.emit('roll:request', request);
      }
    });

    // ---------- chat y tiradas ----------
    on('chat', {}, (c, user, p) => {
      const msg = camp.cleanText(p.text, 1000).trim();
      if (!msg) return;
      const scene = myScene(c, user);
      const who = camp.speakerFor(user, c, scene, p);
      // Diálogo: el DM hace hablar a un NPC y sale en un cuadro sobre el tablero de esa escena.
      const dialog = camp.isDM(user, c) && p.dialog === true && who.as;
      const entry = camp.addLog(c, { type: 'chat', userId: user.id, ...who, text: msg, ...(dialog ? { dialog: true, sceneId: scene.id } : {}) });
      io.to(c.id).emit('log', entry);
    });

    on('roll', {}, (c, user, p) => {
      const dm = camp.isDM(user, c);
      const req = typeof p.requestId === 'string' && pending.get(p.requestId);
      const answering = Boolean(req && req.userIds.has(user.id));
      const scene = myScene(c, user);
      const gate = sc.rollGate(scene, user.id, { isDM: dm, answeringRequest: answering, useReaction: p.reaction === true, characterId: typeof p.characterId === 'string' ? p.characterId : null });
      if (!gate.ok) throw new Error(gate.reason);
      if (answering) req.userIds.delete(user.id);
      let expr = String(p.expr || '1d20');
      const adv = p.mode === 'adv' || p.mode === 'dis';
      if (adv) expr = expr.replace(/^1?d20/i, p.mode === 'adv' ? '2d20kh1' : '2d20kl1');
      const result = dice.roll(expr);
      const natural = dice.naturalD20(result);
      const dc = p.dc !== undefined && p.dc !== null && p.dc !== '' ? camp.clampInt(p.dc, 1, 40, null) : null;
      const entry = camp.addLog(c, {
        type: 'roll',
        userId: user.id,
        ...camp.speakerFor(user, c, scene, p),
        label: `${camp.cleanText(p.label, 60, '').trim()}${gate.reactionOf ? ' · reacción' : ''}`.trim(),
        mode: adv ? p.mode : null,
        dc,
        hidden: p.hidden === true,
        result,
        natural,
        success: dc !== null ? (natural === 20 ? true : natural === 1 ? false : result.total >= dc) : null,
        byDM: dm,
      });
      emitLog(c, entry);
      if (gate.reactionOf) {
        sc.spend(scene, gate.reactionOf, 'reaction');
        save();
        emitScene(c, scene);
      }
    });
  });
}

module.exports = { setupRealtime, uniqueName, withoutEntry };
