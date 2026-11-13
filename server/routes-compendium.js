// API del compendio: buscar en los libros importados con scripts/compendio.js y leer una entrada.
// Los libros viven en DATA_DIR/compendio; si se vuelven a importar, el índice se rehace solo.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const { loadCompendium } = require('./compendium/search');
const { createTranslator } = require('./compendium/translator');
const { log } = require('./logger');

const DIR = path.join(DATA_DIR, 'compendio');
const TYPES = ['conjuro', 'monstruo', 'objeto', 'texto'];
const QUERY_MAX = 120;
const PRETRANSLATE_TOP = 8;

const ROOT = path.join(__dirname, '..');

let cache = { signature: null, index: null };
const translator = createTranslator({ dataDir: DATA_DIR, root: ROOT });
// Cada traducción nueva entra en el índice al momento (para buscar también en español).
translator.onTranslated((id, es) => cache.index?.addTranslation(id, es));

/** Firma de los libros importados: si se reimporta alguno, se vuelve a cargar el índice. */
function signature() {
  if (!fs.existsSync(DIR)) return '';
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => `${f}:${fs.statSync(path.join(DIR, f)).mtimeMs}`).join('|');
}

function index() {
  const sig = signature();
  if (cache.signature !== sig) {
    const started = Date.now();
    const idx = loadCompendium(DIR);
    for (const [id, es] of translator.entries()) idx.addTranslation(id, es);
    cache = { signature: sig, index: idx };
    if (sig) {
      log.info('compendio cargado', { docs: idx.docs.length, traducidas: translator.cached, ms: Date.now() - started });
      translator.warm(idx.docs);
    }
  }
  return cache.index;
}

/** La entrada con su traducción (si se pide en español y el traductor está instalado). */
async function withSpanish(entry, lang) {
  if (lang !== 'es' || !translator.available) return entry;
  try {
    return { ...entry, es: await translator.translateNow(entry) };
  } catch (err) {
    log.warn('no se pudo traducir', { id: entry.id, error: err.message });
    return { ...entry, esError: 'No se pudo traducir ahora; se muestra el original.' };
  }
}

/**
 * @param {import('express').Router} r
 * @param {{ handle, httpError, logged }} deps
 */
function registerCompendium(r, { handle, httpError, logged }) {
  r.get('/compendio/estado', logged, handle(() => ({
    books: index().books,
    translator: { available: translator.available, cached: translator.cached },
  })));

  r.get('/compendio/buscar', logged, handle((req) => {
    const q = String(req.query.q || '').slice(0, QUERY_MAX);
    const type = TYPES.includes(req.query.tipo) ? req.query.tipo : '';
    const book = typeof req.query.libro === 'string' ? req.query.libro.slice(0, 60) : '';
    const level = req.query.nivel !== undefined && req.query.nivel !== '' ? Number(req.query.nivel) : null;
    const lang = req.query.lang === 'es' ? 'es' : 'en';
    if (!q.trim()) return { total: 0, results: [] };
    const res = index().search(q, { type, book, level: Number.isInteger(level) ? level : null, limit: req.query.limite, lang });
    // Los primeros resultados sin traducir se traducen ya, para que la próxima búsqueda salga en español.
    if (lang === 'es' && translator.available) {
      res.results.filter((x) => !x.titleEs).slice(0, PRETRANSLATE_TOP).forEach((x) => translator.translateEntry(index().get(x.id)).catch(() => {}));
    }
    return res;
  }));

  r.get('/compendio/entrada/:id', logged, (req, res) => {
    const entry = index().get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'No está en el compendio' });
    withSpanish(entry, req.query.lang).then((full) => res.json({ entry: full }), (err) => res.status(500).json({ error: err.message }));
  });
}

module.exports = { registerCompendium };
