// Mover cosas entre personajes: dar un objeto, dar monedas y repartir botín. Funciones puras: reciben
// personajes y devuelven copias nuevas, para que el que llama decida cuándo guardar.
const crypto = require('crypto');
const { cleanItem, cleanCoins } = require('./objects');

const COIN_LABEL = { cp: 'pc', sp: 'pp', ep: 'pe', gp: 'po', pp: 'ppt' };
const sameStack = (a, b) => a.name === b.name && (a.note || '') === (b.note || '') && (a.kind || 'objeto') === (b.kind || 'objeto');

/** Añade un objeto (ya limpio) al inventario, apilándolo si hay uno igual. */
function stack(inventory, item) {
  const same = inventory.find((x) => sameStack(x, item) && !x.equipped);
  if (same) return inventory.map((x) => (x === same ? { ...x, qty: x.qty + item.qty } : x));
  return [...inventory, { ...item, id: crypto.randomUUID() }];
}

/** Da `qty` unidades del objeto `itemId` de `from` a `to`. Lo que cambia de manos deja de estar equipado. */
function moveItem(from, to, itemId, qty = 1) {
  if (from.id === to.id) throw new Error('Elige a otro personaje para dárselo');
  const item = (from.inventory || []).find((x) => x.id === itemId);
  if (!item) throw new Error('No tienes ese objeto');
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  if (n > item.qty) throw new Error(`Solo tienes ${item.qty}`);
  const left = item.qty - n;
  return {
    item: { ...item, qty: n },
    from: { ...from, inventory: left ? from.inventory.map((x) => (x.id === itemId ? { ...x, qty: left } : x)) : from.inventory.filter((x) => x.id !== itemId) },
    to: { ...to, inventory: stack(to.inventory || [], { ...item, qty: n, equipped: false }) },
  };
}

/** Pasa monedas de un personaje a otro; falla si no le alcanza. */
function moveCoins(from, to, coins) {
  if (from.id === to.id) throw new Error('Elige a otro personaje para dárselas');
  const amount = cleanCoins(coins);
  if (!Object.values(amount).some(Boolean)) throw new Error('Nada que dar');
  const have = cleanCoins(from.coins);
  for (const [k, n] of Object.entries(amount)) {
    if (n > have[k]) throw new Error(`No tienes ${n} ${COIN_LABEL[k]}`);
  }
  const theirs = cleanCoins(to.coins);
  return {
    coins: amount,
    from: { ...from, coins: Object.fromEntries(Object.entries(have).map(([k, v]) => [k, v - amount[k]])) },
    to: { ...to, coins: Object.fromEntries(Object.entries(theirs).map(([k, v]) => [k, v + amount[k]])) },
  };
}

/** Suma monedas (botín del DM) a un personaje. */
function addCoins(ch, coins) {
  const have = cleanCoins(ch.coins);
  const add = cleanCoins(coins);
  return { ...ch, coins: cleanCoins(Object.fromEntries(Object.entries(have).map(([k, v]) => [k, v + add[k]]))) };
}

/** Mete un objeto nuevo (botín del DM) en el inventario de un personaje. */
function addItem(ch, raw) {
  const item = cleanItem(raw);
  if (!item) throw new Error('El objeto necesita un nombre');
  return { ...ch, inventory: stack(ch.inventory || [], { ...item, equipped: false }) };
}

/** «3 po, 5 pp» para anunciar en el chat. */
const coinsText = (coins) => Object.entries(cleanCoins(coins)).filter(([, n]) => n).map(([k, n]) => `${n} ${COIN_LABEL[k]}`).join(', ');

module.exports = { moveItem, moveCoins, addCoins, addItem, coinsText };
