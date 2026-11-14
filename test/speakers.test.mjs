import test from 'node:test';
import assert from 'node:assert';
import { findSpeakers, splitMention } from '../public/js/speakers.js';

const OPTS = [['', 'Juan (DM)'], ['c:1', 'Thorin Escudo de Roble (NPC)'], ['t:2', 'Goblin 1'], ['t:3', 'Goblin 2'], ['c:4', 'Élara (PJ)']];

test('busca personajes por cualquier parte del nombre, sin tildes ni mayúsculas', () => {
  assert.deepStrictEqual(findSpeakers(OPTS, 'gob').map(([v]) => v), ['t:2', 't:3']);
  assert.deepStrictEqual(findSpeakers(OPTS, 'elara').map(([v]) => v), ['c:4']);
  assert.deepStrictEqual(findSpeakers(OPTS, 'roble').map(([v]) => v), ['c:1']);
  assert.strictEqual(findSpeakers(OPTS, '').length, OPTS.length);
});

test('los nombres que empiezan por lo buscado salen primero', () => {
  const opts = [['a', 'Gran Thorin'], ['b', 'Thorin']];
  assert.deepStrictEqual(findSpeakers(opts, 'thor').map(([v]) => v), ['b', 'a']);
});

test('@nombre al principio del mensaje cambia quién habla y se quita del texto', () => {
  assert.deepStrictEqual(splitMention(OPTS, '@thorin ¡A las armas!'), { value: 'c:1', text: '¡A las armas!' });
  assert.deepStrictEqual(splitMention(OPTS, '@goblin2 grr'), { value: 't:3', text: 'grr' });
});

test('@ ambiguo, desconocido o en medio del texto no cambia nada', () => {
  assert.strictEqual(splitMention(OPTS, '@goblin grr'), null);
  assert.strictEqual(splitMention(OPTS, '@nadie hola'), null);
  assert.strictEqual(splitMention(OPTS, 'hola @thorin'), null);
});

test('nombres repetidos se numeran para poder distinguirlos en la lista', async () => {
  const { uniqueLabels } = await import('../public/js/speakers.js');
  const out = uniqueLabels([['t:1', 'Goblin'], ['t:2', 'Goblin'], ['t:3', 'Lobo'], ['t:4', 'Goblin']]);
  assert.deepStrictEqual(out.map(([, l]) => l), ['Goblin', 'Goblin 2', 'Lobo', 'Goblin 3']);
});
