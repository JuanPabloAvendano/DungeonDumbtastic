const test = require('node:test');
const assert = require('node:assert');
const { roll, naturalD20 } = require('../server/dice');

test('suma dados y modificador', () => {
  const r = roll('2d6+3');
  assert.strictEqual(r.groups.length, 1);
  assert.strictEqual(r.groups[0].values.length, 2);
  assert.strictEqual(r.total, r.groups[0].values[0] + r.groups[0].values[1] + 3);
  r.groups[0].values.forEach((v) => assert.ok(v >= 1 && v <= 6));
});

test('ventaja se queda con el d20 más alto', () => {
  for (let i = 0; i < 50; i++) {
    const r = roll('2d20kh1+2');
    const [a, b] = r.groups[0].values;
    assert.strictEqual(r.total, Math.max(a, b) + 2);
    assert.strictEqual(naturalD20(r), Math.max(a, b));
  }
});

test('desventaja se queda con el más bajo', () => {
  const r = roll('2d20kl1');
  assert.strictEqual(r.total, Math.min(...r.groups[0].values));
});

test('modificador negativo y d100', () => {
  const r = roll('d100-5');
  assert.strictEqual(r.total, r.groups[0].values[0] - 5);
  assert.ok(r.groups[0].values[0] >= 1 && r.groups[0].values[0] <= 100);
});

test('rechaza expresiones inválidas', () => {
  assert.throws(() => roll(''), /vacía/);
  assert.throws(() => roll('1d7'), /no soportado/);
  assert.throws(() => roll('99d6'), /Máximo/);
  assert.throws(() => roll('2d6; rm -rf'), /No entiendo/);
  assert.throws(() => roll('abc'), /No entiendo/);
});

const { uniqueName, withoutEntry } = require('../server/realtime');

test('numera nombres repetidos de fichas', () => {
  const tokens = [{ name: 'Goblin' }, { name: 'Goblin 2' }];
  assert.strictEqual(uniqueName(tokens, 'Goblin'), 'Goblin 3');
  assert.strictEqual(uniqueName(tokens, 'Lobo'), 'Lobo');
});

test('quitar una ficha anterior en la iniciativa no salta el turno', () => {
  const ini = { entries: [{ tokenId: 'a' }, { tokenId: 'b' }, { tokenId: 'c' }], turn: 2, round: 3 };
  const next = withoutEntry(ini, 'a');
  assert.strictEqual(next.entries[next.turn].tokenId, 'c');
  assert.strictEqual(next.round, 3);
});
