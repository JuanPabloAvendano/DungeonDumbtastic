// Mis objetos: plantillas propias de objetos (inventario + comportamiento en el mapa).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { cleanObject } = require('../server/objects');

const ROOT = path.join(__dirname, '..');
const PORT = 3500 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-tpl-'));
let server;
const creds = {};

async function call(username, method, url, body) {
  const login = await fetch(`${URL_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: creds[username] }),
  });
  const { token } = await login.json();
  const res = await fetch(`${URL_BASE}/api${url}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${URL_BASE}/healthz`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el servidor de pruebas no arrancó');
});

test.after(() => {
  server?.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('un objeto del mapa puede llevar los datos de inventario que dará al recogerlo', () => {
  const o = cleanObject({ use: 'recoger', item: { name: 'Hacha rúnica', kind: 'arma', weapon: { damage: '1d10', dmgType: 'cortante' }, weight: 4, value: 300, qty: 5, id: 'x' } });
  assert.strictEqual(o.item.kind, 'arma');
  assert.strictEqual(o.item.weapon.damage, '1d10');
  assert.strictEqual(o.item.value, 300);
  assert.strictEqual(o.item.id, undefined);
  assert.strictEqual(o.item.qty, undefined);
  assert.strictEqual(cleanObject({ use: 'abrir' }).item, null);
});

test('crear, listar, editar y borrar mis objetos; cada uno ve solo los suyos', async () => {
  const made = await call('dm', 'POST', '/plantillas', {
    name: 'Hacha rúnica', kind: 'arma', weapon: { damage: '1d10', dmgType: 'cortante' }, weight: 4, value: 300, note: 'Brilla cerca de orcos',
    object: { use: 'recoger', description: 'Un hacha con runas que brillan.' }, ownerId: 'otro', hack: 1,
  });
  assert.strictEqual(made.status, 200, JSON.stringify(made.body));
  const tpl = made.body.template;
  assert.strictEqual(tpl.weapon.damage, '1d10');
  assert.strictEqual(tpl.object.use, 'recoger');
  assert.strictEqual(tpl.hack, undefined);
  assert.notStrictEqual(tpl.ownerId, 'otro');
  assert.strictEqual((await call('dm', 'GET', '/plantillas')).body.templates.length, 1);
  assert.strictEqual((await call('jugador1', 'GET', '/plantillas')).body.templates.length, 0, 'otro usuario no la ve');
  assert.strictEqual((await call('jugador1', 'PATCH', `/plantillas/${tpl.id}`, { name: 'Robada' })).status, 404);
  const edited = await call('dm', 'PATCH', `/plantillas/${tpl.id}`, { name: 'Hacha rúnica +1', value: 500 });
  assert.strictEqual(edited.body.template.name, 'Hacha rúnica +1');
  assert.strictEqual(edited.body.template.weapon.damage, '1d10', 'lo que no se manda se conserva');
  assert.strictEqual((await call('dm', 'DELETE', `/plantillas/${tpl.id}`)).status, 200);
  assert.strictEqual((await call('dm', 'GET', '/plantillas')).body.templates.length, 0);
});

test('los jugadores también crean objetos propios; sin nombre no se guarda', async () => {
  assert.strictEqual((await call('jugador1', 'POST', '/plantillas', { name: 'Amuleto de mi abuela', value: 1 })).status, 200);
  const bad = await call('jugador1', 'POST', '/plantillas', { name: '   ' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /nombre/);
});
