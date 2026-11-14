// Tiempo real del tablero: mapas, escenas (preparar, lanzar, paralelas), fichas, iniciativa y turnos.
const crypto = require('crypto');
const { db, save } = require('./db');
const camp = require('./campaigns');
const sc = require('./scenes');
const fog = require('./fog');
const objects = require('./objects');
const { log } = require('./logger');

const TOKEN_LIMIT = 200;
const MAP_LIMIT = 60;
const URL_RE = /^\/(uploads|assets)\/[\w./-]+$/;
const POS_MIN = -5000;
const POS_MAX = 40000;

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

/** Crea una ficha validada a partir de lo que manda el cliente. */
function buildToken(c, scene, user, p) {
  const dm = camp.isDM(user, c);
  const character = p.characterId && db().characters.find((ch) => ch.id === p.characterId && ch.campaignId === c.id);
  if (!dm && (!character || character.ownerId !== user.id)) throw new Error('Solo puedes colocar tu propio personaje');
  if (character && scene.tokens.some((t) => t.characterId === character.id)) throw new Error(`${character.name} ya está en esta escena`);
  if (scene.tokens.length >= TOKEN_LIMIT) throw new Error('Demasiadas fichas en el tablero');
  const baseName = camp.cleanText(p.name, 40, character?.name || 'Ficha').trim() || 'Ficha';
  return {
    id: crypto.randomUUID(),
    name: character ? baseName : uniqueName(scene.tokens, baseName),
    img: safeUrl(p.img) || safeUrl(character?.portrait) || '/assets/demo/token-goblin.svg',
    x: sc.clampNum(p.x, POS_MIN, POS_MAX, 0),
    y: sc.clampNum(p.y, POS_MIN, POS_MAX, 0),
    size: camp.clampInt(p.size, 1, 6, 1),
    ownerId: character ? character.ownerId : (p.ownerId && c.playerIds.includes(p.ownerId) ? p.ownerId : null),
    characterId: character ? character.id : null,
    hp: camp.clampInt(p.hp, -99, 9999, 10),
    maxHp: camp.clampInt(p.maxHp, 1, 9999, 10),
    // CA de las criaturas sueltas (los personajes usan la de su hoja).
    ...(character ? {} : { ac: camp.clampInt(p.ac, 0, 40, 10) }),
    hidden: dm && p.hidden === true,
    conditions: [],
    // Solo el DM pone objetos (cofres, cartas, palancas…): no son criaturas ni entran en la iniciativa.
    ...(dm && !character && p.kind === 'objeto' ? { kind: 'objeto', object: objects.cleanObject(p.object || {}) } : {}),
  };
}

function sceneFields(c, p, prev) {
  const mapOk = p.mapId === null || c.maps.some((m) => m.id === p.mapId);
  return {
    name: p.name !== undefined ? camp.cleanText(p.name, 50, prev.name).trim() || prev.name : prev.name,
    mapId: p.mapId !== undefined && mapOk ? p.mapId : prev.mapId,
    grid: p.grid ? sc.cleanGrid(p.grid, prev.grid) : prev.grid,
    crop: p.crop !== undefined ? sc.cleanCrop(p.crop, prev.crop) : prev.crop,
    moveSquares: p.moveSquares !== undefined ? sc.clampNum(Math.round(p.moveSquares), 1, 40, prev.moveSquares) : prev.moveSquares,
  };
}

/**
 * Registra los eventos del tablero en un socket.
 * @param {{ io, socket, on, me, myScene, emitScene, emitScenes, emitToScene }} rt
 */
