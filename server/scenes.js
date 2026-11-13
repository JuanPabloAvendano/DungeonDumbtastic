// Escenas: cada una tiene su mapa, cuadrícula calibrada, fichas e iniciativa.
// Los jugadores ven la escena que tienen asignada; el DM puede preparar otras sin que se vea.
const crypto = require('crypto');

const DEFAULT_GRID = { size: 70, ox: 0, oy: 0, show: true };
const DEFAULT_MOVE = 5;
const SCENE_LIMIT = 40;
const EMPTY_INI = { entries: [], turn: 0, round: 1, turnState: null, reactions: {} };

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : fallback;
}

function cleanGrid(input = {}, prev = DEFAULT_GRID) {
  const size = clampNum(input.size, 10, 400, prev.size);
  return {
    size,
    ox: clampNum(input.ox, 0, size, Math.min(prev.ox, size)),
    oy: clampNum(input.oy, 0, size, Math.min(prev.oy, size)),
    show: typeof input.show === 'boolean' ? input.show : prev.show,
  };
}

/** Recorte del mapa (para mapas enormes divididos en zonas). null = mapa completo. */
function cleanCrop(input, prev = null) {
  if (input === null) return null;
  if (!input || typeof input !== 'object') return prev;
  const w = clampNum(input.w, 50, 40000, null);
  const hgt = clampNum(input.h, 50, 40000, null);
  if (w === null || hgt === null) return prev;
  return { x: clampNum(input.x, 0, 40000, 0), y: clampNum(input.y, 0, 40000, 0), w, h: hgt };
}

function newScene({ name, mapId = null, grid, crop = null, moveSquares } = {}) {
  return {
    id: crypto.randomUUID(),
    name: String(name || 'Escena').slice(0, 50).trim() || 'Escena',
    mapId,
    grid: cleanGrid(grid || {}),
    crop: cleanCrop(crop),
    moveSquares: clampNum(moveSquares, 1, 40, DEFAULT_MOVE),
    tokens: [],
    initiative: structuredClone(EMPTY_INI),
    createdAt: new Date().toISOString(),
  };
}

/** Pasa campañas del formato antiguo (una sola escena suelta) al de varias escenas. */
function migrate(c) {
  if (Array.isArray(c.scenes)) return c;
  const old = c.scene || {};
  const scene = newScene({
    name: c.maps?.find((m) => m.id === old.mapId)?.name || 'Escena 1',
    mapId: old.mapId || null,
    grid: { size: old.gridSize || DEFAULT_GRID.size, show: old.showGrid !== false },
  });
  scene.tokens = c.tokens || [];
  scene.initiative = { ...structuredClone(EMPTY_INI), ...(c.initiative || {}) };
  c.scenes = [scene];
  c.activeSceneId = scene.id;
  c.playerScene = {};
  delete c.scene;
  delete c.tokens;
  delete c.initiative;
  return c;
}

function findScene(c, id) {
  return c.scenes.find((s) => s.id === id) || null;
}

/** Escena que ve un jugador: la suya si está separado del grupo, si no la principal. */
function sceneIdForPlayer(c, userId) {
  const own = c.playerScene?.[userId];
  return own && findScene(c, own) ? own : c.activeSceneId;
}

/** Jugadores que están ahora mismo en cada escena. */
function playersByScene(c) {
  const out = {};
  for (const uid of c.playerIds) {
    const sid = sceneIdForPlayer(c, uid);
    out[sid] = [...(out[sid] || []), uid];
  }
  return out;
}

function summary(c) {
  const who = playersByScene(c);
  return c.scenes.map((s) => ({
    id: s.id,
    name: s.name,
    mapId: s.mapId,
    tokens: s.tokens.length,
    players: who[s.id] || [],
    active: s.id === c.activeSceneId,
    combat: s.initiative.entries.length > 0,
  }));
}

// ---------------------------------------------------------------- turnos

function inCombat(scene) {
  return scene.initiative.entries.length > 0;
}

function currentTokenId(scene) {
  const ini = scene.initiative;
  return ini.entries[ini.turn]?.tokenId || null;
}

/** Casillas entre dos posiciones con la regla simple de 5e: cada diagonal cuenta 1. */
function squaresBetween(a, b, size) {
  return Math.round(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / size);
}

/** Estado limpio al empezar el turno de una ficha. */
function freshTurn(scene) {
  const tokenId = currentTokenId(scene);
  const t = scene.tokens.find((x) => x.id === tokenId);
  return { tokenId, used: 0, anchor: t ? { x: t.x, y: t.y } : null, action: false, bonus: false };
}

