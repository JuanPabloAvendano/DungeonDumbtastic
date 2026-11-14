// Integración: dar objetos y monedas en partida, y el botín del DM, con un servidor real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = 3600 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-inv-'));

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
  const patch = (ch) => fetch(`${URL_BASE}/api/characters/${ch.id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(ch),
  }).then((r) => r.json());
  const characters = async () => (await emit('join', { id: campaigns[0].id })).state.characters;
  return { socket, emit, patch, characters, state: joined.state };
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

test('un jugador da una armadura puesta: el otro la recibe sin equipar y la CA del primero vuelve a la manual', async () => {
  const p1 = await connect('jugador1');
  const p2 = await connect('jugador2');
  const thorin = p1.state.characters.find((c) => c.name.startsWith('Thorin'));
  const lyra = p2.state.characters.find((c) => c.name.startsWith('Lyra'));
  const armed = await p1.patch({ ...thorin, inventory: [{ name: 'Cota de malla', kind: 'armadura', armor: { base: 16, type: 'pesada' }, weight: 55, equipped: true }] });
  assert.strictEqual(armed.character.ac, 16);
  const res = await p1.emit('item:give', { fromId: thorin.id, toId: lyra.id, itemId: armed.character.inventory[0].id, qty: 1 });
  assert.ok(res.ok, res.error);
  const after = await p1.characters();
  assert.strictEqual(after.find((c) => c.id === thorin.id).inventory.length, 0);
  assert.strictEqual(after.find((c) => c.id === thorin.id).ac, armed.character.baseAc);
  const got = after.find((c) => c.id === lyra.id).inventory.find((i) => i.name === 'Cota de malla');
  assert.strictEqual(got.equipped, false);
  p1.socket.close();
  p2.socket.close();
});

test('nadie da desde un personaje ajeno, y el botín es solo del DM', async () => {
  const p2 = await connect('jugador2');
  const thorin = p2.state.characters.find((c) => c.name.startsWith('Thorin'));
  const lyra = p2.state.characters.find((c) => c.name.startsWith('Lyra'));
  assert.match((await p2.emit('coins:give', { fromId: thorin.id, toId: lyra.id, coins: { gp: 1 } })).error, /no es tuyo/);
  assert.match((await p2.emit('loot:give', { toIds: [lyra.id], coins: { gp: 5 } })).error, /Solo el DM/);
  p2.socket.close();
});

test('el DM reparte monedas entre el grupo y le dice lo que sobra; luego un jugador las pasa', async () => {
  const dm = await connect('dm');
  const pcs = dm.state.characters.filter((c) => !c.npc).slice(0, 3);
  const res = await dm.emit('loot:give', { toIds: pcs.map((c) => c.id), coins: { gp: 10, sp: 1 } });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(res.rest, { cp: 0, sp: 1, ep: 0, gp: 1, pp: 0 });
  const after = await dm.characters();
  for (const c of pcs) assert.strictEqual(after.find((x) => x.id === c.id).coins.gp, 3);
  const p1 = await connect('jugador1');
  const thorin = p1.state.characters.find((c) => c.name.startsWith('Thorin'));
  const other = pcs.find((c) => c.id !== thorin.id);
  assert.ok((await p1.emit('coins:give', { fromId: thorin.id, toId: other.id, coins: { gp: 2 } })).ok);
  assert.match((await p1.emit('coins:give', { fromId: thorin.id, toId: other.id, coins: { gp: 5 } })).error, /No tienes 5 po/);
  dm.socket.close();
  p1.socket.close();
});

test('un objeto propio colocado en el mapa llega al inventario con sus datos al recogerlo', async () => {
  const dm = await connect('dm');
  const p1 = await connect('jugador1');
  const thorin = p1.state.characters.find((c) => c.name.startsWith('Thorin'));
  const tok = p1.state.tokens.find((t) => t.characterId === thorin.id);
  const grid = p1.state.scene?.grid?.size || 70;
  await dm.emit('token:add', {
    name: 'Hacha rúnica', img: '/assets/objects/bolsa.svg', hp: 1, maxHp: 1, size: 1, kind: 'objeto', x: tok.x + grid, y: tok.y,
    object: { use: 'recoger', description: 'Runas que brillan', item: { name: 'Hacha rúnica', kind: 'arma', weapon: { damage: '1d10', dmgType: 'cortante' }, weight: 4, value: 300 } },
  });
  const placed = (await p1.emit('join', { id: dm.state.id })).state.tokens.find((t) => t.name === 'Hacha rúnica');
  const res = await p1.emit('object:interact', { id: placed.id, characterId: thorin.id });
  assert.ok(res.ok, res.error);
  const axe = (await p1.characters()).find((c) => c.id === thorin.id).inventory.find((i) => i.name === 'Hacha rúnica');
  assert.strictEqual(axe.kind, 'arma');
  assert.strictEqual(axe.weapon.damage, '1d10');
  assert.strictEqual(axe.value, 300);
  dm.socket.close();
  p1.socket.close();
});
