// La voz de cada personaje se guarda limpia en su hoja.
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeCharacter } = require('../server/campaigns');

test('la voz guarda preajuste, tono, velocidad y nombre, con límites; lo desconocido vuelve a «normal»', () => {
  const ch = sanitizeCharacter({ name: 'Grimbold', voice: { preset: 'robotica', pitch: 9, rate: 0.1, name: 'Microsoft Sabina', hack: 1 } });
  assert.deepStrictEqual(ch.voice, { preset: 'robotica', pitch: 2, rate: 0.5, name: 'Microsoft Sabina' });
  assert.strictEqual(sanitizeCharacter({ name: 'x', voice: { preset: 'dubstep' } }).voice.preset, 'normal');
  const prev = sanitizeCharacter({ name: 'x', voice: { preset: 'grave' } });
  assert.strictEqual(sanitizeCharacter({ name: 'x' }, prev).voice.preset, 'grave', 'si no llega, se conserva');
});
