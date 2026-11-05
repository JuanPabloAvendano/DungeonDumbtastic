// Logs estructurados (JSON por línea, un archivo por día) + métricas en memoria para el monitor.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const LOG_DIR = path.join(DATA_DIR, 'logs');
const KEEP_DAYS = 14;
const RECENT_LIMIT = 400;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

fs.mkdirSync(LOG_DIR, { recursive: true });

const recent = [];
const counters = { requests: 0, http4xx: 0, http5xx: 0, socketEvents: 0, rolls: 0, chats: 0, uploads: 0, errors: 0 };
const eventCounts = {};
const startedAt = Date.now();
let currentDay = null;
let stream = null;

function fileFor(day) {
  return path.join(LOG_DIR, `app-${day}.log`);
}

function rotate() {
  const day = new Date().toISOString().slice(0, 10);
  if (day === currentDay && stream) return;
  stream?.end();
  currentDay = day;
  stream = fs.createWriteStream(fileFor(day), { flags: 'a' });
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    const m = f.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
    if (m && Date.parse(m[1]) < cutoff) fs.rmSync(path.join(LOG_DIR, f), { force: true });
  }
}

function write(level, msg, data = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = { t: new Date().toISOString(), level, msg, ...data };
  if (level === 'error') counters.errors += 1;
  recent.push(entry);
  if (recent.length > RECENT_LIMIT) recent.shift();
  try {
    rotate();
    stream.write(`${JSON.stringify(entry)}\n`);
  } catch (err) {
    process.stderr.write(`[logger] no se pudo escribir el log: ${err.message}\n`);
  }
  if (level !== 'debug') {
    const extra = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
    const line = `${entry.t.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`;
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
  }
}

const log = {
  debug: (msg, data) => write('debug', msg, data),
  info: (msg, data) => write('info', msg, data),
  warn: (msg, data) => write('warn', msg, data),
  error: (msg, data) => write('error', msg, data),
};

/** Middleware de Express: cuenta y registra cada petición a la API (y cualquier error). */
function requestLogger(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // req.path cambia dentro de los routers montados; originalUrl conserva la ruta completa.
    const urlPath = req.originalUrl.split('?')[0];
    const isApi = urlPath.startsWith('/api');
    if (isApi) counters.requests += 1;
    if (res.statusCode >= 500) counters.http5xx += 1;
    else if (res.statusCode >= 400) counters.http4xx += 1;
    if (!isApi && res.statusCode < 400) return;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    write(level, 'http', { method: req.method, path: urlPath, status: res.statusCode, ms: Math.round(ms), ip: req.ip });
  });
  next();
}

function countEvent(name) {
  counters.socketEvents += 1;
  eventCounts[name] = (eventCounts[name] || 0) + 1;
  if (name === 'roll') counters.rolls += 1;
  if (name === 'chat') counters.chats += 1;
}

function snapshot({ level = 'info', limit = 150 } = {}) {
  const min = LEVELS[level] || LEVELS.info;
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    counters: { ...counters },
    events: { ...eventCounts },
    recent: recent.filter((e) => LEVELS[e.level] >= min).slice(-limit).reverse(),
    logFile: currentDay ? fileFor(currentDay) : null,
  };
}

module.exports = { log, requestLogger, countEvent, snapshot, counters, LOG_DIR };
