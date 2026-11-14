import test from 'node:test';
import assert from 'node:assert';
import { VOICE_PRESETS, voiceSettings, pickVoice, speechText, shouldSpeak, voiceForName } from '../public/js/tts.js';

const VOICES = [
  { name: 'Google español', lang: 'es-ES', voiceURI: 'g-es' },
  { name: 'Microsoft Sabina', lang: 'es-MX', voiceURI: 'ms-sabina' },
  { name: 'English US', lang: 'en-US', voiceURI: 'en' },
];

test('los preajustes dan tono y velocidad; lo personalizado manda y se limita a lo que acepta el navegador', () => {
  assert.deepStrictEqual(voiceSettings({ preset: 'robotica' }), { pitch: VOICE_PRESETS.robotica.pitch, rate: VOICE_PRESETS.robotica.rate, name: '' });
  assert.deepStrictEqual(voiceSettings({ preset: 'normal', pitch: 1.5, rate: 3 }), { pitch: 1.5, rate: 2, name: '' });
  assert.deepStrictEqual(voiceSettings(undefined), { pitch: 1, rate: 1, name: '' });
});

test('elige la voz pedida; si este equipo no la tiene, una en español', () => {
  assert.strictEqual(pickVoice(VOICES, 'Microsoft Sabina').name, 'Microsoft Sabina');
  assert.strictEqual(pickVoice(VOICES, 'Loquendo Jorge').lang.startsWith('es'), true);
  assert.strictEqual(pickVoice([], 'x'), null);
});

test('el texto que se lee no lleva emojis, tiradas ni marcas', () => {
  assert.strictEqual(speechText('🎒 usa «Poción» — **cura** 2d4+2'), 'usa Poción, cura 2d4+2');
  assert.strictEqual(speechText('/r 1d20+5'), '');
});

test('qué se lee según el ajuste: nada, solo diálogos de NPC o todo el chat (nunca lo propio)', () => {
  const npc = { type: 'chat', dialog: true, text: 'Hola viajeros', userId: 'dm' };
  const plain = { type: 'chat', text: 'jaja', userId: 'p2' };
  const roll = { type: 'roll', userId: 'p2' };
  assert.strictEqual(shouldSpeak(npc, 'nada', 'p1'), false);
  assert.strictEqual(shouldSpeak(npc, 'dialogos', 'p1'), true);
  assert.strictEqual(shouldSpeak(plain, 'dialogos', 'p1'), false);
  assert.strictEqual(shouldSpeak(plain, 'todo', 'p1'), true);
  assert.strictEqual(shouldSpeak(roll, 'todo', 'p1'), false);
  assert.strictEqual(shouldSpeak(plain, 'todo', 'p2'), false, 'lo que escribo yo no me lo lee');
});

test('una criatura sin hoja suena siempre igual (voz derivada de su nombre)', () => {
  assert.deepStrictEqual(voiceForName('Goblin'), voiceForName('Goblin'));
  assert.notDeepStrictEqual(voiceForName('Goblin'), voiceForName('Dragón rojo anciano'));
  const v = voiceForName('Goblin');
  assert.ok(v.pitch >= 0.5 && v.pitch <= 1.6 && v.rate >= 0.8 && v.rate <= 1.25);
});

test('el DM sí oye a sus propios NPC y criaturas (cuando habla como ellos), pero no a sí mismo', () => {
  const asNpc = { type: 'chat', text: 'Bienvenidos', userId: 'dm', as: true };
  const asSelf = { type: 'chat', text: 'pausa para pizza', userId: 'dm' };
  assert.strictEqual(shouldSpeak(asNpc, 'todo', 'dm', { isDM: true }), true);
  assert.strictEqual(shouldSpeak(asSelf, 'todo', 'dm', { isDM: true }), false);
  assert.strictEqual(shouldSpeak({ ...asNpc, dialog: true }, 'dialogos', 'dm', { isDM: true }), true);
  assert.strictEqual(shouldSpeak(asNpc, 'dialogos', 'dm', { isDM: true }), false, 'en «solo diálogos» sigue haciendo falta el 📜');
  assert.strictEqual(shouldSpeak({ ...asNpc, userId: 'p1' }, 'todo', 'p1', { isDM: false }), false, 'un jugador no se oye a sí mismo');
});
