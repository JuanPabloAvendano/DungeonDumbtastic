import test from 'node:test';
import assert from 'node:assert';
import {
  computeAc, carryCapacity, totalWeight, encumbrance, weaponAttack, splitCoins, coinsValueGp, formatGp, EQUIPMENT_PRESETS,
} from '../public/js/inventory-rules.js';

const preset = (name) => ({ ...EQUIPMENT_PRESETS.find((p) => p.name === name), qty: 1 });
const hero = (stats, inventory, extra = {}) => ({ ac: 10, level: 1, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...stats }, inventory, ...extra });

test('CA según armadura equipada (SRD 5.1): ligera +Des, media +Des máx. 2, pesada fija, escudo +2', () => {
  assert.deepStrictEqual(computeAc(hero({ dex: 16 }, [{ ...preset('Cuero tachonado'), equipped: true }])).ac, 15);
  assert.strictEqual(computeAc(hero({ dex: 18 }, [{ ...preset('Media armadura'), equipped: true }])).ac, 17);
  assert.strictEqual(computeAc(hero({ dex: 8 }, [{ ...preset('Cota de malla'), equipped: true }])).ac, 16);
  assert.strictEqual(computeAc(hero({ dex: 14 }, [{ ...preset('Cota de malla'), equipped: true }, { ...preset('Escudo'), equipped: true }])).ac, 18);
  assert.strictEqual(computeAc(hero({ dex: 14 }, [{ ...preset('Escudo'), equipped: true }])).ac, 14, 'sin armadura: 10 + Des + escudo');
});

test('sin nada equipado no se toca la CA manual (null)', () => {
  assert.strictEqual(computeAc(hero({}, [{ ...preset('Cota de malla'), equipped: false }])), null);
  assert.strictEqual(computeAc(hero({}, [])), null);
});

test('la CA dice de dónde sale', () => {
  const r = computeAc(hero({ dex: 12 }, [{ ...preset('Cota de escamas'), equipped: true }, { ...preset('Escudo'), equipped: true }]));
  assert.strictEqual(r.ac, 17);
  assert.match(r.source, /Cota de escamas.*Escudo/);
});

test('capacidad de carga = Fuerza × 15 lb; las monedas pesan 1 lb cada 50', () => {
  assert.strictEqual(carryCapacity(hero({ str: 14 }, [])), 210);
  const ch = hero({ str: 10 }, [{ name: 'Cuerda', weight: 10, qty: 2 }, { name: 'Antorcha', weight: 1, qty: 5 }], { coins: { gp: 100, sp: 50 } });
  assert.strictEqual(totalWeight(ch), 28);
});

test('carga: normal, sobrecargado (> Fue×5) y muy sobrecargado (> Fue×10)', () => {
  const at = (w) => encumbrance(hero({ str: 10 }, [{ name: 'x', weight: w, qty: 1 }]));
  assert.strictEqual(at(40).level, 'normal');
  assert.strictEqual(at(60).level, 'sobrecargado');
  assert.strictEqual(at(120).level, 'muy sobrecargado');
  assert.strictEqual(at(160).level, 'excedido');
});

test('ataque con arma: Fue normal, Des a distancia, la mejor con sutileza; + competencia', () => {
  const ch = hero({ str: 16, dex: 12 }, [], { level: 5 });
  assert.deepStrictEqual(weaponAttack(ch, preset('Espada larga')), { toHit: 6, damage: '1d8+3', dmgType: 'cortante' });
  assert.deepStrictEqual(weaponAttack(ch, preset('Arco largo')), { toHit: 4, damage: '1d8+1', dmgType: 'perforante' });
  const nimble = hero({ str: 8, dex: 18 }, [], { level: 1 });
  assert.deepStrictEqual(weaponAttack(nimble, preset('Estoque')), { toHit: 6, damage: '1d8+4', dmgType: 'perforante' });
  assert.strictEqual(weaponAttack(hero({ str: 8 }, []), { ...preset('Maza'), weapon: { ...preset('Maza').weapon, proficient: false } }).damage, '1d6-1');
});

test('repartir monedas entre el grupo: a partes iguales y lo que sobra se queda aparte', () => {
  assert.deepStrictEqual(splitCoins({ gp: 10, sp: 7 }, 3), { each: { cp: 0, sp: 2, ep: 0, gp: 3, pp: 0 }, rest: { cp: 0, sp: 1, ep: 0, gp: 1, pp: 0 } });
  assert.throws(() => splitCoins({ gp: 1 }, 0));
});

test('valor en monedas de oro y su formato', () => {
  assert.strictEqual(coinsValueGp({ cp: 50, sp: 5, ep: 2, gp: 3, pp: 1 }), 15);
  assert.strictEqual(formatGp(0.05), '5 pc');
  assert.strictEqual(formatGp(0.5), '5 pp');
  assert.strictEqual(formatGp(12), '12 po');
});

test('las armaduras y armas de ejemplo traen peso y valor del SRD', () => {
  const chain = preset('Cota de malla');
  assert.strictEqual(chain.weight, 55);
  assert.strictEqual(chain.value, 75);
  assert.ok(EQUIPMENT_PRESETS.filter((p) => p.kind === 'arma').length >= 10);
});
