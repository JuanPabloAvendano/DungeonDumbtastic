// Integración: atacar contra CA, ventana de reacción del jugador y daño aplicado, con un servidor real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 3200 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-atk-'));
let server;
const creds = {};

async function connect(username) {
  const res = await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: creds[username] }) });
  const { token } = await res.json();
  const socket = io(URL_BASE, { auth: { token }, transports: ['websocket'] });
  await new Promise((resolve) => socket.on('connect', resolve));
  const emit = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const { campaigns } = await (await fetch(`${URL_BASE}/api/campaigns`, { headers: { authorization: `Bearer ${token}` } })).json();
  const join = async () => (await emit('join', { id: campaigns[0].id })).state;
  const logs = [];
  socket.on('log', (e) => logs.push(e));
  return { socket, emit, join, logs, state: await join() };
}

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, PORT: String(PORT), REACTION_MS: '3000' }, stdio: 'ignore' });
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('el DM ataca a una criatura: con 20 natural o total ≥ CA impacta y le baja los PG; si no, nada', async () => {
  const dm = await connect('dm');
  const goblin = dm.state.tokens.find((t) => t.name.startsWith('Goblin'));
  await dm.emit('token:update', { id: goblin.id, ac: 15 });
  const res = await dm.emit('attack', { targetId: goblin.id, toHit: '1d20+4', damage: '1d6+2', label: 'Cimitarra' });
  assert.ok(res.ok, res.error);
  await wait(300);
  const roll = dm.logs.find((e) => /Cimitarra → Goblin/.test(e.label || ''));
  const expected = roll.natural === 20 || (roll.natural !== 1 && roll.result.total >= 15);
  assert.strictEqual(res.hit, expected);
  assert.strictEqual(roll.success, expected);
  const after = (await dm.join()).tokens.find((t) => t.id === goblin.id);
  const dmg = dm.logs.find((e) => /Daño a Goblin/.test(e.label || ''));
  if (expected) assert.strictEqual(after.hp, Math.max(0, goblin.hp - dmg.result.total));
  else assert.strictEqual(after.hp, goblin.hp);
  dm.socket.close();
});

test('los jugadores no ven la CA de las criaturas', async () => {
  const p1 = await connect('jugador1');
  assert.ok(p1.state.tokens.filter((t) => !t.characterId).every((t) => t.ac === undefined));
  p1.socket.close();
});

test('contra un personaje de jugador: le llega la ventana de reacción y Esquiva asombrosa divide el daño', async () => {
  const dm = await connect('dm');
  const p1 = await connect('jugador1');
  const thorin = p1.state.characters.find((c) => c.name.startsWith('Thorin'));
  const tok = dm.state.tokens.find((t) => t.characterId === thorin.id);
  let incoming = null;
  p1.socket.on('attack:incoming', (a) => { incoming = a; p1.emit('attack:react', { id: a.id, kind: 'esquiva' }); });
  let res;
  for (let i = 0; i < 5 && !res?.hit; i++) res = await dm.emit('attack', { targetId: tok.id, toHit: '1d20+30', damage: '2d6+4', label: 'Garrote' });
  assert.ok(res.hit, 'tras 5 intentos debería impactar al menos una vez');
  await wait(500);
  assert.ok(incoming, 'al jugador le llega el aviso');
  assert.strictEqual(incoming.target, thorin.name);
  const dmg = dm.logs.find((e) => /Daño a Thorin.*esquiva/.test(e.label || ''));
  assert.ok(dmg, 'el daño se aplica a la mitad');
  const half = Math.floor((dmg.result.total) / 2);
  const ch = (await p1.join()).characters.find((c) => c.id === thorin.id);
  assert.strictEqual(ch.hp, Math.max(0, thorin.hp - half));
  dm.socket.close();
  p1.socket.close();
});

test('si el jugador no contesta, al acabar el tiempo se aplica el daño completo', async () => {
  const dm = await connect('dm');
  const lyraTok = dm.state.tokens.find((t) => t.name.startsWith('Lyra'));
  let res;
  for (let i = 0; i < 5 && !res?.hit; i++) res = await dm.emit('attack', { targetId: lyraTok.id, toHit: '1d20+30', damage: '1d4', label: 'Dardo' });
  assert.ok(res.waiting, 'espera la reacción (Lyra es de un jugador)');
  await wait(3500);
  assert.ok(dm.logs.some((e) => /Daño a Lyra/.test(e.label || '') && !/esquiva/.test(e.label)));
  dm.socket.close();
});

test('objetivo inexistente, tirada de ataque o daño inválidos se rechazan con mensaje claro', async () => {
  const dm = await connect('dm');
  const res = await dm.emit('attack', { targetId: 'no-existe', toHit: '1d20', damage: '1d4' });
  assert.match(res.error, /no está a la vista/);
  const goblin = dm.state.tokens.find((t) => t.name.startsWith('Goblin'));
  assert.match((await dm.emit('attack', { targetId: goblin.id, toHit: '8d6', damage: '1d4' })).error, /1d20/);
  assert.match((await dm.emit('attack', { targetId: goblin.id, toHit: '1d20', damage: 'rm -rf' })).error, /daño/);
  dm.socket.close();
});