function registerBoard(rt) {
  const { io, socket, on, myScene, emitScene, emitScenes, emitToScene } = rt;

  // ---------- mapas (DM) ----------
  on('map:add', { dmOnly: true }, (c, user, { name, url }) => {
    const clean = safeUrl(url);
    if (!clean) throw new Error('Imagen inválida');
    if (c.maps.length >= MAP_LIMIT) throw new Error('Demasiados mapas');
    const map = { id: crypto.randomUUID(), name: camp.cleanText(name, 50, 'Mapa').trim() || 'Mapa', url: clean };
    c.maps = [...c.maps, map];
    save();
    io.to(c.id).emit('maps', c.maps);
    return { id: map.id };
  });

  on('map:remove', { dmOnly: true }, (c, user, { id }) => {
    c.maps = c.maps.filter((m) => m.id !== id);
    c.scenes = c.scenes.map((s) => (s.mapId === id ? { ...s, mapId: null } : s));
    save();
    io.to(c.id).emit('maps', c.maps);
    c.scenes.forEach((s) => emitScene(c, s));
    emitScenes(c);
  });

  // ---------- escenas (DM) ----------
  on('scene:create', { dmOnly: true }, (c, user, p) => {
    if (c.scenes.length >= sc.SCENE_LIMIT) throw new Error('Demasiadas escenas; borra alguna que ya no uses');
    const scene = sc.newScene({});
    Object.assign(scene, sceneFields(c, p, scene));
    const wanted = Array.isArray(p.tokens) ? p.tokens.slice(0, TOKEN_LIMIT) : [];
    for (const t of wanted) {
      try { scene.tokens = [...scene.tokens, buildToken(c, scene, user, t)]; } catch (err) { log.warn('ficha de escena descartada', { error: err.message }); }
    }
    c.scenes = [...c.scenes, scene];
    save();
    socket.data.viewSceneId = scene.id;
    emitScene(c, scene);
    emitScenes(c);
    log.info('escena preparada', { campaign: c.name, scene: scene.name, tokens: scene.tokens.length });
    return { id: scene.id };
  });

  on('scene:update', { dmOnly: true }, (c, user, p) => {
    const scene = p.id ? sc.findScene(c, p.id) : myScene(c, user);
    if (!scene) throw new Error('Escena no encontrada');
    Object.assign(scene, sceneFields(c, p, scene));
    save();
    emitScene(c, scene);
    emitScenes(c);
  });

  on('scene:view', { dmOnly: true }, (c, user, { id }) => {
    const scene = sc.findScene(c, id);
    if (!scene) throw new Error('Escena no encontrada');
    socket.data.viewSceneId = scene.id;
    socket.emit('scene:state', camp.sceneView(user, c, scene));
  });

  // Lanza una escena para todos (o solo para algunos jugadores: escenas paralelas).
  on('scene:launch', { dmOnly: true }, (c, user, { id, userIds }) => {
    const scene = sc.findScene(c, id);
    if (!scene) throw new Error('Escena no encontrada');
    const before = Object.fromEntries(c.playerIds.map((uid) => [uid, sc.sceneIdForPlayer(c, uid)]));
    const targets = Array.isArray(userIds) ? c.playerIds.filter((uid) => userIds.includes(uid)) : c.playerIds;
    if (!targets.length) throw new Error('Elige al menos un jugador');
    const playerScene = { ...before };
    targets.forEach((uid) => { playerScene[uid] = scene.id; });
    if (c.playerIds.every((uid) => playerScene[uid] === scene.id)) {
      c.activeSceneId = scene.id;
      c.playerScene = {};
    } else {
      c.playerScene = Object.fromEntries(Object.entries(playerScene).filter(([, sid]) => sid !== c.activeSceneId));
    }
    save();
    rt.emitPlayersMoved(c, before);
    emitScenes(c);
    log.info('escena lanzada', { campaign: c.name, scene: scene.name, players: targets.length });
  });

  on('scene:delete', { dmOnly: true }, (c, user, { id }) => {
    const scene = sc.findScene(c, id);
    if (!scene) return;
    if (scene.id === c.activeSceneId) throw new Error('Es la escena principal: lanza otra antes de borrarla');
    if (sc.playersByScene(c)[scene.id]?.length) throw new Error('Hay jugadores en esa escena: muévelos antes de borrarla');
    c.scenes = c.scenes.filter((s) => s.id !== id);
    save();
    for (const sid of io.sockets.adapter.rooms.get(c.id) || []) {
      const sock = io.sockets.sockets.get(sid);
      if (sock?.data.viewSceneId === id) {
        sock.data.viewSceneId = c.activeSceneId;
        const u = db().users.find((x) => x.id === sock.data.userId);
        if (u) sock.emit('scene:state', camp.sceneView(u, c, sc.findScene(c, c.activeSceneId)));
      }
    }
    emitScenes(c);
  });

  // ---------- fichas ----------
  on('token:add', {}, (c, user, p) => {
    const scene = myScene(c, user);
    scene.tokens = [...scene.tokens, buildToken(c, scene, user, p)];
    fog.explore(scene, camp.charactersOf(c), c.playerIds);
    save();
    emitScene(c, scene);
    emitScenes(c);
  });

  on('token:update', {}, (c, user, p) => {
    const dm = camp.isDM(user, c);
    const scene = myScene(c, user);
    const prev = scene.tokens.find((t) => t.id === p.id);
    if (!prev) throw new Error('Ficha no encontrada');
    if (!dm && prev.ownerId !== user.id) throw new Error('Esa ficha no es tuya');
    const moving = p.x !== undefined || p.y !== undefined;
    const to = { x: sc.clampNum(p.x, POS_MIN, POS_MAX, prev.x), y: sc.clampNum(p.y, POS_MIN, POS_MAX, prev.y) };
    if (moving) {
      const gate = sc.checkMove(scene, prev, to, { isDM: dm });
      if (!gate.ok) {
        // Arrastre en vivo fuera de alcance: se ignora. Al soltar: vuelve a donde empezó el paso.
        if (!p.final) return;
        const anchor = scene.initiative.turnState?.tokenId === prev.id && scene.initiative.turnState.anchor;
        if (anchor) scene.tokens = scene.tokens.map((t) => (t.id === prev.id ? { ...t, ...anchor } : t));
        emitScene(c, scene);
        throw new Error(gate.reason);
      }
      if (p.final) sc.commitMove(scene, prev, to, { isDM: dm });
    }
    const next = {
      ...prev,
      ...to,
      hp: p.hp !== undefined ? camp.clampInt(p.hp, 0, 9999, prev.hp) : prev.hp,
      conditions: Array.isArray(p.conditions) ? p.conditions.slice(0, 12).map((x) => camp.cleanText(x, 20)).filter(Boolean) : prev.conditions,
    };
    if (dm) {
      Object.assign(next, {
        name: p.name !== undefined ? camp.cleanText(p.name, 40, prev.name).trim() || prev.name : prev.name,
        size: p.size !== undefined ? camp.clampInt(p.size, 1, 6, prev.size) : prev.size,
        maxHp: p.maxHp !== undefined ? camp.clampInt(p.maxHp, 1, 9999, prev.maxHp) : prev.maxHp,
        ...(prev.characterId ? {} : { ac: p.ac !== undefined ? camp.clampInt(p.ac, 0, 40, prev.ac ?? 10) : prev.ac ?? 10 }),
        hidden: typeof p.hidden === 'boolean' ? p.hidden : prev.hidden,
        img: p.img !== undefined ? safeUrl(p.img) || prev.img : prev.img,
      });
      // Convertir en objeto (o volver a criatura) y cambiar su configuración.
      if (!prev.characterId && (p.kind === 'objeto' || p.kind === 'criatura')) next.kind = p.kind;
      if (next.kind === 'objeto' && (p.object || !prev.object)) next.object = objects.cleanObject(p.object || {}, prev.object || {});
      if (next.kind !== 'objeto') delete next.object;
    }
    scene.tokens = scene.tokens.map((t) => (t.id === prev.id ? next : t));
    // Arrastre en vivo: solo el delta para que sea fluido. Lo demás: la escena entera.
    const liveMove = moving && !p.final && Object.keys(p).every((k) => ['id', 'x', 'y', 'final'].includes(k));
    if (!liveMove) fog.explore(scene, camp.charactersOf(c), c.playerIds);
    save();
    // Con niebla, el arrastre en vivo de una ficha que no es de un jugador delataría dónde está.
    const secret = next.hidden || (fog.cleanFog(scene.fog).on && !(next.ownerId && c.playerIds.includes(next.ownerId)));
    if (liveMove && !secret) emitToScene(c, scene, 'token:moved', { id: next.id, x: next.x, y: next.y }, socket.id);
    else if (!liveMove) emitScene(c, scene);
  });

  on('token:remove', {}, (c, user, { id }) => {
    const scene = myScene(c, user);
    const prev = scene.tokens.find((t) => t.id === id);
    if (!prev) return;
    if (!camp.isDM(user, c) && prev.ownerId !== user.id) throw new Error('Esa ficha no es tuya');
    scene.tokens = scene.tokens.filter((t) => t.id !== id);
    sc.setInitiative(scene, withoutEntry(scene.initiative, id));
    save();
    emitScene(c, scene);
    emitScenes(c);
  });

  on('ping', {}, (c, user, { x, y }) => {
    emitToScene(c, myScene(c, user), 'ping', { x: Number(x) || 0, y: Number(y) || 0, name: user.displayName, userId: user.id });
  });

  // ---------- niebla de guerra (DM) ----------
  on('fog:set', { dmOnly: true }, (c, user, p) => {
    const scene = myScene(c, user);
    const prev = fog.cleanFog(scene.fog);
    // «Tapar todo» olvida lo revelado y lo explorado; lo que ven ahora los personajes se vuelve a explorar.
    scene.fog = p.reset ? { ...prev, revealed: [], explored: [] } : prev;
    if (typeof p.on === 'boolean') scene.fog = { ...scene.fog, on: p.on };
    fog.explore(scene, camp.charactersOf(c), c.playerIds);
    save();
    emitScene(c, scene);
  });

  on('fog:paint', { dmOnly: true }, (c, user, { cells, mode }) => {
    const scene = myScene(c, user);
    fog.paint(scene, cells, mode);
    save();
    emitScene(c, scene);
  });

  // ---------- iniciativa y turnos ----------
  on('initiative:set', { dmOnly: true }, (c, user, { entries, turn, round }) => {
    const scene = myScene(c, user);
    const clean = (Array.isArray(entries) ? entries : []).slice(0, 40).map((e) => ({
      id: typeof e.id === 'string' ? e.id.slice(0, 40) : crypto.randomUUID(),
      tokenId: typeof e.tokenId === 'string' ? e.tokenId : null,
      name: camp.cleanText(e.name, 40, 'Combatiente'),
      value: camp.clampInt(e.value, -10, 60, 0),
      img: safeUrl(e.img),
    }));
    sc.setInitiative(scene, {
      entries: clean,
      turn: camp.clampInt(turn, 0, Math.max(0, clean.length - 1), 0),
      round: camp.clampInt(round, 1, 999, scene.initiative.round || 1),
    });
    save();
    emitScene(c, scene);
    emitScenes(c);
  });

  const ownsCurrent = (scene, user) => scene.tokens.find((t) => t.id === sc.currentTokenId(scene))?.ownerId === user.id;

  on('turn:end', {}, (c, user) => {
    const scene = myScene(c, user);
    if (!sc.inCombat(scene)) throw new Error('No hay combate en curso');
    if (!camp.isDM(user, c) && !ownsCurrent(scene, user)) throw new Error('No es tu turno');
    sc.advanceTurn(scene);
    save();
    emitScene(c, scene);
  });

  on('turn:spend', {}, (c, user, { what, tokenId }) => {
    const scene = myScene(c, user);
    if (!sc.inCombat(scene)) throw new Error('No hay combate en curso');
    const id = what === 'reaction' ? tokenId : sc.currentTokenId(scene);
    const token = scene.tokens.find((t) => t.id === id);
    if (!token || !scene.initiative.entries.some((e) => e.tokenId === id)) throw new Error('Esa ficha no está en la iniciativa');
    if (!camp.isDM(user, c) && token.ownerId !== user.id) throw new Error('Esa ficha no es tuya');
    sc.spend(scene, id, what);
    save();
    emitScene(c, scene);
  });
}

module.exports = { registerBoard, uniqueName, withoutEntry, safeUrl, MAP_LIMIT };
