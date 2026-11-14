// Dar objetos y monedas entre personajes en partida, y el botín que reparte el DM.
const { db, save } = require('./db');
const camp = require('./campaigns');
const inv = require('./inventory');
const { splitCoins } = require('../public/js/inventory-rules.js');

/**
 * @param {{ io, on, emitCharacters }} rt
 */
function registerInventory(rt) {
  const { io, on, emitCharacters } = rt;

  const say = (c, who, text) => io.to(c.id).emit('log', camp.addLog(c, { type: 'chat', ...who, text, as: true }));
  const voice = (user, ch) => ({ userId: user.id, name: ch.name, img: ch.portrait || null });
  const find = (c, id) => {
    const ch = camp.charactersOf(c).find((x) => x.id === id);
    if (!ch) throw new Error('Ese personaje no está en la campaña');
    return ch;
  };
  /** Un personaje propio (o cualquiera, si es el DM). */
  const mine = (c, user, id) => {
    const ch = find(c, id);
    if (!camp.isDM(user, c) && ch.ownerId !== user.id) throw new Error('Ese personaje no es tuyo');
    return ch;
  };
  /** Guarda los personajes cambiados pasándolos por la limpieza (recalcula la CA si cambió la armadura). */
  const store = (c, changed) => {
    const byId = new Map(changed.map((ch) => [ch.id, ch]));
    db().characters = db().characters.map((ch) => (byId.has(ch.id) ? camp.sanitizeCharacter(byId.get(ch.id), ch) : ch));
    save();
    emitCharacters(c);
  };

  on('item:give', {}, (c, user, { fromId, toId, itemId, qty }) => {
    const from = mine(c, user, fromId);
    const to = find(c, toId);
    const r = inv.moveItem(from, to, itemId, qty);
    store(c, [r.from, r.to]);
    say(c, voice(user, from), `le da ${r.item.qty > 1 ? `${r.item.qty} × ` : ''}«${r.item.name}» a ${to.name}.`);
  });

  on('coins:give', {}, (c, user, { fromId, toId, coins }) => {
    const from = mine(c, user, fromId);
    const to = find(c, toId);
    const r = inv.moveCoins(from, to, coins);
    store(c, [r.from, r.to]);
    say(c, voice(user, from), `le da ${inv.coinsText(r.coins)} a ${to.name}.`);
  });

  // Botín del DM: un objeto para un personaje, o monedas repartidas a partes iguales entre varios.
  on('loot:give', { dmOnly: true }, (c, user, { toIds, item, coins }) => {
    const targets = [...new Set(Array.isArray(toIds) ? toIds : [])].map((id) => find(c, id));
    if (!targets.length) throw new Error('Elige a quién darle el botín');
    if (item) {
      if (targets.length > 1) throw new Error('Un objeto va a un solo personaje');
      const [to] = targets;
      store(c, [inv.addItem(to, item)]);
      say(c, { userId: user.id, name: user.displayName }, `🎁 ${to.name} recibe «${item.name}».`);
      return {};
    }
    const { each, rest } = splitCoins(coins, targets.length);
    if (!inv.coinsText(each)) throw new Error('No alcanza para repartir: pon más monedas');
    store(c, targets.map((to) => inv.addCoins(to, each)));
    const names = targets.map((t) => t.name).join(', ');
    say(c, { userId: user.id, name: user.displayName }, `💰 Botín: ${inv.coinsText(each)} para cada uno (${names}).`);
    return { rest };
  });
}

module.exports = { registerInventory };