/** Aplica un cambio de iniciativa y reinicia el turno si cambió de ficha o de ronda. */
function setInitiative(scene, next) {
  const prev = scene.initiative;
  const ini = { ...EMPTY_INI, ...prev, ...next };
  if (!ini.entries.length) {
    scene.initiative = structuredClone(EMPTY_INI);
    return scene.initiative;
  }
  const changedTurn = ini.turn !== prev.turn || ini.round !== prev.round
    || ini.entries[ini.turn]?.tokenId !== prev.turnState?.tokenId;
  scene.initiative = ini;
  if (changedTurn || !ini.turnState) {
    const turnState = freshTurn(scene);
    // La reacción se recupera al empezar tu propio turno.
    const reactions = { ...(ini.reactions || {}) };
    delete reactions[turnState.tokenId];
    scene.initiative = { ...ini, turnState, reactions };
  }
  return scene.initiative;
}

function advanceTurn(scene) {
  const ini = scene.initiative;
  const next = ini.turn + 1;
  return setInitiative(scene, next >= ini.entries.length ? { turn: 0, round: ini.round + 1 } : { turn: next });
}

/**
 * ¿Puede moverse esta ficha a `to`? Fuera de combate siempre; en combate el jugador solo
 * en su turno y sin pasar de las casillas que le quedan. El DM no tiene límite.
 */
function checkMove(scene, token, to, { isDM }) {
  if (!inCombat(scene) || isDM) return { ok: true };
  const ts = scene.initiative.turnState;
  if (!scene.initiative.entries.some((e) => e.tokenId === token.id)) return { ok: false, reason: 'Esa ficha no está en la iniciativa' };
  if (!ts || ts.tokenId !== token.id) return { ok: false, reason: 'No es tu turno' };
  const step = squaresBetween(ts.anchor || token, to, scene.grid.size);
  const remaining = scene.moveSquares - ts.used;
  if (step > remaining) return { ok: false, reason: remaining > 0 ? `Solo te quedan ${remaining} casillas de movimiento` : 'Ya gastaste tu movimiento' };
  return { ok: true };
}

/** Registra un movimiento final ya validado: gasta casillas (salvo si lo mueve el DM). */
function commitMove(scene, token, to, { isDM }) {
  const ts = scene.initiative.turnState;
  if (!inCombat(scene) || !ts || ts.tokenId !== token.id) return;
  const step = isDM ? 0 : squaresBetween(ts.anchor || token, to, scene.grid.size);
  scene.initiative = { ...scene.initiative, turnState: { ...ts, used: ts.used + step, anchor: { x: to.x, y: to.y } } };
}

/** ¿Puede este usuario tirar ahora? Fuera de su turno solo si el DM se lo pide o gastando la reacción. */
function rollGate(scene, userId, { isDM, answeringRequest, useReaction, characterId = null }) {
  if (isDM || !inCombat(scene) || answeringRequest) return { ok: true };
  const mine = scene.tokens.filter((t) => t.ownerId === userId).map((t) => t.id);
  const ts = scene.initiative.turnState;
  if (ts && mine.includes(ts.tokenId)) return { ok: true };
  // Un jugador con varios personajes gasta la reacción del que está usando.
  const acting = characterId && scene.tokens.find((t) => t.characterId === characterId && mine.includes(t.id));
  const entries = scene.initiative.entries;
  const entry = (acting && entries.find((e) => e.tokenId === acting.id)) || entries.find((e) => mine.includes(e.tokenId));
  if (!entry) return { ok: true };
  if (!useReaction) return { ok: false, reason: 'No es tu turno: solo puedes tirar si el DM te lo pide o usando tu reacción' };
  if (scene.initiative.reactions?.[entry.tokenId]) return { ok: false, reason: 'Ya usaste tu reacción esta ronda' };
  return { ok: true, reactionOf: entry.tokenId };
}

/** Marca o desmarca acción / acción adicional (en tu turno) o la reacción (una por ronda). */
function spend(scene, tokenId, what) {
  const ini = scene.initiative;
  if (what === 'reaction') {
    const reactions = { ...(ini.reactions || {}) };
    if (reactions[tokenId]) delete reactions[tokenId];
    else reactions[tokenId] = true;
    scene.initiative = { ...ini, reactions };
    return;
  }
  if (!['action', 'bonus'].includes(what)) throw new Error('Gasto desconocido');
  if (ini.turnState?.tokenId !== tokenId) throw new Error('Solo en tu turno');
  scene.initiative = { ...ini, turnState: { ...ini.turnState, [what]: !ini.turnState[what] } };
}

module.exports = {
  DEFAULT_GRID, DEFAULT_MOVE, SCENE_LIMIT, EMPTY_INI,
  clampNum, cleanGrid, cleanCrop, newScene, migrate, findScene, sceneIdForPlayer, playersByScene, summary,
  inCombat, currentTokenId, squaresBetween, setInitiative, advanceTurn, checkMove, commitMove, rollGate, spend,
};
