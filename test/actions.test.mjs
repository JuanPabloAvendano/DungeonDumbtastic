import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { suggestSlots, spend, rest } from '../public/js/actions.js';

const { cleanActions, cleanSlots } = createRequire(import.meta.url)('../server/actions.js');

test('espacios de conjuro sugeridos por clase y nivel (SRD 5.1)', () => {
  assert.deepStrictEqual(suggestSlots('Mago', 1), { 1: { max: 2, used: 0 } });
  assert.deepStrictEqual(Object.values(suggestSlots('Clérigo', 5)).map((s) => s.max), [4, 3, 2]);
  assert.deepStrictEqual(Object.values(suggestSlots('mago', 20)).map((s) => s.max), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  assert.deepStrictEqual(suggestSlots('Paladín', 1), {});
  assert.deepStrictEqual(Object.values(suggestSlots('Paladín', 5)).map((s) => s.max), [4, 2]);
  assert.deepStrictEqual(suggestSlots('Brujo', 5), { 3: { max: 2, used: 0, pact: true } });
  assert.deepStrictEqual(suggestSlots('Brujo', 11), { 5: { max: 3, used: 0, pact: true } });
  assert.strictEqual(suggestSlots('Guerrero', 5), null);
});

test('usar una acción gasta un uso y el espacio elegido; los descansos los devuelven', () => {
  const ch = {
    hp: 3, maxHp: 30,
    actions: [{ id: 'a', name: 'Tomar aliento', uses: { max: 1, used: 0, reset: 'short' } }, { id: 'b', name: 'Furia', uses: { max: 2, used: 0, reset: 'long' } }],
    slots: { 1: { max: 2, used: 0 }, 3: { max: 2, used: 0, pact: true } },
  };
  const after = spend(spend(ch, ch.actions[0], null), ch.actions[1], 1);
  assert.strictEqual(after.actions[0].uses.used, 1);
  assert.strictEqual(after.actions[1].uses.used, 1);
  assert.strictEqual(after.slots[1].used, 1);
  assert.strictEqual(ch.actions[0].uses.used, 0, 'no muta el original');
  const short = rest(spend(after, ch.actions[0], 3), 'short');
  assert.strictEqual(short.actions[0].uses.used, 0);
  assert.strictEqual(short.actions[1].uses.used, 1);
  assert.strictEqual(short.slots[1].used, 1);
  assert.strictEqual(short.slots[3].used, 0, 'el pacto vuelve con descanso corto');
  const long = rest(after, 'long');
  assert.strictEqual(long.actions[1].uses.used, 0);
  assert.strictEqual(long.slots[1].used, 0);
  assert.strictEqual(long.hp, 30);
});

test('el servidor valida acciones y espacios que manda el cliente', () => {
  const [ok, bad] = cleanActions([
    { name: 'Espada larga', kind: 'action', attack: '1d20 + 5', damage: '1d8+3', uses: { max: 3, used: 9, reset: 'raro' } },
    { name: 'Truco raro', kind: 'hackeo', attack: 'rm -rf /', damage: '1d7', spellLevel: 42 },
    { name: '' },
  ]);
  assert.strictEqual(ok.attack, '1d20+5');
  assert.deepStrictEqual(ok.uses, { max: 3, used: 3, reset: 'long' });
  assert.strictEqual(bad.kind, 'action');
  assert.strictEqual(bad.attack, '');
  assert.strictEqual(bad.damage, '');
  assert.strictEqual(bad.spellLevel, 9);
  assert.strictEqual(cleanActions(undefined, ['previas']).length, 1);
  assert.deepStrictEqual(cleanSlots({ 1: { max: 4, used: 9 }, 2: { max: 0 }, 5: { max: 3, pact: true }, 10: { max: 1 } }),
    { 1: { max: 4, used: 4 }, 5: { max: 3, used: 0, pact: true } });
});
