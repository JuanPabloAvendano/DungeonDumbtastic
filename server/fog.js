// Niebla de guerra por casillas. El DM pinta lo que se ve (revealed); los personajes de los
// jugadores ven a su alrededor (visión, 6 casillas por defecto) y lo explorado queda recordado.
const DEFAULT_VISION = 6;
const MAX_VISION = 60;
const CELL_LIMIT = 40000;
const CELL_RE = /^-?\d{1,4},-?\d{1,4}$/;

const EMPTY_FOG = { on: false, revealed: [], explored: [] };

function cleanFog(f) {
  return { ...EMPTY_FOG, ...(f || {}) };
}

const key = (cx, cy) => `${cx},${cy}`;

/** Casilla de un punto del mapa según la cuadrícula calibrada. */
function cellOf(x, y, grid) {
  return [Math.floor((x - grid.ox) / grid.size), Math.floor((y - grid.oy) / grid.size)];
}

/** Casillas válidas que manda el cliente (pincel del DM), sin repetir y con tope. */
function cleanCells(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((c) => typeof c === 'string' && CELL_RE.test(c)))].slice(0, CELL_LIMIT);
}

/** Visión en casillas de una ficha: la de su hoja si la tiene, si no la de por defecto. */
function visionOf(token, characters) {
  const ch = token.characterId && characters.find((c) => c.id === token.characterId);
  const v = ch?.vision;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_VISION, Math.max(0, v)) : DEFAULT_VISION;
}

/** Fichas que dan visión a los jugadores: las que son de un jugador y no están ocultas. */
function seers(scene, playerIds) {
  return scene.tokens.filter((t) => !t.hidden && t.ownerId && playerIds.includes(t.ownerId));
}

/** Casillas que ve una ficha: círculo de `vision` casillas medido desde el borde de la ficha. */
function cellsSeenBy(token, vision, grid) {
  const g = grid.size;
  const cx = token.x + (token.size * g) / 2;
  const cy = token.y + (token.size * g) / 2;
  const reach = (vision + token.size / 2) * g;
  const [x0, y0] = cellOf(cx - reach, cy - reach, grid);
  const [x1, y1] = cellOf(cx + reach, cy + reach, grid);
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const px = grid.ox + (x + 0.5) * g;
      const py = grid.oy + (y + 0.5) * g;
      if (Math.hypot(px - cx, py - cy) <= reach) out.push(key(x, y));
    }
  }
  return out;
}

/** Lo que los jugadores ven ahora: lo revelado por el DM más la visión de sus fichas. */
function visibleCells(scene, characters, playerIds) {
  const set = new Set(cleanFog(scene.fog).revealed);
  for (const t of seers(scene, playerIds)) for (const c of cellsSeenBy(t, visionOf(t, characters), scene.grid)) set.add(c);
  return set;
}

/** ¿Alguna casilla de la ficha está a la vista? */
function tokenInView(token, visible, grid) {
  const [x0, y0] = cellOf(token.x + 1, token.y + 1, grid);
  for (let x = x0; x < x0 + token.size; x++) {
    for (let y = y0; y < y0 + token.size; y++) if (visible.has(key(x, y))) return true;
  }
  return false;
}

/** Fichas que ve un jugador con niebla: las de jugadores siempre; el resto solo si están a la vista. */
function visibleTokens(scene, characters, playerIds) {
  if (!cleanFog(scene.fog).on) return scene.tokens;
  const visible = visibleCells(scene, characters, playerIds);
  return scene.tokens.filter((t) => (t.ownerId && playerIds.includes(t.ownerId)) || tokenInView(t, visible, scene.grid));
}

/** Suma a lo explorado lo que ven ahora las fichas de los jugadores. Devuelve si cambió algo. */
function explore(scene, characters, playerIds) {
  const fog = cleanFog(scene.fog);
  if (!fog.on) return false;
  const explored = new Set(fog.explored);
  const before = explored.size;
  for (const c of visibleCells(scene, characters, playerIds)) explored.add(c);
  if (explored.size === before) return false;
  scene.fog = { ...fog, explored: [...explored].slice(-CELL_LIMIT) };
  return true;
}

/** Pincel del DM: revela o tapa casillas. Tapar también borra lo explorado ahí. */
function paint(scene, cells, mode) {
  const fog = cleanFog(scene.fog);
  const list = cleanCells(cells);
  if (mode === 'reveal') {
    scene.fog = { ...fog, revealed: [...new Set([...fog.revealed, ...list])].slice(-CELL_LIMIT) };
  } else if (mode === 'cover') {
    const drop = new Set(list);
    scene.fog = { ...fog, revealed: fog.revealed.filter((c) => !drop.has(c)), explored: fog.explored.filter((c) => !drop.has(c)) };
  } else {
    throw new Error('Pincel de niebla desconocido');
  }
  return scene.fog;
}

module.exports = {
  DEFAULT_VISION, MAX_VISION, EMPTY_FOG, cleanFog, cellOf, cleanCells, visionOf, cellsSeenBy, visibleCells,
  tokenInView, visibleTokens, explore, paint,
};
