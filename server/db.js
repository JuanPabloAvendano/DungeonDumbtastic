// Persistencia simple en un archivo JSON. Suficiente para una mesa de amigos;
// se puede cambiar por SQLite más adelante sin tocar las rutas.
const fs = require('fs');
const path = require('path');

// DATA_DIR permite levantar instancias aisladas (pruebas, partidas de agentes) sin tocar la real.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SAVE_DELAY_MS = 400;

const EMPTY_DB = {
  settings: { openRegistration: true },
  users: [],
  sessions: [],
  campaigns: [],
  characters: [],
  bestiary: [],
  mapDrafts: [],
  stamps: [],
  notes: [],
};

let state = null;
let saveTimer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    state = structuredClone(EMPTY_DB);
    flush();
    return state;
  }
  try {
    state = { ...structuredClone(EMPTY_DB), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    fs.copyFileSync(DB_FILE, backup);
    console.error(`[db] db.json ilegible, copia guardada en ${backup}:`, err.message);
    state = structuredClone(EMPTY_DB);
  }
  return state;
}

function flush() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
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

function db() {
  return state || load();
}

module.exports = { db, save, flush, DATA_DIR };
