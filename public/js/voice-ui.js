// Editor de la voz de un personaje (en su hoja) y ajustes de lectura en voz alta (en la mesa).
import { h, clear, field } from './ui.js';
import { VOICE_PRESETS, SPEAK_MODES, speak } from './tts.js';

const SAMPLE = '¡Bienvenidos a la taberna del Dragón Dormido, viajeros!';

/** Voces del navegador en español primero; se rellenan cuando el navegador las carga. */
function voiceSelect(current, onPick) {
  const sel = h('select', { onchange: (e) => onPick(e.target.value) });
  const fill = () => {
    const voices = globalThis.speechSynthesis?.getVoices() || [];
    const sorted = [...voices].sort((a, b) => Number(/^es/i.test(b.lang)) - Number(/^es/i.test(a.lang)));
    clear(sel, h('option', { value: '' }, 'Automática (español)'),
      sorted.map((v) => h('option', { value: v.name, selected: v.name === current }, `${v.name} (${v.lang})`)));
  };
  fill();
  globalThis.speechSynthesis?.addEventListener?.('voiceschanged', fill);
  return sel;
}

/** Sección «Voz» del editor de la hoja: preajuste, voz del equipo, tono, velocidad y prueba. */
export function voiceEditor(c) {
  c.voice = { preset: 'normal', pitch: 1, rate: 1, name: '', ...(c.voice || {}) };
  const set = (patch) => { c.voice = { ...c.voice, ...patch }; };
  const pitchOut = h('small', c.voice.pitch.toFixed(2));
  const rateOut = h('small', c.voice.rate.toFixed(2));
  const pitch = h('input', { type: 'range', min: 0, max: 2, step: 0.05, value: c.voice.pitch, oninput: (e) => { set({ pitch: Number(e.target.value) }); pitchOut.textContent = c.voice.pitch.toFixed(2); } });
  const rate = h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, value: c.voice.rate, oninput: (e) => { set({ rate: Number(e.target.value) }); rateOut.textContent = c.voice.rate.toFixed(2); } });
  const preset = h('select', {
    onchange: (e) => {
      const p = VOICE_PRESETS[e.target.value];
      set({ preset: e.target.value, pitch: p.pitch, rate: p.rate });
      pitch.value = p.pitch; rate.value = p.rate;
      pitchOut.textContent = p.pitch.toFixed(2); rateOut.textContent = p.rate.toFixed(2);
    },
  }, Object.entries(VOICE_PRESETS).map(([k, p]) => h('option', { value: k, selected: k === c.voice.preset }, p.label)));
  const supported = Boolean(globalThis.speechSynthesis);
  return h('div.col.voice-edit',
    h('div.label-mini', 'Voz (para leer el chat en voz alta)'),
    supported ? null : h('p.tiny.muted', 'Este navegador no tiene voces: se guarda igual para los demás.'),
    h('div.grid2',
      field('Estilo', preset),
      field('Voz de este equipo', voiceSelect(c.voice.name, (name) => set({ name })))),
    h('div.grid2',
      h('label.field', h('span', 'Tono ', pitchOut), pitch),
      h('label.field', h('span', 'Velocidad ', rateOut), rate)),
    h('div.row', h('button.btn.small', { type: 'button', disabled: !supported, onclick: () => speak(`${c.name || 'Aventurero'}: ${SAMPLE}`, c.voice) }, '🔊 Probar voz'),
      h('span.tiny.muted', 'Cada equipo tiene sus voces; si falta la elegida, se usa una en español con el mismo tono y velocidad.')));
}

/** Ajustes de lectura en voz alta para la mesa (los guarda cada persona en su navegador). */
export function speechSettings(prefs, savePrefs) {
  const mode = h('select', { onchange: (e) => { prefs.tts = e.target.value; savePrefs(prefs); } },
    SPEAK_MODES.map(([k, label]) => h('option', { value: k, selected: (prefs.tts || 'nada') === k }, label)));
  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: prefs.ttsVolume ?? 1, oninput: (e) => { prefs.ttsVolume = Number(e.target.value); savePrefs(prefs); } });
  return h('div.col',
    h('div.label-mini', 'Leer en voz alta'),
    field('Qué leer', mode),
    field('Volumen de las voces', volume),
    h('p.tiny.muted', 'Cada personaje habla con la voz de su hoja; las criaturas sin hoja tienen una voz propia según su nombre.'));
}
