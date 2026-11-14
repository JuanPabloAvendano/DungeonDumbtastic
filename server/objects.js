// Objetos del tablero: fichas que no son criaturas (cofres, puertas, palancas, cartas, un amuleto, un
// carruaje). Cada una tiene una función que los jugadores usan acercando su ficha: recoger, abrir,
// leer o activar. Lo secreto (nota del DM, texto de la carta, contenido cerrado) no llega al jugador.
const crypto = require('crypto');

const USES = ['ninguna', 'recoger', 'abrir', 'leer', 'activar'];
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ROTATIONS = [0, 90, 180, 270];
const DEFAULT_RANGE = 1;
const MAX_RANGE = 20;
const CONTENTS_LIMIT = 30;
const INVENTORY_LIMIT = 100;

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const URL_RE = /^\/(uploads|assets)\/[\w./-]+$/;
const safeImg = (v) => (typeof v === 'string' && URL_RE.test(v) && !v.includes('..') ? v : null);

const ITEM_KINDS = ['objeto', 'arma', 'armadura', 'escudo'];
const ARMOR_TYPES = ['ligera', 'media', 'pesada'];
const DICE_RE = /^\d{1,2}d\d{1,3}$/;
const MAX_WEIGHT = 2000;
const MAX_VALUE = 1e6;
const MAX_COINS = 999999;
const COIN_KEYS = ['cp', 'sp', 'ep', 'gp', 'pp'];

/** Número con hasta dos decimales entre 0 y max (peso en libras, valor en po). */
const amount = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 100) / 100)) : 0;
};

function cleanWeapon(w = {}) {
  return {
    damage: DICE_RE.test(w.damage) ? w.damage : '1d4',
    dmgType: text(w.dmgType, 20),
    finesse: Boolean(w.finesse),
    ranged: Boolean(w.ranged),
    proficient: w.proficient !== false,
  };
}

/** Un objeto de inventario o de un contenedor (con peso, valor y, si es equipo, sus datos). */
function cleanItem(it) {
  const name = text(it?.name, 40).trim();
  if (!name) return null;
  const kind = ITEM_KINDS.includes(it.kind) ? it.kind : 'objeto';
  const item = {
    id: text(it.id, 40) || crypto.randomUUID(),
    name,
    note: text(it.note, 400),
    qty: int(it.qty, 1, 999, 1),
    img: safeImg(it.img),
    kind,
    weight: amount(it.weight, MAX_WEIGHT),
    value: amount(it.value, MAX_VALUE),
    equipped: kind !== 'objeto' && Boolean(it.equipped),
  };
  if (kind === 'arma') item.weapon = cleanWeapon(it.weapon);
  if (kind === 'armadura') {
    item.armor = { base: int(it.armor?.base, 10, 30, 11), type: ARMOR_TYPES.includes(it.armor?.type) ? it.armor.type : 'ligera' };
  }
  return item;
}

/** Monedas de un personaje: enteros de 0 a MAX_COINS por tipo. */
function cleanCoins(coins = {}) {
  return Object.fromEntries(COIN_KEYS.map((k) => [k, int(Math.floor(Number(coins?.[k]) || 0), 0, MAX_COINS, 0)]));
}

const cleanItems = (list, limit) => (Array.isArray(list) ? list.slice(0, limit).map(cleanItem).filter(Boolean) : []);

/** Inventario de un personaje (si no llega, se conserva el anterior). */
function cleanInventory(list, prev = []) {
  if (!Array.isArray(list)) return prev;
  // Una sola armadura y un solo escudo puestos: si llegan varios, vale el primero.
  const worn = new Set();
  return cleanItems(list, INVENTORY_LIMIT).map((it) => {
    if (!it.equipped || it.kind === 'arma') return it;
    if (worn.has(it.kind)) return { ...it, equipped: false };
    worn.add(it.kind);
    return it;
  });
}

/** Configuración de un objeto que manda el DM, sobre la que ya tenía. */
function cleanObject(input = {}, prev = {}) {
  const pick = (k, fn) => (input[k] !== undefined ? fn(input[k]) : prev[k]);
  const check = input.check !== undefined
    ? (ABILITIES.includes(input.check?.ability) ? { ability: input.check.ability, dc: int(input.check.dc, 1, 40, 10) } : null)
    : prev.check ?? null;
  return {
    use: pick('use', (v) => (USES.includes(v) ? v : 'ninguna')) || 'ninguna',
    description: pick('description', (v) => text(v, 600)) || '',
    secret: pick('secret', (v) => text(v, 600)) || '',
    text: pick('text', (v) => text(v, 3000)) || '',
    contents: input.contents !== undefined ? cleanItems(input.contents, CONTENTS_LIMIT) : prev.contents || [],
    range: pick('range', (v) => int(v, 1, MAX_RANGE, DEFAULT_RANGE)) || DEFAULT_RANGE,
    check,
    locked: pick('locked', (v) => v === true) || false,
    open: pick('open', (v) => v === true) || false,
    used: pick('used', (v) => v === true) || false,
    rot: pick('rot', (v) => (ROTATIONS.includes(Number(v)) ? Number(v) : 0)) || 0,
    item: input.item !== undefined ? itemData(input.item) : prev.item ?? null,
  };
}

/** Datos de inventario que da un objeto al recogerlo (peso, valor, arma…), sin id ni cantidad. */
function itemData(raw) {
  if (!raw) return null;
  const { id, qty, equipped, ...rest } = cleanItem({ ...raw, name: raw.name || 'Objeto' });
  return rest;
}

/**
 * Lo que un jugador sabe de un objeto: su descripción y su función, pero no la nota del DM, ni el
 * texto de una carta sin leer, ni lo que hay dentro de algo cerrado. De la prueba solo ve la característica.
 */
function publicObject(o = {}) {
  return {
    use: o.use, description: o.description, range: o.range, locked: o.locked, open: o.open, used: o.used, rot: o.rot,
    check: o.check ? { ability: o.check.ability } : null,
    contents: o.use === 'abrir' && o.open ? o.contents : null,
    hasText: Boolean(o.text),
  };
}

const isObject = (t) => t?.kind === 'objeto';

/** Casillas libres entre los bordes de dos fichas (0 = se tocan, contando diagonales). */
function gapSquares(a, b, grid) {
  const g = grid.size;
  const ax2 = a.x + a.size * g;
  const ay2 = a.y + a.size * g;
  const bx2 = b.x + b.size * g;
  const by2 = b.y + b.size * g;
  const dx = Math.max(0, b.x - ax2, a.x - bx2);
  const dy = Math.max(0, b.y - ay2, a.y - by2);
  return Math.round(Math.max(dx, dy) / g);
}

/** ¿Llega la ficha `actor` al objeto? Alcance 1 = tiene que estar al lado. */
function inReach(actor, object, grid) {
  return gapSquares(actor, object, grid) < (object.object?.range || DEFAULT_RANGE);
}

module.exports = {
  USES, ITEM_KINDS, ARMOR_TYPES, COIN_KEYS, cleanObject, publicObject, cleanItem, cleanInventory, cleanCoins, itemData, isObject, gapSquares, inReach,
};
