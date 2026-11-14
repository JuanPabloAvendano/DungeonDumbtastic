// Atacar a un objetivo del tablero: tirada contra su CA, ventana de reacción si es un personaje de
// jugador (Escudo o Esquiva asombrosa) y daño aplicado a la ficha y a la hoja.
const crypto = require('crypto');
const { db, save } = require('./db');
const camp = require('./campaigns');
const dice = require('./dice');
const sc = require('./scenes');
const atk = require('./attack');

const REACTION_MS = Number(process.env.REACTION_MS) || 10000;
const DICE_RE = /^(\d{0,2}d\d{1,3}([+-]\d{1,3})?)([+-]\d{0,2}d\d{1,3}([+-]\d{1,3})?)*$/i;
const REACTIONS = ['escudo', 'esquiva', 'ninguna'];

/**
 * @param {{ io, socket, on, myScene, emitScene, emitCharacters, emitLog }} rt
 */
function registerAttack(rt) {
  const { io, on, myScene, emitScene, emitCharacters, emitLog } = rt;
  // Ataques que impactaron y esperan la reacción del objetivo: id → datos.
  const pending = rt.pendingAttacks || (rt.pendingAttacks = new Map());

  const socketsOf = (c, userId) => [...(io.sockets.adapter.rooms.get(c.id) || [])]
    .map((sid) => io.sockets.sockets.get(sid)).filter((s) => s?.data.userId === userId);
  const log = (c, entry) => emitLog(c, camp.addLog(c, entry));

  /** Tira el daño (doble de dados si fue crítico), lo aplica y lo anuncia. */
  function resolveDamage(c, p, reaction) {
    pending.delete(p.id);
    clearTimeout(p.timer);
    const scene = c.scenes.find((s) => s.id === p.sceneId);
    const target = scene?.tokens.find((t) => t.id === p.targetId);
    if (!target) return;
    const out = atk.reactionOutcome(p, reaction);
    if (!out.hit) {
      log(c, { type: 'chat', name: target.name, text: `🛡 Escudo: el ataque de ${p.attacker} ya no impacta.`, as: true });
      return;
    }
    const result = dice.roll(p.crit ? atk.critExpr(p.damage) : p.damage);
    const amount = out.halve ? Math.floor(result.total / 2) : result.total;
    const applied = atk.applyDamage(scene.tokens, camp.charactersOf(c), target.id, amount);
    scene.tokens = applied.tokens;
    if (applied.character) db().characters = db().characters.map((ch) => (ch.id === applied.character.id ? { ...ch, hp: applied.hp } : ch));
    save();
    log(c, {
      type: 'roll', userId: p.userId, name: p.attacker, as: true, result, natural: null, dc: null, success: null, mode: null, hidden: false,
      label: `Daño a ${target.name}${p.crit ? ' · ¡crítico!' : ''}${out.halve ? ' · mitad (esquiva)' : ''} → ${amount}`,
    });
    emitScene(c, scene);
    if (applied.character) emitCharacters(c);
  }

  on('attack', {}, (c, user, p) => {
    const dm = camp.isDM(user, c);
    const scene = myScene(c, user);
    const gate = sc.rollGate(scene, user.id, { isDM: dm, answeringRequest: false, useReaction: false, characterId: p.characterId || null });
    if (!gate.ok) throw new Error(gate.reason);
    const seen = camp.sceneView(user, c, scene).tokens.find((t) => t.id === p.targetId);
    const target = seen && scene.tokens.find((t) => t.id === p.targetId);
    if (!target) throw new Error('Ese objetivo no está a la vista');
    if (target.kind === 'objeto') throw new Error('Los objetos no se atacan');
    const toHit = String(p.toHit || '1d20').replace(/\s+/g, '');
    const damage = String(p.damage || '').replace(/\s+/g, '');
    if (!atk.TO_HIT_RE.test(toHit)) throw new Error('La tirada de ataque es 1d20 con su modificador (p. ej. 1d20+5)');
    if (!DICE_RE.test(damage)) throw new Error('El daño tiene que ser una tirada (p. ej. 1d8+3)');
    const adv = p.mode === 'adv' || p.mode === 'dis';
    const result = dice.roll(adv ? toHit.replace(/^1?d20/i, p.mode === 'adv' ? '2d20kh1' : '2d20kl1') : toHit);
    const natural = dice.naturalD20(result);
    const ac = atk.targetAc(target, camp.charactersOf(c));
    const { hit, crit } = atk.resolveHit({ total: result.total, natural }, ac);
    const who = camp.speakerFor(user, c, scene, p);
    log(c, {
      type: 'roll', userId: user.id, ...who, result, natural, dc: null, success: hit, mode: adv ? p.mode : null, hidden: false,
      label: `${camp.cleanText(p.label, 50, 'Ataque').trim() || 'Ataque'} → ${target.name}: ${crit ? '¡crítico!' : hit ? 'impacta' : 'falla'}`,
    });
    if (!hit) return { hit: false };

    const attack = { id: crypto.randomUUID(), campaignId: c.id, sceneId: scene.id, targetId: target.id, userId: user.id, attacker: who.name, total: result.total, ac, crit, damage };
    const ch = target.characterId && camp.charactersOf(c).find((x) => x.id === target.characterId);
    const reactor = ch && ch.ownerId !== c.dmId ? ch.ownerId : null;
    const canReact = reactor && !(sc.inCombat(scene) && scene.initiative.reactions?.[target.id]);
    if (!canReact) {
      resolveDamage(c, attack, null);
      return { hit: true };
    }
    attack.timer = setTimeout(() => pending.has(attack.id) && resolveDamage(c, attack, null), REACTION_MS);
    pending.set(attack.id, attack);
    for (const s of socketsOf(c, reactor)) {
      s.emit('attack:incoming', { id: attack.id, attacker: who.name, target: target.name, total: result.total, ac, crit, seconds: REACTION_MS / 1000 });
    }
    return { hit: true, waiting: true };
  });

  on('attack:react', {}, (c, user, { id, kind }) => {
    const attack = pending.get(id);
    if (!attack || attack.campaignId !== c.id) throw new Error('Ya no se puede reaccionar a ese ataque');
    if (!REACTIONS.includes(kind)) throw new Error('Reacción desconocida');
    const scene = c.scenes.find((s) => s.id === attack.sceneId);
    const target = scene?.tokens.find((t) => t.id === attack.targetId);
    const ch = target?.characterId && camp.charactersOf(c).find((x) => x.id === target.characterId);
    if (!ch || ch.ownerId !== user.id) throw new Error('Ese ataque no es contra tu personaje');
    if (kind !== 'ninguna') {
      if (sc.inCombat(scene)) sc.spend(scene, target.id, 'reaction');
      log(c, { type: 'chat', userId: user.id, name: ch.name, img: ch.portrait || null, as: true, text: kind === 'escudo' ? '✨ Reacción: lanza Escudo (+5 CA).' : '💨 Reacción: Esquiva asombrosa (mitad de daño).' });
    }
    resolveDamage(c, attack, kind === 'ninguna' ? null : kind);
    if (sc.inCombat(scene)) emitScene(c, scene);
  });
}

module.exports = { registerAttack };
