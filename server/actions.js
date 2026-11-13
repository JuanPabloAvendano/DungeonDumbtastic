// Acciones, conjuros y espacios de conjuro de un personaje (la barra de acciones de la mesa).
const diceLib = require('./dice');

const KINDS = ['action', 'bonus', 'reaction', 'free', 'passive'];
const RESETS = ['short', 'long', 'none'];
const ACTION_LIMIT = 80;
const MAX_SLOTS_PER_LEVEL = 9;
const SPELL_LEVELS = 9;

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max).trim() : '');
/** Expresión de dados válida (1d20+5, 2d6+3, 4d6kh3…) o '' si dice.js no la entiende. */
function dice(v) {
  const clean = typeof v === 'string' ? v.replace(/\s+/g, '').slice(0, 30) : '';
  if (!clean) return '';
  try {
    diceLib.roll(clean);
    return clean;
  } catch {
    return '';
  }
}

function cleanUses(u) {
  if (!u || typeof u !== 'object') return null;
  const max = clampInt(u.max, 0, 99, 0);
  if (!max) return null;
  return { max, used: clampInt(u.used, 0, max, 0), reset: RESETS.includes(u.reset) ? u.reset : 'long' };
}

function cleanAction(a, i) {
  const name = text(a?.name, 40);
  if (!name) return null;
  const level = a.spellLevel === null || a.spellLevel === undefined || a.spellLevel === '' ? null : clampInt(a.spellLevel, 0, SPELL_LEVELS, null);
  return {
    id: text(a.id, 40) || `a${Date.now().toString(36)}${i}`,
    name,
    kind: KINDS.includes(a.kind) ? a.kind : 'action',
    attack: dice(a.attack),
    damage: dice(a.damage),
    damageType: text(a.damageType, 20),
    spellLevel: level,
    uses: cleanUses(a.uses),
    note: text(a.note, 400),
  };
}

function cleanActions(list, prev = []) {
  if (!Array.isArray(list)) return prev;
  return list.slice(0, ACTION_LIMIT).map(cleanAction).filter(Boolean);
}

/** Espacios de conjuro: { "1": { max, used }, … "9": … }. Solo se guardan los niveles con max > 0. */
function cleanSlots(slots, prev = {}) {
  if (!slots || typeof slots !== 'object') return prev;
  const out = {};
  for (let lvl = 1; lvl <= SPELL_LEVELS; lvl++) {
    const s = slots[lvl] || slots[String(lvl)];
    const max = clampInt(s?.max, 0, MAX_SLOTS_PER_LEVEL, 0);
    // pact: espacios del pacto del brujo, que vuelven con descanso corto.
    if (max) out[lvl] = { max, used: clampInt(s.used, 0, max, 0), ...(s.pact === true ? { pact: true } : {}) };
  }
  return out;
}

module.exports = { KINDS, RESETS, cleanActions, cleanSlots };
