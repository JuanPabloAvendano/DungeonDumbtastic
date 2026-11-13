// Compendio: reparar OCR, trocear un libro y buscar. Con textos inventados (nunca contenido de los libros).
const test = require('node:test');
const assert = require('node:assert');
const { segment, fixLine, brokenRatio } = require('../server/compendium/ocrfix');
const { parseBook } = require('../server/compendium/parse');
const { splitColumns } = require('../server/compendium/columns');
const { Compendium } = require('../server/compendium/search');

const vocab = (() => {
  const words = { with: 50, your: 40, you: 60, if: 40, of: 80, a: 90, damage: 30, choice: 20, magic: 25, the: 100, beast: 10 };
  const freq = new Map(Object.entries(words));
  return { freq, total: [...freq.values()].reduce((x, y) => x + y, 0) };
})();

const BOOK = [
  'Glimmer Bolt\n\n2nd-level evocation\nCasting Time: 1 action\nRange: 60 feet\nComponents: V, S\nDuration: Instantaneous\n'
  + 'Make a ranged spell attack. On a hit the target takes 3 d 8 radiant damage.\n\n'
  + 'Hollow Shield\nabjuration cantrip\nCasting Time: 1 reaction\nRange: Self\nComponents: S\nDuration: 1 round\nYou gain a ward.\n',
  'MOSS LURKER\nSmall plant, unaligned\nArmor Class 13 (natural armor)\nHit Points 11 (2d6 + 4)\nSpeed 20 ft.\n'
  + 'STR\n12 (+1)\nDEX\n14 (+2)\nCON\n15 (+2)\nINT\n3 (-4)\nWIS\n10 (+0)\nCHA\n5 (-3)\nChallenge 1/2 (100 XP)\nACTIONS\n'
  + 'Lash. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 6 (1d8 + 2) bludgeoning damage.\n',
  'Lantern of Quiet\nWondrous item, uncommon\nWhile lit, sounds within 10 feet are muffled. '.repeat(1) + 'A long rules passage about lanterns and silence that keeps going for a while so it becomes a passage. '.repeat(3),
];

test('el OCR roto se vuelve a juntar con la lectura más probable', () => {
  assert.strictEqual(segment(['w', 'ith', 'y', 'our'], vocab), 'with your');
  assert.strictEqual(fixLine('dam age of your ch oice,', { ...vocab, freq: new Map([...vocab.freq, ['choice', 20]]) }), 'damage of your choice,');
  assert.strictEqual(fixLine('Ifyou see a beast', vocab), 'If you see a beast');
  assert.ok(brokenRatio('w h en you ca st th e sp ell') > brokenRatio('when you cast the spell'));
});

test('las dos columnas de una página se leen en orden', () => {
  const left = 'Left column first line here';
  const right = 'Right column text';
  const page = Array.from({ length: 6 }, () => `${left.padEnd(40)}      ${right}`).join('\n');
  const out = splitColumns(page).split('\n').filter(Boolean);
  assert.strictEqual(out[0], left);
  assert.strictEqual(out[out.length - 1], right);
});

test('un libro se trocea en conjuros, monstruos, objetos y pasajes con sus datos', () => {
  const entries = parseBook(BOOK, { id: 'demo' });
  const spell = entries.find((e) => e.title === 'Glimmer Bolt');
  assert.deepStrictEqual([spell.type, spell.meta.level, spell.meta.school, spell.meta.range, spell.page], ['conjuro', 2, 'evocation', '60 feet', 1]);
  assert.match(spell.text, /3d8 radiant/, 'repara los dados partidos');
  assert.strictEqual(entries.find((e) => e.title === 'Hollow Shield').meta.level, 0);
  const monster = entries.find((e) => e.type === 'monstruo');
  assert.strictEqual(monster.title, 'Moss Lurker');
  assert.deepStrictEqual([monster.meta.ac, monster.meta.hp, monster.meta.cr, monster.meta.stats.dex], [13, 11, '1/2', 14]);
  assert.deepStrictEqual(monster.meta.actions, [{ name: 'Lash', attack: '1d20+4', damage: '1d8+2', damageType: 'bludgeoning' }]);
  const item = entries.find((e) => e.type === 'objeto');
  assert.deepStrictEqual([item.title, item.meta.rarity], ['Lantern of Quiet', 'uncommon']);
  assert.ok(entries.some((e) => e.type === 'texto'));
});

test('el buscador ordena por relevancia, tolera erratas, prefijos y busca en español', () => {
  const docs = parseBook(BOOK, { id: 'demo' }).map((e) => ({ ...e, book: 'demo', short: 'DEMO' }));
  const c = new Compendium(docs, [{ id: 'demo', short: 'DEMO' }]);
  assert.strictEqual(c.search('glimmer bolt').results[0].title, 'Glimmer Bolt');
  assert.strictEqual(c.search('glimer').results[0].title, 'Glimmer Bolt', 'errata');
  assert.strictEqual(c.search('moss lur').results[0].title, 'Moss Lurker', 'prefijo mientras se escribe');
  assert.strictEqual(c.search('linterna').results[0].title, 'Lantern of Quiet', 'errata de dos letras (linterna ≈ lantern)');
  assert.strictEqual(c.search('zzzzqqq').total, 0);
  assert.strictEqual(c.search('escudo', { type: 'conjuro' }).results[0].title, 'Hollow Shield', 'escudo → shield');
  assert.strictEqual(c.search('bolt', { level: 0 }).total, 0, 'filtro por nivel');
  assert.ok(c.search('"ranged spell attack"').results.every((r) => r.title === 'Glimmer Bolt'), 'frase exacta');
  assert.match(c.search('radiant').results[0].snippet, /radiant/);
  assert.strictEqual(c.get(docs[0].id).title, 'Glimmer Bolt');
});

test('las traducciones entran al índice: se busca en español y el resultado trae el título traducido', () => {
  const docs = parseBook(BOOK, { id: 'demo' }).map((e) => ({ ...e, book: 'demo', short: 'DEMO' }));
  const c = new Compendium(docs, [{ id: 'demo', short: 'DEMO' }]);
  assert.strictEqual(c.search('resplandeciente').total, 0, 'antes de traducir no hay nada en español');
  const id = docs.find((d) => d.title === 'Glimmer Bolt').id;
  c.addTranslation(id, { title: 'Rayo resplandeciente', text: 'Haz un ataque de conjuro a distancia. Si impacta, 3d8 de daño radiante.' });
  const res = c.search('rayo resplandeciente', { lang: 'es' });
  assert.strictEqual(res.results[0].title, 'Glimmer Bolt');
  assert.strictEqual(res.results[0].titleEs, 'Rayo resplandeciente');
  assert.match(res.results[0].snippet, /daño radiante/);
  assert.strictEqual(c.search('resplandeci', { lang: 'es' }).results[0].id, id, 'prefijo en español');
  assert.strictEqual(c.search('glimmer bolt').results[0].titleEs, undefined, 'en inglés no se mezcla');
});
