// Buscador del compendio: índice invertido con BM25, títulos con más peso, prefijos (para buscar
// mientras se escribe), tolerancia a erratas, términos en español traducidos al inglés de los libros
// y, si no sale nada, una búsqueda sin espacios para los restos del OCR («fire ball» = «fireball»).
const fs = require('fs');
const path = require('path');
const { GLOSSARY, PHRASES } = require('./glossary');

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_WEIGHT = 4;
// Los pasajes sueltos pesan menos que una entrada con nombre (conjuro, monstruo, objeto).
const PASSAGE_FACTOR = 0.55;
const EXACT_TITLE_BONUS = 25;
const TITLE_PREFIX_BONUS = 8;
const PREFIX_LIMIT = 40;
const FUZZY_LIMIT = 8;
const SQUASH_MIN = 5;
const SNIPPET_RADIUS = 130;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'de', 'la', 'el', 'los', 'las', 'del', 'y', 'o', 'en', 'un', 'una']);

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s) => normalize(s).replace(/ /g, '');

/** Raíz ligera en inglés: «spells» = «spell», «healing» = «heal», «wolves» → «wolve» en ambos lados. */
function stem(w) {
  if (w.length <= 3 || /^\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const terms = (s) => normalize(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);

/** Búsqueda normalizada con las frases en español ya pasadas al inglés de los libros. */
function translate(query) {
  let q = normalize(query);
  for (const [es, en] of Object.entries(PHRASES)) q = q.replace(new RegExp(`\\b${es}\\b`, 'g'), en);
  return q;
}

/** Distancia de edición con tope: deja de contar en cuanto pasa de `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

class Compendium {
  /** @param {Array<{ id, type, title, page, text, meta, book, short }>} docs */
  constructor(docs, books) {
    this.docs = docs;
    this.books = books;
    this.byId = new Map(docs.map((d, i) => [d.id, i]));
    this.postings = new Map();
    this.lengths = new Float64Array(docs.length);
    docs.forEach((d, i) => this.indexDoc(d, i));
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
    this.vocab = [...this.postings.keys()].sort();
    this.squashed = docs.map((d) => squash(`${d.title} ${d.text}`));
    this.normTitles = docs.map((d) => normalize(d.title));
    this.normTitlesEs = docs.map(() => '');
    this.vocabDirty = false;
  }

  indexDoc(d, i) {
    const tf = new Map();
    const add = (t, w) => tf.set(t, (tf.get(t) || 0) + w);
    terms(d.title).forEach((t) => add(t, TITLE_WEIGHT));
    const body = terms(d.text);
    body.forEach((t) => add(t, 1));
    this.lengths[i] = body.length + TITLE_WEIGHT * terms(d.title).length;
    for (const [t, n] of tf) {
      if (!this.postings.has(t)) this.postings.set(t, []);
      this.postings.get(t).push([i, n]);
    }
  }

  /**
   * Añade al índice la traducción de una entrada: así «bola de fuego» o «dados de golpe» encuentran
   * el texto aunque el libro esté en inglés.
   */
  addTranslation(id, es) {
    const i = this.byId.get(id);
    if (i === undefined || this.docs[i].es) return;
    this.docs[i] = { ...this.docs[i], es };
    const tf = new Map();
    const add = (t, w) => tf.set(t, (tf.get(t) || 0) + w);
    terms(es.title).forEach((t) => add(t, TITLE_WEIGHT));
    terms(es.text).forEach((t) => add(t, 1));
    for (const [t, n] of tf) {
      if (!this.postings.has(t)) {
        this.postings.set(t, []);
        this.vocabDirty = true;
      }
      const list = this.postings.get(t);
      const own = list.find(([d]) => d === i);
      if (own) own[1] += n;
      else list.push([i, n]);
    }
    this.normTitlesEs[i] = normalize(es.title);
  }

  /** Términos del índice que empiezan por `p` (búsqueda binaria en el vocabulario ordenado). */
  prefixed(p) {
    this.refreshVocab();
    let lo = 0;
    let hi = this.vocab.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.vocab[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    const out = [];
    for (let k = lo; k < this.vocab.length && this.vocab[k].startsWith(p) && out.length < PREFIX_LIMIT; k++) out.push(this.vocab[k]);
    return out;
  }

  /** Términos parecidos para una errata («firebal», «goblim»). */
  refreshVocab() {
    if (!this.vocabDirty) return;
    this.vocab = [...this.postings.keys()].sort();
    this.vocabDirty = false;
  }

  fuzzy(t) {
    if (t.length < 4) return [];
    this.refreshVocab();
    const max = t.length >= 7 ? 2 : 1;
    return this.vocab.filter((v) => v[0] === t[0] && Math.abs(v.length - t.length) <= max && editDistance(t, v, max) <= max)
      .sort((a, b) => this.postings.get(b).length - this.postings.get(a).length).slice(0, FUZZY_LIMIT);
  }

  /**
   * Cada palabra de la búsqueda se convierte en un grupo de alternativas (ella, su traducción,
   * sus prefijos si es la última, o sus erratas si no está en el índice).
   */
  expand(query) {
    const words = translate(query).split(' ').filter((w) => w && !STOP.has(w));
    return words.map((w, i) => {
      const alts = new Set([stem(w), ...(GLOSSARY[w] || []).flatMap((x) => terms(x))]);
      const last = i === words.length - 1;
      if (last && w.length >= 3) this.prefixed(w).forEach((p) => alts.add(p));
      if ([...alts].every((a) => !this.postings.has(a))) this.fuzzy(stem(w)).forEach((f) => alts.add(f));
      return [...alts].filter((a) => this.postings.has(a));
    }).filter((g) => g.length);
  }

  bm25(term, doc, n) {
    const df = this.postings.get(term).length;
    const idf = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
    const norm = n * (BM25_K1 + 1) / (n + BM25_K1 * (1 - BM25_B + BM25_B * this.lengths[doc] / this.avgLength));
    return idf * norm;
  }

  /**
   * @param {string} query
   * @param {{ type?:string, book?:string, level?:number|null, limit?:number }} opts
   */
  search(query, { type = '', book = '', level = null, limit = DEFAULT_LIMIT, lang = 'en' } = {}) {
    const max = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
    const allowed = (i) => {
      const d = this.docs[i];
      return (!type || d.type === type) && (!book || d.book === book) && (level === null || d.meta?.level === level);
    };
    const phrases = [...String(query).matchAll(/"([^"]+)"/g)].map((m) => normalize(m[1]));
    const groups = this.expand(String(query).replace(/"/g, ' '));
    const scores = new Map();
    const hits = new Map();
    groups.forEach((group) => {
      const best = new Map();
      for (const t of group) {
        for (const [doc, n] of this.postings.get(t)) {
          if (!allowed(doc)) continue;
          const sc = this.bm25(t, doc, n);
          if (sc > (best.get(doc) || 0)) best.set(doc, sc);
        }
      }
      for (const [doc, sc] of best) {
        scores.set(doc, (scores.get(doc) || 0) + sc);
        hits.set(doc, (hits.get(doc) || 0) + 1);
      }
    });
    // Primero los que tienen todas las palabras; si no hay ninguno, los que tienen alguna.
    let found = [...scores.keys()].filter((d) => hits.get(d) === groups.length);
    if (!found.length) found = [...scores.keys()];
    if (phrases.length) found = found.filter((d) => phrases.every((p) => normalize(`${this.docs[d].title} ${this.docs[d].text}`).includes(p)));
    const q = translate(query.replace(/"/g, ''));
    if (found.length < 3 && squash(query).length >= SQUASH_MIN) {
      const sq = squash(query);
      this.squashed.forEach((s, d) => { if (allowed(d) && !scores.has(d) && s.includes(sq)) { found.push(d); scores.set(d, 1); } });
    }
    const ranked = found.map((d) => {
      let sc = scores.get(d);
      const qn = normalize(query.replace(/"/g, ''));
      if (this.normTitles[d] === q || (qn && this.normTitlesEs[d] === qn)) sc += EXACT_TITLE_BONUS;
      else if ((q && this.normTitles[d].startsWith(q)) || (qn && this.normTitlesEs[d].startsWith(qn))) sc += TITLE_PREFIX_BONUS;
      if (this.docs[d].type === 'texto') sc *= PASSAGE_FACTOR;
      return [d, sc];
    }).sort((a, b) => b[1] - a[1]).slice(0, max);
    const words = groups.flat();
    const esWords = normalize(query).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
    return { total: found.length, results: ranked.map(([d, sc]) => this.summary(d, lang === 'es' ? [...esWords, ...words] : words, sc, lang)) };
  }

  /** Lo que se lista en los resultados: sin el texto entero, con un fragmento donde aparece. */
  summary(d, words, score, lang = 'en') {
    const doc = this.docs[d];
    const es = lang === 'es' ? doc.es : null;
    return {
      id: doc.id, type: doc.type, title: doc.title, book: doc.book, short: doc.short, page: doc.page,
      meta: { ...listMeta(doc), ...(es?.kind ? { kindEs: es.kind } : {}) },
      score: Math.round(score * 100) / 100,
      ...(es ? { titleEs: es.title } : {}),
      snippet: snippet(es ? es.text : doc.text, words),
    };
  }

  get(id) {
    const i = this.byId.get(id);
    return i === undefined ? null : this.docs[i];
  }
}

/** Metadatos que caben en una línea de resultado (los ataques completos van en la entrada). */
function listMeta(doc) {
  const m = doc.meta || {};
  if (doc.type === 'conjuro') return { level: m.level, school: m.school, ritual: m.ritual, castingTime: m.castingTime };
  if (doc.type === 'monstruo') return { kind: m.kind, cr: m.cr, ac: m.ac, hp: m.hp };
  if (doc.type === 'objeto') return { category: m.category, rarity: m.rarity };
  return {};
}

/** Fragmento del texto alrededor de la primera palabra buscada que aparece. */
function snippet(text, words) {
  const flat = text.replace(/\s+/g, ' ');
  const low = flat.toLowerCase();
  let at = -1;
  for (const w of words) {
    const k = low.search(new RegExp(`\\b${w.replace(/[^a-z0-9]/g, '')}`));
    if (k >= 0 && (at < 0 || k < at)) at = k;
  }
  const start = Math.max(0, at - SNIPPET_RADIUS / 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + SNIPPET_RADIUS * 2).trim()}${start + SNIPPET_RADIUS * 2 < flat.length ? '…' : ''}`;
}

/** Carga todos los libros importados de `dir` (los JSON que deja scripts/compendio.js). */
function loadCompendium(dir) {
  if (!fs.existsSync(dir)) return new Compendium([], []);
  const books = [];
  const docs = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      books.push({ id: b.id, title: b.title, short: b.short, pages: b.pages, entries: b.entries.length });
      for (const e of b.entries) docs.push({ ...e, book: b.id, short: b.short });
    } catch (err) {
      console.error(`[compendio] no se pudo leer ${file}: ${err.message}`);
    }
  }
  return new Compendium(docs, books);
}

module.exports = { Compendium, loadCompendium, normalize, stem, terms, editDistance };
