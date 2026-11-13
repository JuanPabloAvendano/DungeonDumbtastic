// Repara el texto de libros escaneados con OCR que parte las palabras ("w ith" → "with",
// "dam age" → "damage"). Re-segmenta cada racha de fragmentos con la segmentación más probable
// según la frecuencia de cada palabra (como wordninja), aprendida de los libros que salieron limpios.
const fs = require('fs');

const MAX_WORD = 24;
// Un fragmento original que no está en el vocabulario (nombre propio, término raro) se conserva,
// pero cuesta caro: así solo se queda si no hay una lectura mejor.
const UNKNOWN_COST = 30;
const UNKNOWN_SINGLE_COST = 40;
// Coste fijo por palabra: entre dos lecturas igual de probables gana la de menos palabras.
const WORD_PENALTY = 3;
// Un fragmento suelto cuenta como palabra conocida si aparece al menos tantas veces (los errores de OCR
// como «ifyou» también salen en los libros limpios, pero pocas veces).
const KNOWN_MIN = 20;
const RARE_MIN = 3;
// Un libro con más fragmentos sueltos que esto está roto y no sirve para aprender el vocabulario.
const BROKEN_RATIO = 0.06;
const SHORT_WORDS = new Set(['a', 'i', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my',
  'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'ac', 'hp', 'dc', 'xp', 'ft', 'gp', 'sp', 'cp', 'pp', 'ep', 'vs']);
const DICTIONARIES = ['/usr/share/dict/words', '/usr/share/dict/american-english', '/usr/share/dict/cracklib-small'];

const words = (text) => text.toLowerCase().match(/[a-z]+/g) || [];

/** Fracción de fragmentos de 1–2 letras que no son palabras: mide cuánto partió el OCR un libro. */
function brokenRatio(text) {
  const all = words(text);
  if (!all.length) return 0;
  return all.filter((w) => w.length <= 2 && !SHORT_WORDS.has(w)).length / all.length;
}

/**
 * Vocabulario con frecuencias a partir de los libros limpios y, si hay, un diccionario del sistema.
 * @param {string[]} texts texto de todos los libros que se van a importar
 */
function buildVocabulary(texts) {
  const freq = new Map();
  const add = (w, n) => freq.set(w, (freq.get(w) || 0) + n);
  const clean = texts.filter((t) => brokenRatio(t) < BROKEN_RATIO);
  for (const t of clean.length ? clean : texts) for (const w of words(t)) add(w, 1);
  const dict = DICTIONARIES.find((f) => fs.existsSync(f));
  const inDict = new Set(dict ? fs.readFileSync(dict, 'utf8').split('\n').filter((w) => /^[a-z]+$/.test(w)) : []);
  // Los errores del OCR («ofhealth») salen pocas veces: fuera, salvo que estén en el diccionario.
  for (const [w, n] of freq) if (n < RARE_MIN && !inDict.has(w)) freq.delete(w);
  for (const w of inDict) add(w, 0.5);
  for (const w of [...freq.keys()]) if (w.length <= 2 && !SHORT_WORDS.has(w)) freq.delete(w);
  let total = 0;
  for (const n of freq.values()) total += n;
  return { freq, total };
}

/** Mejor segmentación de una racha de fragmentos alfabéticos. */
function segment(tokens, vocab) {
  const s = tokens.join('');
  const low = s.toLowerCase();
  const n = s.length;
  const original = new Set();
  let pos = 0;
  for (const t of tokens) {
    original.add(`${pos}:${pos + t.length}`);
    pos += t.length;
  }
  const cost = (i, j) => {
    const f = vocab.freq.get(low.slice(i, j));
    if (f) return Math.log(vocab.total / f) + WORD_PENALTY;
    // Un fragmento suelto se parte solo si la lectura nueva gana con claridad («Antilife» se queda).
    if (!original.has(`${i}:${j}`)) return null;
    return tokens.length === 1 ? UNKNOWN_SINGLE_COST : UNKNOWN_COST;
  };
  const best = new Float64Array(n + 1).fill(Infinity);
  const back = new Int32Array(n + 1);
  best[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - MAX_WORD); j < i; j++) {
      if (best[j] === Infinity) continue;
      const c = cost(j, i);
      if (c !== null && best[j] + c < best[i]) {
        best[i] = best[j] + c;
        back[i] = j;
      }
    }
  }
  if (best[n] === Infinity) return tokens.join(' ');
  const out = [];
  for (let i = n; i > 0; i = back[i]) out.unshift(s.slice(back[i], i));
  return out.join(' ');
}

/** Repara una línea: solo toca las rachas de fragmentos alfabéticos; números y signos quedan igual. */
function fixLine(line, vocab, { singles = true } = {}) {
  const out = [];
  let run = [];
  // Un fragmento suelto se re-segmenta solo si no es palabra ("Ifyou", "toa"): así no se tocan nombres.
  const known = (w) => (vocab.freq.get(w.toLowerCase()) || 0) >= KNOWN_MIN;
  const flush = () => {
    if (run.length > 1 || (singles && run.length === 1 && run[0].length >= 3 && !known(run[0]))) out.push(segment(run, vocab));
    else if (run.length) out.push(run[0]);
    run = [];
  };
  for (const tok of line.split(/ +/)) {
    // La posesiva («st’s») va con su palabra: cuenta como signo final.
    const m = tok.match(/^([A-Za-z]+)((?:[’']s)?[^A-Za-z0-9]*)$/);
    if (!m) {
      flush();
      out.push(tok);
      continue;
    }
    run.push(m[1]);
    // Un signo al final ("dam age," / "b ea st’s") cierra la racha y se pega a la última palabra.
    if (m[2]) {
      flush();
      out[out.length - 1] += m[2];
    }
  }
  flush();
  return out.join(' ').replace(/ ([,.;:)])/g, '$1');
}

/** Repara un libro entero si está roto; si salió limpio lo deja tal cual. */
function fixText(text, vocab) {
  if (brokenRatio(text) < BROKEN_RATIO) return text;
  return text.split('\n').map((l) => fixLine(l, vocab)).join('\n');
}

module.exports = { buildVocabulary, brokenRatio, fixLine, fixText, segment };
