// Lanzador local: protegido por token y host, y capaz de encender y apagar la mesa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-launcher-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LAUNCHER_TOKEN = 'token-de-prueba';
process.env.ADMIN_PASSWORD = 'admin-test-1';
const { buildApp } = require('../local/launcher');

const GAME_PORT = 3700 + Math.floor(Math.random() * 90);
let server;
let base;

const call = (method, url, { token = 'token-de-prueba', body } = {}) => fetch(`${base}/api${url}`, {
  method, headers: { 'content-type': 'application/json', 'x-launcher-token': token }, body: body && JSON.stringify(body),
});

test.before(async () => {
  server = buildApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await call('POST', '/servidor/parar');
  server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('sin token no se puede tocar nada', async () => {
  assert.strictEqual((await call('GET', '/estado', { token: 'otro' })).status, 403);
  assert.strictEqual((await call('POST', '/servidor/iniciar', { token: '' })).status, 403);
});

test('no se pueden abrir túneles sin la mesa encendida', async () => {
  const res = await call('POST', '/conexion/cloudflare/iniciar');
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Primero arranca la mesa/);
});

test('enciende la mesa, la sirve y la apaga', async () => {
  assert.strictEqual((await call('POST', '/servidor/iniciar', { body: { port: GAME_PORT } })).status, 200);
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${GAME_PORT}/healthz`).then((r) => r.ok).catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'la mesa no respondió');
  const st = await (await call('GET', '/estado')).json();
  assert.strictEqual(st.server.running, true);
  assert.ok(st.providers.some((p) => p.id === 'holesail' && p.kind === 'p2p'));
  assert.strictEqual((await call('POST', '/servidor/iniciar', { body: { port: GAME_PORT } })).status, 200, 'encender dos veces no rompe');
  await call('POST', '/servidor/parar');
  let down = false;
  for (let i = 0; i < 50 && !down; i++) {
    down = !(await fetch(`http://127.0.0.1:${GAME_PORT}/healthz`).then((r) => r.ok).catch(() => false));
    if (!down) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(down, 'la mesa siguió encendida');
});

test('puerto inválido se rechaza con mensaje claro', async () => {
  const res = await call('POST', '/servidor/iniciar', { body: { port: 80 } });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Puerto inválido/);
});

test('el QR se pide con el token en la URL (las imágenes no mandan cabeceras)', async () => {
  const ok = await fetch(`${base}/api/qr?t=token-de-prueba&text=${encodeURIComponent('http://192.168.1.5:3000')}`);
  assert.strictEqual(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /svg/);
  assert.strictEqual((await fetch(`${base}/api/qr?t=otro&text=x`)).status, 403);
  assert.strictEqual((await fetch(`${base}/api/estado?t=token-de-prueba`)).status, 403, 'el token por URL solo vale para el QR');
});
