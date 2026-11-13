// Traducción automática del compendio al español, en local (scripts/traductor/traducir.py): sin
// servicios externos, porque el texto de los libros no debe salir de esta máquina. Lo traducido se
// guarda en DATA_DIR/compendio/es/<libro>.json y se indexa para buscar también en español.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { log } = require('../logger');

const REQUEST_TIMEOUT_MS = 120000;
const SAVE_DELAY_MS = 3000;
// Pausa entre entradas al pretraducir en segundo plano, para no robarle CPU a la partida.
const WARM_PAUSE_MS = 400;
const WARM_START_MS = 4000;
const WARM_TYPES = ['conjuro', 'monstruo', 'objeto'];
// Una entrada se traduce a trozos de este tamaño (por párrafos): entre trozo y trozo, lo urgente pasa delante.
const CHUNK_CHARS = 1800;

/** Parte un texto por párrafos en trozos de hasta CHUNK_CHARS (un párrafo enorme va solo). */
function chunksOf(text) {
  const out = [];
  let cur = '';
  for (const para of String(text).split(/\n(?=\s*\n)/)) {
    if (cur && cur.length + para.length > CHUNK_CHARS) {
      out.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + para;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

class TranslationCache {
  constructor(dir) {
    this.dir = dir;
    this.byBook = new Map();
    this.dirty = new Set();
    this.timer = null;
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        this.byBook.set(f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch (err) {
        log.warn('traducciones ilegibles', { file: f, error: err.message });
      }
    }
  }

  get(id) {
    return this.byBook.get(id.split(':')[0])?.[id] || null;
  }

  get size() {
    let n = 0;
    for (const b of this.byBook.values()) n += Object.keys(b).length;
    return n;
  }

  entries() {
    return [...this.byBook.values()].flatMap((b) => Object.entries(b));
  }

  set(id, value) {
    const book = id.split(':')[0];
    this.byBook.set(book, { ...(this.byBook.get(book) || {}), [id]: value });
    this.dirty.add(book);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const book of this.dirty) {
        const tmp = path.join(this.dir, `${book}.json.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(this.byBook.get(book)));
        fs.renameSync(tmp, path.join(this.dir, `${book}.json`));
      }
      this.dirty.clear();
    } catch (err) {
      log.error('no se pudieron guardar las traducciones', { error: err.message });
    }
  }
}

/** Proceso de Python que traduce; se arranca la primera vez que hace falta y se reutiliza. */
class Worker {
  constructor({ python, script, model }) {
    Object.assign(this, { python, script, model });
    this.available = [python, script, model].every((p) => fs.existsSync(p));
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const proc = spawn(this.python, [this.script, this.model], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;
      proc.stderr.on('data', (d) => log.warn('traductor', { stderr: String(d).slice(0, 300) }));
      proc.on('error', (err) => { this.ready = null; reject(err); });
      proc.on('exit', (code) => {
        log.warn('traductor cerrado', { code });
        for (const p of this.pending.values()) p.reject(new Error('El traductor se cerró'));
        this.pending.clear();
        this.proc = null;
        this.ready = null;
      });
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) return resolve();
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.out);
      });
    });
    return this.ready;
  }

  /** @param {string[]} texts @param {number[]} titles índices de `texts` que son títulos (se traducen aparte) */
  async translate(texts, titles = []) {
    if (!this.available) throw new Error('El traductor no está instalado (scripts/traductor/instalar.sh)');
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('La traducción tardó demasiado')); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ id, texts, titles })}\n`);
    });
  }
}

/**
 * Traductor del compendio: caché, cola (lo que pide una persona va primero) y pretraducción.
 * @param {{ dataDir:string, root:string }} paths
 */
function createTranslator({ dataDir, root }) {
  const worker = new Worker({
    python: path.join(dataDir, 'traductor', 'venv', 'bin', 'python'),
    script: path.join(root, 'scripts', 'traductor', 'traducir.py'),
    model: path.join(dataDir, 'traductor', 'en_es'),
  });
  const cache = new TranslationCache(path.join(dataDir, 'compendio', 'es'));
  // Cola con prioridades: 0 = alguien abrió la entrada, 1 = resultados de una búsqueda, 2 = segundo plano.
  const lanes = [[], [], []];
  const inflight = new Map();
  let busy = false;
  let onTranslated = () => {};

  /** Traduce un trozo del trabajo más prioritario; si le quedan trozos, vuelve al frente de su cola. */
  async function pump() {
    if (busy) return;
    const lane = lanes.find((l) => l.length);
    if (!lane) return;
    busy = true;
    const job = lane.shift();
    const { entry } = job;
    try {
      if (!job.parts) {
        job.chunks = chunksOf(entry.text);
        const [title, first, kind] = await worker.translate([entry.title, job.chunks[0], entry.meta?.kind || ''], [0]);
        job.head = { title: title.trim(), ...(entry.meta?.kind ? { kind: kind.trim() } : {}) };
        job.parts = [first];
      } else {
        job.parts.push((await worker.translate([job.chunks[job.parts.length]]))[0]);
      }
      if (job.parts.length < job.chunks.length) {
        lane.unshift(job);
      } else {
        const es = { ...job.head, text: job.parts.join('\n\n') };
        cache.set(entry.id, es);
        onTranslated(entry.id, es);
        inflight.delete(entry.id);
        job.resolve(es);
      }
    } catch (err) {
      inflight.delete(entry.id);
      job.reject(err);
    } finally {
      busy = false;
      pump();
    }
  }

  /**
   * Traduce una entrada (título, texto y tipo de criatura) una sola vez aunque la pidan varios a la vez.
   * Si ya estaba en cola con menos prioridad, sube a la nueva.
   */
  function translateEntry(entry, priority = 1) {
    const hit = cache.get(entry.id);
    if (hit) return Promise.resolve(hit);
    const queued = inflight.get(entry.id);
    if (queued) {
      if (priority < queued.priority) {
        const from = lanes[queued.priority].indexOf(queued.job);
        if (from >= 0) {
          lanes[queued.priority].splice(from, 1);
          lanes[priority].push(queued.job);
          queued.priority = priority;
        }
      }
      return queued.promise;
    }
    const job = { entry };
    const promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
    inflight.set(entry.id, { job, promise, priority });
    lanes[priority].push(job);
    pump();
    return promise;
  }

  /** Lo que pide alguien ahora: pasa por delante de todo lo demás. */
  const translateNow = (entry) => translateEntry(entry, 0);

  /** Pretraduce en segundo plano conjuros, monstruos y objetos, uno a uno y cediendo el paso. */
  function warm(docs) {
    if (!worker.available) return;
    const todo = docs.filter((d) => WARM_TYPES.includes(d.type) && !cache.get(d.id));
    if (!todo.length) return;
    log.info('pretraduciendo el compendio', { pendientes: todo.length });
    // De una en una: la cola de segundo plano nunca tiene más de una entrada esperando.
    const next = () => {
      const d = todo.shift();
      if (!d) {
        log.info('compendio traducido', { total: cache.size });
        return;
      }
      translateEntry(d, 2).then(() => setTimeout(next, WARM_PAUSE_MS)).catch((err) => log.warn('pretraducción detenida', { error: err.message }));
    };
    setTimeout(next, WARM_START_MS);
  }

  return {
    get available() { return worker.available; },
    get cached() { return cache.size; },
    get: (id) => cache.get(id),
    entries: () => cache.entries(),
    translateNow,
    translateEntry,
    warm,
    onTranslated: (fn) => { onTranslated = fn; },
  };
}

module.exports = { createTranslator };
