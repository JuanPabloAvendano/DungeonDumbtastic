// Reglas del inventario (SRD 5.1), sin DOM: las usan la hoja en el navegador y el servidor
// (require de ESM). CA por armadura, carga, ataque con arma, monedas y equipo de ejemplo.

export const COINS = [['cp', 'pc', 0.01], ['sp', 'pp', 0.1], ['ep', 'pe', 0.5], ['gp', 'po', 1], ['pp', 'ppt', 10]];
const COINS_PER_LB = 50;
const CAPACITY_PER_STR = 15;
const MEDIUM_DEX_CAP = 2;
const SHIELD_BONUS = 2;

const mod = (score) => Math.floor(((score ?? 10) - 10) / 2);
const proficiency = (level) => 2 + Math.floor(((level || 1) - 1) / 4);
const signed = (n) => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);
const round2 = (n) => Math.round(n * 100) / 100;

const armor = (name, base, type, weight, value) => ({ name, kind: 'armadura', armor: { base, type }, weight, value });
const weapon = (name, damage, dmgType, weight, value, extra = {}) => ({
  name, kind: 'arma', weapon: { damage, dmgType, finesse: false, ranged: false, proficient: true, ...extra }, weight, value,
});

/** Armaduras y armas comunes del SRD 5.1 (peso en libras, valor en po). */
export const EQUIPMENT_PRESETS = [
  armor('Acolchada', 11, 'ligera', 8, 5),
  armor('Cuero', 11, 'ligera', 10, 10),
  armor('Cuero tachonado', 12, 'ligera', 13, 45),
  armor('Pieles', 12, 'media', 12, 10),
  armor('Camisote de malla', 13, 'media', 20, 50),
  armor('Cota de escamas', 14, 'media', 45, 50),
  armor('Coraza', 14, 'media', 20, 400),
  armor('Media armadura', 15, 'media', 40, 750),
  armor('Cota de anillas', 14, 'pesada', 40, 30),
  armor('Cota de malla', 16, 'pesada', 55, 75),
  armor('Bandas', 17, 'pesada', 60, 200),
  armor('Placas', 18, 'pesada', 65, 1500),
  { name: 'Escudo', kind: 'escudo', weight: 6, value: 10 },
  weapon('Daga', '1d4', 'perforante', 1, 2, { finesse: true }),
  weapon('Clava', '1d4', 'contundente', 2, 0.1),
  weapon('Bastón', '1d6', 'contundente', 4, 0.2),
  weapon('Hacha de mano', '1d6', 'cortante', 2, 5),
  weapon('Lanza', '1d6', 'perforante', 3, 1),
  weapon('Maza', '1d6', 'contundente', 4, 5),
  weapon('Espada corta', '1d6', 'perforante', 2, 10, { finesse: true }),
  weapon('Cimitarra', '1d6', 'cortante', 3, 25, { finesse: true }),
  weapon('Espada larga', '1d8', 'cortante', 3, 15),
  weapon('Estoque', '1d8', 'perforante', 2, 25, { finesse: true }),
  weapon('Martillo de guerra', '1d8', 'contundente', 2, 15),
  weapon('Hacha a dos manos', '1d12', 'cortante', 7, 30),
  weapon('Mandoble', '2d6', 'cortante', 6, 50),
  weapon('Arco corto', '1d6', 'perforante', 2, 25, { ranged: true }),
  weapon('Arco largo', '1d8', 'perforante', 2, 50, { ranged: true }),
  weapon('Ballesta ligera', '1d8', 'perforante', 5, 25, { ranged: true }),
];

const equipped = (ch, kind) => (ch.inventory || []).filter((it) => it.equipped && it.kind === kind);

/**
 * CA con lo que lleva puesto: { ac, source }. Null si no lleva armadura ni escudo, para que se
 * respete la CA escrita a mano (armadura natural, defensa sin armadura…).
 */
export function computeAc(ch) {
  const [suit] = equipped(ch, 'armadura');
  const shield = equipped(ch, 'escudo')[0];
  if (!suit && !shield) return null;
  const dex = mod(ch.stats?.dex);
  let ac = 10 + dex;
  const parts = [];
  if (suit?.armor) {
    const { base, type } = suit.armor;
    ac = base + (type === 'pesada' ? 0 : type === 'media' ? Math.min(dex, MEDIUM_DEX_CAP) : dex);
    parts.push(suit.name);
  }
  if (shield) {
    ac += SHIELD_BONUS;
    parts.push(shield.name);
  }
  return { ac, source: parts.join(' + ') };
}

export const carryCapacity = (ch) => (ch.stats?.str ?? 10) * CAPACITY_PER_STR;

export const coinCount = (coins = {}) => COINS.reduce((sum, [k]) => sum + (coins[k] || 0), 0);

/** Peso total en libras: objetos × cantidad + monedas (50 por libra). */
export function totalWeight(ch) {
  const items = (ch.inventory || []).reduce((sum, it) => sum + (it.weight || 0) * (it.qty || 1), 0);
  return round2(items + coinCount(ch.coins) / COINS_PER_LB);
}

/** Nivel de carga según la regla variante del SRD (Fue×5 y Fue×10) y el máximo (Fue×15). */
export function encumbrance(ch) {
  const str = ch.stats?.str ?? 10;
  const weight = totalWeight(ch);
  const level = weight > str * CAPACITY_PER_STR ? 'excedido'
    : weight > str * 10 ? 'muy sobrecargado'
      : weight > str * 5 ? 'sobrecargado' : 'normal';
  return { weight, capacity: carryCapacity(ch), level };
}

/** Tirada de ataque y daño de un arma para este personaje. */
export function weaponAttack(ch, item) {
  const w = item.weapon || {};
  const str = mod(ch.stats?.str);
  const dex = mod(ch.stats?.dex);
  const m = w.ranged ? dex : w.finesse ? Math.max(str, dex) : str;
  return {
    toHit: m + (w.proficient === false ? 0 : proficiency(ch.level)),
    damage: `${w.damage || '1d4'}${signed(m)}`,
    dmgType: w.dmgType || '',
  };
}

/** Reparte monedas entre `n` personajes por tipo, sin cambiar de moneda; lo que sobra va aparte. */
export function splitCoins(coins, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('Hace falta al menos un personaje para repartir');
  const each = {};
  const rest = {};
  for (const [k] of COINS) {
    const total = Math.max(0, Math.floor(coins?.[k] || 0));
    each[k] = Math.floor(total / n);
    rest[k] = total - each[k] * n;
  }
  return { each, rest };
}

export const coinsValueGp = (coins = {}) => round2(COINS.reduce((sum, [k, , gp]) => sum + (coins[k] || 0) * gp, 0));

/** 0.05 → «5 pc», 0.5 → «5 pp», 12 → «12 po». */
export function formatGp(gp) {
  if (!gp) return '—';
  if (gp >= 1) return `${round2(gp)} po`;
  if (gp >= 0.1 && Math.abs(gp * 10 - Math.round(gp * 10)) < 1e-9) return `${Math.round(gp * 10)} pp`;
  return `${Math.round(gp * 100)} pc`;
}
