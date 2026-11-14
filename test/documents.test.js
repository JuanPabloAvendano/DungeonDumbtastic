// Documentos propios: subir, ver (yo y con quien lo comparto), buscar dentro y borrar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { canSee, searchPages } = require('../server/documents');

const ROOT = path.join(__dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-docs-'));
let server;
const creds = {};
const tokens = {};

async function token(username) {
  if (!tokens[username]) {
    const res = await fetch(`${URL_BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: creds[username] }),
    });
    tokens[username] = (await res.json()).token;
  }
  return tokens[username];
}

async function call(username, method, url, body) {
  const res = await fetch(`${URL_BASE}/api${url}`, {
    method, headers: { authorization: `Bearer ${await token(username)}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), res };
}

async function upload(username, name, type, content, title) {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), name);
  if (title) form.append('title', title);
  const res = await fetch(`${URL_BASE}/api/documentos`, { method: 'POST', headers: { authorization: `Bearer ${await token(username)}` }, body: form });
  return { status: res.status, body: await res.json() };
}

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  creds.admin = 'admin-test-1';
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

test('quién ve un documento: el dueño, y los jugadores con quienes se compartió', () => {
  const camp = { id: 'c1', dmId: 'dm', playerIds: ['p1', 'p2'] };
  const doc = { ownerId: 'dm', shares: [{ campaignId: 'c1', userIds: ['p1'] }] };
  assert.ok(canSee(doc, { id: 'dm' }, [camp]));
  assert.ok(canSee(doc, { id: 'p1' }, [camp]));
  assert.ok(!canSee(doc, { id: 'p2' }, [camp]));
  assert.ok(canSee({ ...doc, shares: [{ campaignId: 'c1', userIds: null }] }, { id: 'p2' }, [camp]), 'null = todos los jugadores');
  assert.ok(!canSee({ ...doc, shares: [{ campaignId: 'c1', userIds: null }] }, { id: 'extraño' }, [camp]));
});

test('la búsqueda encuentra sin tildes ni mayúsculas y dice la página', () => {
  const hits = searchPages(['Primera página sin nada', 'El Dragón rojo duerme bajo la montaña'], 'dragon')[0];
  assert.strictEqual(hits.page, 2);
  assert.match(hits.snippet, /Dragón rojo/);
  assert.deepStrictEqual(searchPages(['nada'], 'dragon'), []);
});

test('subir un PDF: se guarda privado, se extrae su texto y se busca por página', async () => {
  const up = await upload('dm', 'mini.pdf', 'application/pdf', fs.readFileSync(path.join(__dirname, 'fixtures', 'mini.pdf')), 'Notas del dragón');
  assert.strictEqual(up.status, 200, JSON.stringify(up.body));
  assert.strictEqual(up.body.document.pages, 2);
  const found = await call('dm', 'GET', '/documentos/buscar?q=tesoro');
  assert.strictEqual(found.body.results[0].page, 2);
  assert.strictEqual((await call('jugador1', 'GET', '/documentos')).body.documents.length, 0, 'sin compartir, el jugador no lo ve');
  assert.strictEqual((await call('jugador1', 'GET', `/documentos/${up.body.document.id}/archivo`)).status, 404);
  const direct = await fetch(`${URL_BASE}/docs/${up.body.document.file}`);
  assert.doesNotMatch(direct.headers.get('content-type') || '', /pdf/, 'el archivo no se sirve por URL directa');
});

test('el DM lo comparte con un jugador concreto: ese lo ve, lo busca y lo descarga; el otro no', async () => {
  const { body } = await upload('dm', 'pistas.md', 'text/markdown', '# Pistas\nLa llave está en el pozo.', 'Pistas');
  const id = body.document.id;
  const { campaigns } = (await call('dm', 'GET', '/campaigns')).body;
  const users = (await call('admin', 'GET', '/admin/users')).body.users;
  const p1 = users.find((u) => u.username === 'jugador1');
  const shared = await call('dm', 'PATCH', `/documentos/${id}`, { shares: [{ campaignId: campaigns[0].id, userIds: [p1.id] }] });
  assert.strictEqual(shared.status, 200, JSON.stringify(shared.body));
  assert.ok((await call('jugador1', 'GET', '/documentos')).body.documents.some((d) => d.id === id));
  assert.ok(!(await call('jugador2', 'GET', '/documentos')).body.documents.some((d) => d.id === id));
  assert.strictEqual((await call('jugador1', 'GET', '/documentos/buscar?q=pozo')).body.results[0].id, id);
  const file = await call('jugador1', 'GET', `/documentos/${id}/archivo`);
  assert.strictEqual(file.status, 200);
  assert.strictEqual((await call('jugador1', 'PATCH', `/documentos/${id}`, { title: 'mío' })).status, 404, 'solo el dueño lo cambia');
  assert.strictEqual((await call('jugador1', 'PATCH', `/documentos/${id}`, { shares: [] })).status, 404);
});

test('un jugador no puede compartir en una campaña donde no es DM', async () => {
  const { body } = await upload('jugador1', 'diario.txt', 'text/plain', 'Mi diario secreto');
  const { campaigns } = (await call('jugador1', 'GET', '/campaigns')).body;
  const res = await call('jugador1', 'PATCH', `/documentos/${body.document.id}`, { shares: [{ campaignId: campaigns[0].id, userIds: null }] });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /Solo el DM/);
});

test('tipos no permitidos se rechazan y borrar quita el archivo', async () => {
  const bad = await upload('dm', 'virus.exe', 'application/x-msdownload', 'MZ');
  assert.strictEqual(bad.status, 400);
  const { body } = await upload('dm', 'tmp.txt', 'text/plain', 'borrame');
  const file = path.join(DATA_DIR, 'docs', body.document.file);
  assert.ok(fs.existsSync(file));
  assert.strictEqual((await call('dm', 'DELETE', `/documentos/${body.document.id}`)).status, 200);
  assert.ok(!fs.existsSync(file));
});
