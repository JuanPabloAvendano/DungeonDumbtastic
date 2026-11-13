// Integración: el respaldo solo lo baja el super admin y trae lo necesario para reconstruir la mesa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3800 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-backup-'));
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-backup-out-'));

let server;
const creds = {};

async function login(username) {
  const res = await fetch(`${URL_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: creds[username] }),
  });
  return (await res.json()).token;
}

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  creds.admin = 'admin-test-1';
  fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', 'mapa.png'), 'png-de-prueba');
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
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
});

test('sin sesión o sin ser super admin no se baja el respaldo', async () => {
  assert.strictEqual((await fetch(`${URL_BASE}/api/admin/backup`)).status, 401);
  const token = await login('dm');
  const res = await fetch(`${URL_BASE}/api/admin/backup`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 403);
});

test('el super admin baja un .tar.gz con la base SQLite y las subidas', async () => {
  const token = await login('admin');
  const res = await fetch(`${URL_BASE}/api/admin/backup`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /dungeondumbtastic-.*\.tar\.gz/);
  assert.ok(Number(res.headers.get('x-dd-saved-at')) > 0);
  const file = path.join(OUT_DIR, 'respaldo.tar.gz');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', file, '-C', OUT_DIR]);
  const { DatabaseSync } = require('node:sqlite');
  const restored = new DatabaseSync(path.join(OUT_DIR, 'db.sqlite'), { readOnly: true });
  const read = (name) => JSON.parse(restored.prepare('SELECT data FROM collections WHERE name = ?').get(name).data);
  assert.ok(read('users').some((u) => u.username === 'admin'));
  assert.ok(read('campaigns').length > 0);
  restored.close();
  assert.strictEqual(fs.readFileSync(path.join(OUT_DIR, 'uploads', 'mapa.png'), 'utf8'), 'png-de-prueba');
});
