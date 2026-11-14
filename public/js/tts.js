// Lectura en voz alta del chat con las voces del navegador (Web Speech API): gratis y sin instalar.
// Cada personaje tiene su voz (preajuste, tono, velocidad y, si existe en este equipo, una voz concreta).
// La parte de decidir (qué se lee, con qué voz) no toca el navegador, para poder probarla en Node.

export const VOICE_PRESETS = {
  normal: { label: 'Normal', pitch: 1, rate: 1 },
  grave: { label: 'Grave', pitch: 0.6, rate: 0.92 },
  aguda: { label: 'Aguda', pitch: 1.5, rate: 1.05 },
  robotica: { label: 'Robótica clásica', pitch: 0.75, rate: 0.85 },
  rapida: { label: 'Rápida', pitch: 1.1, rate: 1.4 },
};
export const SPEAK_MODES = [['nada', 'No leer nada'], ['dialogos', 'Solo diálogos de NPC (📜)'], ['todo', 'Todo el chat']];

const clamp = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback);

/** Tono y velocidad finales: lo personalizado manda sobre el preajuste (límites del navegador). */
export function voiceSettings(voice = {}) {
  const base = VOICE_PRESETS[voice?.preset] || VOICE_PRESETS.normal;
  return { pitch: clamp(voice?.pitch, 0, 2, base.pitch), rate: clamp(voice?.rate, 0.5, 2, base.rate), name: voice?.name || '' };
}

/** La voz pedida si este equipo la tiene; si no, la primera en español; si no, null (la del sistema). */
export function pickVoice(voices, name) {
  return voices.find((v) => v.name === name) || voices.find((v) => /^es\b/i.test(v.lang)) || null;
}

/** Texto limpio para leer: sin emojis, comillas angulares, negritas ni comandos. */
export function speechText(text) {
  const t = String(text || '').trim();
  if (t.startsWith('/')) return '';
  return t.replace(/\p{Extended_Pictographic}️?/gu, '').replace(/[«»*_`#]/g, '').replace(/\s+—\s+/g, ', ').replace(/\s+/g, ' ').trim();
}

/** ¿Se lee esta entrada del chat con el ajuste elegido? Nunca lo que escribe uno mismo. */
export function shouldSpeak(entry, mode, myId) {
  if (mode === 'nada' || entry.type !== 'chat' || entry.userId === myId) return false;
  return mode === 'todo' || (mode === 'dialogos' && entry.dialog === true);
}

/** Voz estable para quien no tiene hoja (una criatura): sale de su nombre. */
export function voiceForName(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return { pitch: 0.5 + (hash % 110) / 100, rate: 0.8 + ((hash >> 8) % 45) / 100, name: '' };
}

/** Lee un texto con una voz (en el navegador). Devuelve false si no hay síntesis de voz. */
export function speak(text, voice, volume = 1) {
  const synth = globalThis.speechSynthesis;
  const clean = speechText(text);
  if (!synth || !clean) return false;
  const v = voiceSettings(voice);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'es-ES';
  u.pitch = v.pitch;
  u.rate = v.rate;
  u.volume = clamp(volume, 0, 1, 1);
  const chosen = pickVoice(synth.getVoices(), v.name);
  if (chosen) {
    u.voice = chosen;
    u.lang = chosen.lang;
  }
  synth.speak(u);
  return true;
}
