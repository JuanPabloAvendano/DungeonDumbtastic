// Tiradas en el servidor: así todos ven el mismo resultado y nadie hace trampa.
// Formato: "2d6+3", "1d20-1", "d100", "4d6kh3" (quedarse con las 3 más altas), "2d20kl1".
const crypto = require('crypto');

const VALID_SIDES = [2, 4, 6, 8, 10, 12, 20, 100];
const MAX_DICE = 30;
const TERM_RE = /([+-])?\s*(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/gi;

function rollDie(sides) {
  return crypto.randomInt(1, sides + 1);
}

/**
 * @param {string} expr
 * @returns {{ expr: string, groups: Array<{sides:number, values:number[], kept:boolean[], sign:number}>, modifier: number, total: number }}
 */
function roll(expr) {
  const clean = String(expr || '').replace(/\s+/g, '').toLowerCase().slice(0, 60);
  if (!clean) throw new Error('Tirada vacía');

  const groups = [];
  let modifier = 0;
  let consumed = 0;
  let diceCount = 0;

  for (const m of clean.matchAll(TERM_RE)) {
    if (m.index !== consumed) throw new Error(`No entiendo "${clean}"`);
    consumed += m[0].length;
    const sign = m[1] === '-' ? -1 : 1;

    if (m[6] !== undefined) {
      modifier += sign * Number(m[6]);
      continue;
    }
    const count = m[2] === '' || m[2] === undefined ? 1 : Number(m[2]);
    const sides = Number(m[3]);
    if (!VALID_SIDES.includes(sides)) throw new Error(`Dado d${sides} no soportado`);
    diceCount += count;
    if (count < 1 || diceCount > MAX_DICE) throw new Error(`Máximo ${MAX_DICE} dados por tirada`);

    const values = Array.from({ length: count }, () => rollDie(sides));
    const kept = keepMask(values, m[4], m[5] === undefined ? count : Number(m[5]));
    groups.push({ sides, values, kept, sign });
  }
  if (consumed !== clean.length || !groups.length) throw new Error(`No entiendo "${clean}"`);

  const total = groups.reduce(
    (sum, g) => sum + g.sign * g.values.reduce((s, v, i) => s + (g.kept[i] ? v : 0), 0),
    modifier,
  );
  return { expr: clean, groups, modifier, total };
}

function keepMask(values, mode, keepCount) {
  if (!mode) return values.map(() => true);
  const order = values.map((v, i) => [v, i]).sort((a, b) => (mode === 'kh' ? b[0] - a[0] : a[0] - b[0]));
  const keep = new Set(order.slice(0, Math.max(1, Math.min(keepCount, values.length))).map(([, i]) => i));
  return values.map((_, i) => keep.has(i));
}

/** Natural 20 / natural 1 sobre el d20 que cuenta (útil para críticos). */
function naturalD20(result) {
  const g = result.groups.find((x) => x.sides === 20);
  if (!g) return null;
  const idx = g.kept.findIndex(Boolean);
  return idx === -1 ? null : g.values[idx];
}

module.exports = { roll, naturalD20, VALID_SIDES };
