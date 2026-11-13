const test = require('node:test');
const assert = require('node:assert');
const fog = require('../server/fog');

const G = 70;
const grid = { size: G, ox: 0, oy: 0, show: true };
const at = (cx, cy, extra = {}) => ({ x: cx * G, y: cy * G, size: 1, ...extra });

function scene(tokens, f = { on: true }) {
  return { grid, tokens, fog: f };
}

test('un personaje ve 6 casillas a su alrededor por defecto', () => {
  const seen = new Set(fog.cellsSeenBy(at(10, 10), fog.DEFAULT_VISION, grid));
  assert.ok(seen.has('10,10'));
  assert.ok(seen.has('16,10'));
  assert.ok(!seen.has('17,10'));
  // En diagonal el círculo llega menos lejos que en línea recta.
  assert.ok(!seen.has('16,16'));
});

test('con niebla el jugador no recibe las fichas que ningún personaje ve', () => {
  const s = scene([
    at(0, 0, { id: 'pj', ownerId: 'u1', characterId: 'c1' }),
    at(4, 0, { id: 'cerca', ownerId: null }),
    at(20, 0, { id: 'lejos', ownerId: null }),
  ]);
  const ids = fog.visibleTokens(s, [], ['u1']).map((t) => t.id);
  assert.deepStrictEqual(ids, ['pj', 'cerca']);
  // Lo que revela el DM también se ve; sin niebla, todo.
  s.fog.revealed = ['20,0'];
  assert.ok(fog.visibleTokens(s, [], ['u1']).some((t) => t.id === 'lejos'));
  assert.strictEqual(fog.visibleTokens(scene(s.tokens, { on: false }), [], ['u1']).length, 3);
});

test('la visión sale de la hoja del personaje (visión en la oscuridad, ceguera)', () => {
  const s = scene([at(0, 0, { id: 'pj', ownerId: 'u1', characterId: 'c1' }), at(10, 0, { id: 'orco', ownerId: null })]);
  assert.ok(!fog.visibleTokens(s, [{ id: 'c1', vision: 6 }], ['u1']).some((t) => t.id === 'orco'));
  assert.ok(fog.visibleTokens(s, [{ id: 'c1', vision: 12 }], ['u1']).some((t) => t.id === 'orco'));
  assert.strictEqual(fog.visibleCells(s, [{ id: 'c1', vision: 0 }], ['u1']).size, 1);
});

test('lo explorado se recuerda y el pincel del DM revela y tapa', () => {
  const pj = at(0, 0, { id: 'pj', ownerId: 'u1' });
  const s = scene([pj]);
  assert.strictEqual(fog.explore(s, [], ['u1']), true);
  assert.strictEqual(fog.explore(s, [], ['u1']), false);
  assert.ok(s.fog.explored.includes('3,0'));
  fog.paint(s, ['30,30', '31,30', 'basura', '<script>'], 'reveal');
  assert.deepStrictEqual(s.fog.revealed, ['30,30', '31,30']);
  fog.paint(s, ['30,30', '3,0'], 'cover');
  assert.deepStrictEqual(s.fog.revealed, ['31,30']);
  assert.ok(!s.fog.explored.includes('3,0'));
  assert.throws(() => fog.paint(s, [], 'borrar'), /desconocido/);
});

test('las fichas ocultas no dan visión', () => {
  const s = scene([at(0, 0, { id: 'pj', ownerId: 'u1', hidden: true }), at(2, 0, { id: 'g', ownerId: null })]);
  assert.deepStrictEqual(fog.visibleTokens(s, [], ['u1']).map((t) => t.id), ['pj']);
});
