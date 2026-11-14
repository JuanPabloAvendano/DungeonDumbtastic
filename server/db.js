// Persistencia en SQLite (node:sqlite, sin dependencias): todo el estado vive en memoria y se guarda
// por colecciones, una fila cada una, en una transacción. Suficiente para una mesa de amigos y deja
// la base en un solo archivo que se copia en caliente para el respaldo (VACUUM INTO).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR permite levantar instancias aisladas (pruebas, partidas de agentes) sin tocar la real.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.sqlite');
// Formato anterior: si existe y aún no hay SQLite, se migra una vez y se aparta.
const LEGACY_JSON = path.join(DATA_DIR, 'db.json');
const SAVE_DELAY_MS = 400;

const EMPTY_DB = {
  // savedAt: hora del último guardado con cambios. Viaja dentro de la base, así que si el contenedor
  // se reinicia y vuelve a la imagen, el respaldo del PC nota que la nube retrocedió.
  meta: { savedAt: 0 },
  settings: { openRegistration: true },
  users: [],
  sessions: [],
  campaigns: [],
  characters: [],
  bestiary: [],
  mapDrafts: [],
  stamps: [],
  notes: [],
  itemTemplates: [],
  documents: [],
};

let state = null;
let sqlite = null;
let saveTimer = null;
// savedAt con el que arrancó el proceso: si la nube se reinicia, es el de la imagen desplegada.
let loadedSavedAt = 0;
// Último JSON escrito por colección: solo se reescribe lo que cambió.
const written = new Map();

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sqlite = new DatabaseSync(DB_FILE);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, data TEXT NOT NULL)');
}

function readLegacyJson() {
  try {
    return JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
  } catch (err) {
    console.error('[db] db.json ilegible, se empieza con la base vacía:', err.message);
    return {};
  }
}

function load() {
  const isNew = !fs.existsSync(DB_FILE);
  open();
  const stored = {};
  for (const row of sqlite.prepare('SELECT name, data FROM collections').all()) {
    stored[row.name] = JSON.parse(row.data);
    written.set(row.name, row.data);
  }
  const migrating = isNew && fs.existsSync(LEGACY_JSON);
  state = { ...structuredClone(EMPTY_DB), ...(migrating ? readLegacyJson() : stored) };
  loadedSavedAt = state.meta?.savedAt || 0;
  flush();
  if (migrating) fs.renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrado-${Date.now()}`);
  return state;
}

function flush() {
  if (!state) return;
  const upsert = sqlite.prepare('INSERT INTO collections (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data');
  const changed = Object.entries(state)
    .filter(([name]) => name !== 'meta')
    .map(([name, value]) => [name, JSON.stringify(value)])
    .filter(([name, data]) => written.get(name) !== data);
  if (!changed.length) return;
  state.meta = { ...state.meta, savedAt: Math.max(Date.now(), (state.meta?.savedAt || 0) + 1) };
  changed.push(['meta', JSON.stringify(state.meta)]);
  sqlite.exec('BEGIN');
  try {
    for (const [name, data] of changed) upsert.run(name, data);
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  for (const [name, data] of changed) written.set(name, data);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      flush();
    } catch (err) {
      console.error('[db] error guardando:', err);
    }
  }, SAVE_DELAY_MS);
}

/** Copia consistente de la base completa en `file` (para respaldos), sin parar el servidor. */
function snapshot(file) {
  db();
  flush();
  fs.rmSync(file, { force: true });
  sqlite.prepare('VACUUM INTO ?').run(file);
}

function db() {
  return state || load();
}

/** Hora del último guardado con cambios (ms), para detectar si la nube volvió a un estado anterior. */
function savedAt() {
  return db().meta?.savedAt || 0;
}

/** savedAt que tenía la base al arrancar este proceso. */
function bootSavedAt() {
  db();
  return loadedSavedAt;
}

module.exports = { db, save, flush, snapshot, savedAt, bootSavedAt, DATA_DIR, DB_FILE };
