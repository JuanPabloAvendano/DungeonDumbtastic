// Ataque contra CA: impacto, crítico y pifia, reacciones (Escudo, Esquiva asombrosa) y daño aplicado.
const test = require('node:test');
const assert = require('node:assert');
const { resolveHit, critExpr, reactionOutcome, applyDamage, targetAc, TO_HIT_RE } = require('../server/attack');

test('impacta si iguala o supera la CA; el 20 natural siempre impacta (crítico) y el 1 siempre falla', () => {
  assert.deepStrictEqual(resolveHit({ total: 15, natural: 10 }, 15), { hit: true, crit: false });
  assert.deepStrictEqual(resolveHit({ total: 14, natural: 9 }, 15), { hit: false, crit: false });
  assert.deepStrictEqual(resolveHit({ total: 22, natural: 20 }, 30), { hit: true, crit: true });
  assert.deepStrictEqual(resolveHit({ total: 31, natural: 1 }, 10), { hit: false, crit: false });
});

test('en un crítico se doblan los dados de daño, no el modificador', () => {
  assert.strictEqual(critExpr('1d8+3'), '2d8+3');
  assert.strictEqual(critExpr('2d6+1d4-1'), '4d6+2d4-1');
  assert.strictEqual(critExpr('d12'), '2d12');
});

test('Escudo suma +5 a la CA y puede convertir el impacto en fallo (salvo crítico); Esquiva divide el daño', () => {
  assert.deepStrictEqual(reactionOutcome({ total: 17, ac: 15, crit: false }, 'escudo'), { hit: false, halve: false });
  assert.deepStrictEqual(reactionOutcome({ total: 21, ac: 15, crit: false }, 'escudo'), { hit: true, halve: false });
  assert.deepStrictEqual(reactionOutcome({ total: 17, ac: 15, crit: true }, 'escudo'), { hit: true, halve: false });
  assert.deepStrictEqual(reactionOutcome({ total: 17, ac: 15, crit: false }, 'esquiva'), { hit: true, halve: true });
  assert.deepStrictEqual(reactionOutcome({ total: 17, ac: 15, crit: false }, null), { hit: true, halve: false });
});

test('el daño baja los PG de la ficha y, si es un personaje, también los de su hoja (sin bajar de 0)', () => {
  const tokens = [{ id: 't1', hp: 7, maxHp: 7 }, { id: 't2', characterId: 'c1', hp: 20, maxHp: 20 }];
  const chars = [{ id: 'c1', hp: 20, maxHp: 20 }];
  const a = applyDamage(tokens, chars, 't1', 10);
  assert.strictEqual(a.tokens[0].hp, 0);
  assert.strictEqual(a.character, null);
  const b = applyDamage(tokens, chars, 't2', 6);
  assert.strictEqual(b.tokens[1].hp, 14);
  assert.strictEqual(b.character.hp, 14);
  assert.strictEqual(tokens[1].hp, 20, 'no muta');
});

test('CA del objetivo: la de su hoja si es personaje; si no, la de la ficha (10 por defecto)', () => {
  assert.strictEqual(targetAc({ characterId: 'c1' }, [{ id: 'c1', ac: 18 }]), 18);
  assert.strictEqual(targetAc({ ac: 13 }, []), 13);
  assert.strictEqual(targetAc({}, []), 10);
});

test('la tirada de ataque tiene que ser 1d20 con modificador', () => {
  assert.ok(TO_HIT_RE.test('1d20+5'));
  assert.ok(TO_HIT_RE.test('d20-1'));
  assert.ok(!TO_HIT_RE.test('8d6'));
});
