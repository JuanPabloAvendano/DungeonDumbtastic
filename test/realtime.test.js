// Integración: levanta un servidor real con datos temporales y prueba permisos en tiempo real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-test-'));

let server;
const creds = {};

async function login(username) {
  const res = await fetch(`${URL_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: creds[username] }),
  });
  return (await res.json()).token;
}

async function connect(username) {
  const token = await login(username);
  const socket = io(URL_BASE, { auth: { token }, transports: ['websocket'] });
  await new Promise((resolve) => socket.on('connect', resolve));
  const emit = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const { campaigns } = await (await fetch(`${URL_BASE}/api/campaigns`, { headers: { authorization: `Bearer ${token}` } })).json();
  const joined = await emit('join', { id: campaigns[0].id });
  return { socket, emit, state: joined.state };
}

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`${URL_BASE}/healthz`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el servidor de pruebas no arrancó');
});

test.after(() => {
  server?.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('el jugador no ve fichas ocultas y el DM sí', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  assert.ok(dm.state.tokens.some((t) => t.hidden));
  assert.ok(!pl.state.tokens.some((t) => t.hidden));
  dm.socket.close();
  pl.socket.close();
});

test('un jugador solo puede mover su propia ficha', async () => {
  const pl = await connect('jugador1');
  const goblin = pl.state.tokens.find((t) => t.name === 'Goblin');
  const mine = pl.state.tokens.find((t) => t.ownerId && t.name.startsWith('Thorin'));
  assert.match((await pl.emit('token:update', { id: goblin.id, x: 0, y: 0 })).error, /no es tuya/);
  assert.deepStrictEqual(await pl.emit('token:update', { id: mine.id, x: mine.x, y: mine.y }), { ok: true });
  pl.socket.close();
});

test('solo el DM controla la música y todos reciben el estado', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  assert.match((await pl.emit('music:set', { action: 'play' })).error, /Solo el DM/);
  await dm.emit('track:add', { name: 'Taberna', url: '/assets/audio/musica-taberna.mp3', kind: 'musica' });
  const refreshed = (await dm.emit('refresh', null)).state;
  const track = refreshed.tracks.find((t) => t.name === 'Taberna');
  const heard = new Promise((resolve) => pl.socket.once('music', resolve));
  await dm.emit('music:set', { action: 'play', trackId: track.id });
  const { music, serverNow } = await heard;
  assert.strictEqual(music.trackId, track.id);
  assert.strictEqual(music.playing, true);
  assert.ok(Math.abs(serverNow - Date.now()) < 5000);
  dm.socket.close();
  pl.socket.close();
});

test('la música rechaza URLs externas', async () => {
  const dm = await connect('dm');
  assert.match((await dm.emit('track:add', { name: 'x', url: 'https://evil.example/a.mp3' })).error, /inválido/);
  dm.socket.close();
});

test('las tiradas ocultas del DM no llegan a los jugadores', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const got = new Promise((resolve) => {
    const t = setTimeout(() => resolve('nada'), 600);
    pl.socket.once('log', (e) => { clearTimeout(t); resolve(e); });
  });
  await dm.emit('roll', { expr: '1d20', hidden: true });
  const received = await got;
  assert.ok(received === null || received === 'nada');
  dm.socket.close();
  pl.socket.close();
});

test('el monitor exige super admin', async () => {
  const token = await login('dm');
  const res = await fetch(`${URL_BASE}/api/admin/monitor`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 403);
});
