// Inventario en el servidor: limpieza de objetos con peso/valor/equipo, monedas y CA recalculada.
const test = require('node:test');
const assert = require('node:assert');
const { cleanItem, cleanCoins } = require('../server/objects');
const { sanitizeCharacter } = require('../server/campaigns');

const chain = { name: 'Cota de malla', kind: 'armadura', armor: { base: 16, type: 'pesada' }, weight: 55, value: 75, qty: 1 };

test('un objeto guarda peso, valor, tipo y datos de arma o armadura (y descarta basura)', () => {
  const it = cleanItem({ ...chain, equipped: true, hack: '<script>' });
  assert.strictEqual(it.weight, 55);
  assert.strictEqual(it.value, 75);
  assert.strictEqual(it.kind, 'armadura');
  assert.deepStrictEqual(it.armor, { base: 16, type: 'pesada' });
  assert.strictEqual(it.equipped, true);
  assert.strictEqual(it.hack, undefined);
  const sword = cleanItem({ name: 'Espada', kind: 'arma', weapon: { damage: '1d8', dmgType: 'cortante', finesse: 1, ranged: false } });
  assert.deepStrictEqual(sword.weapon, { damage: '1d8', dmgType: 'cortante', finesse: true, ranged: false, proficient: true });
});

test('valores raros se corrigen: tipo desconocido, dado inválido, peso negativo', () => {
  const it = cleanItem({ name: 'Cosa', kind: 'nave', weight: -3, value: 'mucho', weapon: { damage: 'rm -rf' } });
  assert.strictEqual(it.kind, 'objeto');
  assert.strictEqual(it.weight, 0);
  assert.strictEqual(it.value, 0);
  assert.strictEqual(it.weapon, undefined, 'solo las armas llevan datos de arma');
  assert.strictEqual(cleanItem({ name: 'x', kind: 'arma', weapon: { damage: 'rm -rf' } }).weapon.damage, '1d4');
});

test('monedas: enteros entre 0 y 999999', () => {
  assert.deepStrictEqual(cleanCoins({ gp: 12.7, sp: -4, pp: '3', cp: 1e9 }), { cp: 999999, sp: 0, ep: 0, gp: 12, pp: 3 });
});

test('con armadura equipada la CA se calcula; al quitarla vuelve la CA escrita a mano', () => {
  const base = { name: 'Thorin', ac: 13, stats: { dex: 14 }, inventory: [{ ...chain, equipped: true }] };
  const armed = sanitizeCharacter(base);
  assert.strictEqual(armed.ac, 16);
  assert.strictEqual(armed.baseAc, 13);
  const bare = sanitizeCharacter({ ...armed, inventory: [{ ...chain, equipped: false }] }, armed);
  assert.strictEqual(bare.ac, 13);
});

test('solo se puede llevar puesta una armadura y un escudo', () => {
  const ch = sanitizeCharacter({ name: 'X', inventory: [{ ...chain, equipped: true }, { ...chain, name: 'Otra', equipped: true }] });
  assert.strictEqual(ch.inventory.filter((i) => i.equipped).length, 1);
});

const { moveItem, moveCoins, addItem } = require('../server/inventory');

const pj = (id, inventory = [], coins = {}) => ({ id, name: id, inventory, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...coins } });

test('dar un objeto: pasa la cantidad pedida, se apila con uno igual y se quita de las manos', () => {
  const a = pj('ana', [{ id: 'i1', name: 'Poción', note: '', kind: 'objeto', qty: 3 }, { id: 'i2', ...chain, equipped: true }]);
  const b = pj('beto', [{ id: 'j1', name: 'Poción', note: '', kind: 'objeto', qty: 1 }]);
  const r = moveItem(a, b, 'i1', 2);
  assert.strictEqual(r.from.inventory.find((i) => i.id === 'i1').qty, 1);
  assert.strictEqual(r.to.inventory.find((i) => i.name === 'Poción').qty, 3);
  const r2 = moveItem(a, b, 'i2', 1);
  assert.ok(!r2.from.inventory.some((i) => i.id === 'i2'));
  assert.strictEqual(r2.to.inventory.find((i) => i.name === 'Cota de malla').equipped, false);
  assert.strictEqual(a.inventory.length, 2, 'no muta el original');
});

test('dar más de lo que se tiene o algo que no existe falla con mensaje claro', () => {
  const a = pj('ana', [{ id: 'i1', name: 'Poción', note: '', kind: 'objeto', qty: 1 }]);
  assert.throws(() => moveItem(a, pj('beto'), 'i1', 2), /Solo tienes 1/);
  assert.throws(() => moveItem(a, pj('beto'), 'nada', 1), /No tienes ese objeto/);
  assert.throws(() => moveItem(a, a, 'i1', 1), /a otro personaje/);
});

test('dar monedas: se restan y se suman; sin saldo no se puede', () => {
  const r = moveCoins(pj('ana', [], { gp: 10, sp: 5 }), pj('beto', [], { gp: 1 }), { gp: 4, sp: 5 });
  assert.deepStrictEqual([r.from.coins.gp, r.from.coins.sp, r.to.coins.gp, r.to.coins.sp], [6, 0, 5, 5]);
  assert.throws(() => moveCoins(pj('ana', [], { gp: 1 }), pj('beto'), { gp: 2 }), /No tienes 2 po/);
  assert.throws(() => moveCoins(pj('ana', [], { gp: 1 }), pj('beto'), {}), /Nada que dar/);
});

test('el botín del DM entra limpio en el inventario', () => {
  const ch = addItem(pj('ana'), { name: 'Gema', value: 50, qty: 2, hack: 1 });
  assert.strictEqual(ch.inventory[0].name, 'Gema');
  assert.strictEqual(ch.inventory[0].value, 50);
  assert.strictEqual(ch.inventory[0].hack, undefined);
  assert.throws(() => addItem(pj('ana'), { name: '' }), /necesita un nombre/);
});
