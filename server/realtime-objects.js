// Usar objetos del tablero en partida: recoger, abrir (con prueba si está cerrado), leer, activar,
// sacar cosas de un contenedor y soltar un objeto del inventario en el mapa.
const crypto = require('crypto');
const { db, save } = require('./db');
const camp = require('./campaigns');
const dice = require('./dice');
const obj = require('./objects');
const sc = require('./scenes');
const { withoutEntry } = require('./realtime-board');

const ABILITY_ES = { str: 'Fuerza', dex: 'Destreza', con: 'Constitución', int: 'Inteligencia', wis: 'Sabiduría', cha: 'Carisma' };
const DROPPED_IMG = '/assets/objects/bolsa.svg';
const USE_VERB = { recoger: 'recoge', abrir: 'abre', leer: 'lee', activar: 'activa', ninguna: 'examina' };

/**
 * @param {{ io, socket, on, myScene, emitScene }} rt
 */
function registerObjects(rt) {
  const { io, on, myScene, emitScene } = rt;

  const say = (c, who, msg) => io.to(c.id).emit('log', camp.addLog(c, { type: 'chat', userId: who.userId, name: who.name, img: who.img, text: msg, as: true }));
  const toDMs = (c, payload) => {
    for (const sid of io.sockets.adapter.rooms.get(c.id) || []) {
      const sock = io.sockets.sockets.get(sid);
      const u = sock && db().users.find((x) => x.id === sock.data.userId);
      if (u && camp.isDM(u, c)) sock.emit('toast', payload);
    }
  };

  /** El objeto, solo si quien lo pide lo ve (no oculto ni en la niebla para un jugador). */
  function visibleObject(c, user, scene, id) {
    const seen = camp.sceneView(user, c, scene).tokens.find((t) => t.id === id);
    const t = seen && scene.tokens.find((x) => x.id === id);
    if (!t || !obj.isObject(t)) throw new Error('Ese objeto no está a la vista');
    return t;
  }

  /** Quién lo usa: la ficha del personaje elegido (o la más cercana del jugador) en esta escena. */
  function actorFor(c, user, scene, characterId, target) {
    const dm = camp.isDM(user, c);
    const mine = scene.tokens.filter((t) => t.characterId && (dm || t.ownerId === user.id));
    const chosen = mine.find((t) => t.characterId === characterId);
    const near = [...mine].sort((a, b) => obj.gapSquares(a, target, scene.grid) - obj.gapSquares(b, target, scene.grid))[0];
    const token = chosen || near;
    const character = token && camp.charactersOf(c).find((ch) => ch.id === token.characterId);
    if (!token || !character) throw new Error('Coloca tu ficha en el mapa para usar objetos');
    if (!dm && !obj.inReach(token, target, scene.grid)) {
      throw new Error(`${character.name} está demasiado lejos: acércate a ${target.object.range === 1 ? '1 casilla' : `${target.object.range} casillas`}`);
    }
    return { token, character, who: { userId: user.id, name: character.name, img: character.portrait || null } };
  }

  const updateCharacter = (id, fn) => {
    db().characters = db().characters.map((ch) => (ch.id === id ? fn(ch) : ch));
  };
  const addToInventory = (charId, item) => updateCharacter(charId, (ch) => {
    const inv = ch.inventory || [];
    const same = inv.find((x) => x.name === item.name && x.note === item.note);
    const next = same ? inv.map((x) => (x === same ? { ...x, qty: x.qty + item.qty } : x)) : [...inv, { ...item, id: crypto.randomUUID() }];
    return { ...ch, inventory: next };
  });
  const setObject = (scene, id, patch) => {
    scene.tokens = scene.tokens.map((t) => (t.id === id ? { ...t, object: { ...t.object, ...patch } } : t));
  };
  const notifyCharacters = (c) => rt.emitCharacters?.(c);

  /** Prueba para abrir algo cerrado: 1d20 + característica del personaje contra la CD. */
  function tryUnlock(c, scene, t, actor) {
    const { ability, dc } = t.object.check;
    const m = Math.floor(((actor.character.stats?.[ability] ?? 10) - 10) / 2);
    const result = dice.roll(`1d20${m >= 0 ? '+' : ''}${m}`);
    const natural = dice.naturalD20(result);
    const success = natural === 20 || (natural !== 1 && result.total >= dc);
    const entry = camp.addLog(c, {
      type: 'roll', userId: actor.who.userId, name: actor.who.name, img: actor.who.img, as: true,
      label: `${ABILITY_ES[ability]} · ${t.name}`, dc, result, natural, success, byDM: false,
    });
    io.to(c.id).emit('log', entry);
    if (success) setObject(scene, t.id, { locked: false });
    return success;
  }

  on('object:interact', {}, (c, user, { id, characterId }) => {
    const scene = myScene(c, user);
    const t = visibleObject(c, user, scene, id);
    const o = t.object;
    const actor = actorFor(c, user, scene, characterId, t);
    if (o.locked && o.use !== 'recoger') {
      if (!o.check) throw new Error(`${t.name} está cerrado: hace falta otra forma de abrirlo`);
      if (!tryUnlock(c, scene, t, actor)) {
        save();
        emitScene(c, scene);
        return { result: `No consigues abrir ${t.name}.` };
      }
    }
    let reply = { result: o.description || `Es ${t.name}.` };
    if (o.use === 'recoger') {
      // Si el objeto trae datos de inventario (peso, valor, arma…), llegan con él.
      addToInventory(actor.character.id, obj.cleanItem({ ...(o.item || {}), name: t.name, note: o.item?.note || o.description, qty: 1, img: t.img }));
      scene.tokens = scene.tokens.filter((x) => x.id !== t.id);
      sc.setInitiative(scene, withoutEntry(scene.initiative, t.id));
      reply = { result: `${t.name} va a tu inventario.` };
      notifyCharacters(c);
    } else if (o.use === 'abrir') {
      setObject(scene, t.id, { open: true, locked: false });
      reply = { result: o.contents.length ? `Dentro hay: ${o.contents.map((x) => x.name).join(', ')}.` : 'Está vacío.' };
    } else if (o.use === 'leer') {
      reply = { result: o.description, title: t.name, text: o.text || '(No hay nada escrito.)' };
    } else if (o.use === 'activar') {
      setObject(scene, t.id, { used: !o.used });
      toDMs(c, { kind: 'info', text: `⚙ ${actor.character.name} ${o.used ? 'desactiva' : 'activa'} «${t.name}»${o.secret ? `: ${o.secret}` : ''}` });
    }
    say(c, actor.who, `${o.use === 'activar' && o.used ? 'desactiva' : USE_VERB[o.use]} «${t.name}».`);
    save();
    emitScene(c, scene);
    return reply;
  });

  on('object:take', {}, (c, user, { id, itemId, characterId }) => {
    const scene = myScene(c, user);
    const t = visibleObject(c, user, scene, id);
    if (t.object.use !== 'abrir' || !t.object.open) throw new Error(`${t.name} no está abierto`);
    const item = t.object.contents.find((x) => x.id === itemId);
    if (!item) throw new Error('Eso ya no está ahí');
    const actor = actorFor(c, user, scene, characterId, t);
    setObject(scene, t.id, { contents: t.object.contents.filter((x) => x.id !== itemId) });
    addToInventory(actor.character.id, item);
    say(c, actor.who, `saca «${item.name}» de «${t.name}».`);
    save();
    emitScene(c, scene);
    notifyCharacters(c);
  });

  // Soltar algo del inventario: aparece en el mapa junto al personaje, como objeto que se puede recoger.
  on('item:drop', {}, (c, user, { characterId, itemId }) => {
    const scene = myScene(c, user);
    const ch = camp.charactersOf(c).find((x) => x.id === characterId && (camp.isDM(user, c) || x.ownerId === user.id));
    const token = ch && scene.tokens.find((t) => t.characterId === ch.id);
    if (!token) throw new Error('Coloca tu ficha en el mapa para soltar objetos');
    const item = (ch.inventory || []).find((x) => x.id === itemId);
    if (!item) throw new Error('No tienes ese objeto');
    updateCharacter(ch.id, (x) => ({
      ...x,
      inventory: item.qty > 1 ? x.inventory.map((i) => (i.id === itemId ? { ...i, qty: i.qty - 1 } : i)) : x.inventory.filter((i) => i.id !== itemId),
    }));
    scene.tokens = [...scene.tokens, {
      id: crypto.randomUUID(), name: item.name, img: item.img || DROPPED_IMG,
      x: token.x + token.size * scene.grid.size, y: token.y, size: 1, ownerId: null, characterId: null,
      hp: 1, maxHp: 1, hidden: false, conditions: [], kind: 'objeto',
      object: obj.cleanObject({ use: 'recoger', description: item.note }),
    }];
    say(c, { userId: user.id, name: ch.name, img: ch.portrait || null }, `suelta «${item.name}».`);
    save();
    emitScene(c, scene);
    notifyCharacters(c);
  });
}

module.exports = { registerObjects };
