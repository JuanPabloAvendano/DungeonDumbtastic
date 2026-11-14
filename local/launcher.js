// Lanzador local (npm run lanzador): una página en este PC para arrancar la mesa y elegir cómo entran
// los amigos (red local, túneles o P2P). Escucha solo en 127.0.0.1 y exige un token aleatorio, para
// que ninguna web abierta en el navegador pueda abrir túneles por su cuenta. No va en la imagen de la nube.
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const express = require('express');
const { PROVIDERS, providerById, findLink, isInstalled } = require('./providers');

const ROOT = path.join(__dirname, '..');
const LAUNCHER_PORT = Number(process.env.LAUNCHER_PORT) || 3100;
const TOKEN = process.env.LAUNCHER_TOKEN || crypto.randomBytes(18).toString('base64url');
const LOG_LINES = 200;
const AUTO_WAIT_MS = 25000;
// Orden del modo automático: primero lo que no pide cuentas ni instalar nada raro.
const AUTO_ORDER = ['cloudflare', 'pinggy', 'localtunnel', 'bore'];
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Un proceso hijo con sus últimas líneas de salida. */
class Job {
  constructor(name, argv, env = {}) {
    this.name = name;
    this.lines = [];
    this.exitCode = null;
    this.proc = spawn(argv[0], argv.slice(1), { cwd: ROOT, env: { ...process.env, ...env }, detached: true });
    const onData = (chunk) => this.push(String(chunk));
    this.proc.stdout.on('data', onData);
    this.proc.stderr.on('data', onData);
    this.proc.on('error', (err) => this.push(`✖ ${err.message}\n`));
    this.proc.on('exit', (code) => { this.exitCode = code ?? -1; this.push(`— terminó (código ${this.exitCode})\n`); });
  }

  push(text) {
    const clean = text.replace(ANSI_RE, '');
    this.lines = [...this.lines, ...clean.split('\n').filter((l) => l.trim())].slice(-LOG_LINES);
  }

  get output() { return this.lines.join('\n'); }
  get running() { return this.exitCode === null; }

  stop() {
    if (!this.running) return;
    // El grupo entero: npx y ssh lanzan sus propios hijos.
    try { process.kill(-this.proc.pid, 'SIGTERM'); } catch { /* ya no existe */ }
  }
}

const state = { server: null, port: 3000, tunnels: new Map() };

function lanUrls(port) {
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !/^(lo|docker|br-|veth|virbr|tailscale)/.test(name))
    .flatMap(([, addrs]) => addrs || [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
}

function ufwActive() {
  try {
    execFileSync('systemctl', ['is-active', '--quiet', 'ufw'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const portFree = (port) => new Promise((resolve) => {
  const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port, '0.0.0.0');
});

function serverInfo() {
  const job = state.server;
  const out = job?.output || '';
  return {
    running: Boolean(job?.running),
    port: state.port,
    log: job ? job.lines.slice(-40) : [],
    adminPassword: /contraseña: (\S+)/.exec(out)?.[1] || null,
    lan: job?.running ? lanUrls(state.port) : [],
    ufw: ufwActive(),
  };
}

function providerInfo(p) {
  const job = state.tunnels.get(p.id);
  const link = job ? findLink(p, job.output) : null;
  return {
    id: p.id, name: p.name, kind: p.kind, about: p.about, install: p.install,
    installed: isInstalled(p), running: Boolean(job?.running), link,
    friends: link && p.friends ? p.friends(link) : null,
    log: job ? job.lines.slice(-15) : [],
  };
}

async function startServer(port) {
  if (state.server?.running) return;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Puerto inválido (1024-65535)');
  if (!(await portFree(port))) throw new Error(`El puerto ${port} ya está en uso: ¿hay otra mesa abierta?`);
  state.port = port;
  state.server = new Job('servidor', ['node', 'server/index.js'], { PORT: String(port) });
}

function startTunnel(id) {
  const p = providerById(id);
  if (!p?.command) throw new Error('Esa conexión no se lanza desde aquí');
  if (!state.server?.running) throw new Error('Primero arranca la mesa');
  if (!isInstalled(p)) throw new Error(`Falta ${p.bin}. Instálalo: ${p.install}`);
  if (state.tunnels.get(id)?.running) return;
  state.tunnels.set(id, new Job(id, p.command(state.port)));
}

function stopTunnel(id) {
  state.tunnels.get(id)?.stop();
}

/** Prueba los túneles en orden hasta que uno dé enlace; los que fallan se cierran. */
async function startAuto() {
  for (const id of AUTO_ORDER) {
    const p = providerById(id);
    if (!isInstalled(p)) continue;
    startTunnel(id);
    const deadline = Date.now() + AUTO_WAIT_MS;
    while (Date.now() < deadline) {
      const job = state.tunnels.get(id);
      if (findLink(p, job.output)) return id;
      if (!job.running) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    stopTunnel(id);
  }
  throw new Error('Ningún túnel respondió. Prueba la red local o una conexión P2P.');
}

function qrSvg(text) {
  try {
    return execFileSync('qrencode', ['-t', 'SVG', '-m', '1', '-o', '-', text]).toString();
  } catch {
    return null;
  }
}

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // Solo desde este PC y con el token: así una web cualquiera no puede abrir túneles.
  app.use('/api', (req, res, next) => {
    const hostOk = /^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '');
    // Las imágenes (QR) no pueden mandar cabeceras: ese GET acepta el token en la URL.
    const token = req.headers['x-launcher-token'] || (req.method === 'GET' && req.path === '/qr' ? req.query.t : null);
    if (!hostOk || token !== TOKEN) return res.status(403).json({ error: 'No autorizado' });
    next();
  });
  const handle = (fn) => async (req, res) => {
    try {
      res.json((await fn(req)) ?? { ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
  app.get('/api/estado', handle(() => ({ server: serverInfo(), providers: PROVIDERS.map(providerInfo) })));
  app.post('/api/servidor/iniciar', handle((req) => startServer(Number(req.body?.port) || state.port)));
  app.post('/api/servidor/parar', handle(() => { [...state.tunnels.keys()].forEach(stopTunnel); state.server?.stop(); }));
  app.post('/api/conexion/:id/iniciar', handle((req) => startTunnel(req.params.id)));
  app.post('/api/conexion/:id/parar', handle((req) => stopTunnel(req.params.id)));
  app.post('/api/auto', handle(async () => ({ id: await startAuto() })));
  app.get('/api/qr', (req, res) => {
    const svg = qrSvg(String(req.query.text || '').slice(0, 300));
    if (!svg) return res.status(404).end();
    res.type('image/svg+xml').send(svg);
  });
  // Reutiliza estilos y utilidades de la app para que el lanzador se vea igual.
  for (const dir of ['fonts', 'assets', 'css', 'js']) app.use(`/${dir}`, express.static(path.join(ROOT, 'public', dir)));
  app.use(express.static(path.join(__dirname, 'public')));
  return app;
}

function shutdown() {
  [...state.tunnels.values()].forEach((j) => j.stop());
  state.server?.stop();
  process.exit(0);
}

function main() {
  const app = buildApp();
  app.listen(LAUNCHER_PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${LAUNCHER_PORT}/#${TOKEN}`;
    console.info(`\n  🚀 Lanzador de DungeonDumbtastic: ${url}\n     (Ctrl+C cierra la mesa y todas las conexiones)\n`);
    if (!process.env.NO_OPEN) spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }).on('error', (err) => {
    console.error(`  ✖ No se pudo abrir el lanzador en el puerto ${LAUNCHER_PORT}: ${err.message}`);
    process.exit(1);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { buildApp, TOKEN };
