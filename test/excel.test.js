// Plantillas de Excel: la plantilla sigue a las reglas del juego y la importación crea personajes,
// objetos, inventarios, escenas y fichas, con un informe de errores por fila.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const { SHEETS, uncoveredFields } = require('../server/import-schema');

const ROOT = path.join(__dirname, '..');
const PORT = 3300 + Math.floor(Math.random() * 90);
const URL_BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'da-excel-'));
let server;
const creds = {};
let dmToken;

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  server = spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${URL_BASE}/healthz`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'dm', password: creds.dm }) });
  dmToken = (await login.json()).token;
});

test.after(() => {
  server?.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const api = (url, opts = {}) => fetch(`${URL_BASE}/api${url}`, { ...opts, headers: { authorization: `Bearer ${dmToken}`, ...(opts.headers || {}) } });

test('la plantilla cubre todo lo que aceptan personajes, objetos y objetos del mapa (si se añade un campo, este test avisa)', () => {
  assert.deepStrictEqual(uncoveredFields(), []);
});

test('la plantilla descargada trae una hoja por tipo, encabezados y listas desplegables', async () => {
  const res = await api('/excel/plantilla');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  for (const sheet of SHEETS) {
    const ws = wb.getWorksheet(sheet.name);
    assert.ok(ws, `falta la hoja ${sheet.name}`);
    assert.strictEqual(ws.getRow(1).getCell(1).value, sheet.columns[0].header);
  }
  const kindCol = SHEETS.find((s) => s.name === 'Objetos').columns.findIndex((c) => c.key === 'kind') + 1;
  assert.match(JSON.stringify(wb.getWorksheet('Objetos').getCell(3, kindCol).dataValidation), /armadura/);
  assert.ok(wb.getWorksheet('Instrucciones'));
});

/** Rellena una plantilla nueva con filas { hoja: [ {encabezado: valor} ] }. */
async function filled(rows) {
  const res = await api('/excel/plantilla');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  for (const [name, list] of Object.entries(rows)) {
    const ws = wb.getWorksheet(name);
    const headers = ws.getRow(1).values.slice(1);
    ws.spliceRows(2, ws.rowCount);
    list.forEach((row, i) => headers.forEach((hd, j) => { if (row[hd] !== undefined) ws.getCell(i + 2, j + 1).value = row[hd]; }));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function importFile(buffer, dry) {
  const { campaigns } = await (await api('/campaigns')).json();
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'partida.xlsx');
  const res = await api(`/campaigns/${campaigns[0].id}/importar${dry ? '?prueba=1' : ''}`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json(), campaignId: campaigns[0].id };
}

test('importar crea personajes con inventario equipado, mis objetos, escenas y fichas; la prueba no guarda nada', async () => {
  const header = (sheet, key) => SHEETS.find((s) => s.name === sheet).columns.find((c) => c.key === key).header;
  const buffer = await filled({
    Personajes: [
      { [header('Personajes', 'name')]: 'Grimbold', [header('Personajes', 'str')]: 16, [header('Personajes', 'dex')]: 12, [header('Personajes', 'gp')]: 40 },
      { [header('Personajes', 'name')]: 'Nueva de jugador1', [header('Personajes', 'player')]: 'jugador1' },
    ],
    Objetos: [{ [header('Objetos', 'name')]: 'Hacha rúnica', [header('Objetos', 'kind')]: 'arma', [header('Objetos', 'damage')]: '1d10', [header('Objetos', 'value')]: 300, [header('Objetos', 'use')]: 'recoger' }],
    Inventario: [
      { [header('Inventario', 'character')]: 'Grimbold', [header('Inventario', 'item')]: 'Hacha rúnica', [header('Inventario', 'equipped')]: 'sí' },
      { [header('Inventario', 'character')]: 'Grimbold', [header('Inventario', 'item')]: 'Cota de malla', [header('Inventario', 'equipped')]: 'sí' },
    ],
    Escenas: [{ [header('Escenas', 'name')]: 'La forja' }],
    Fichas: [
      { [header('Fichas', 'scene')]: 'La forja', [header('Fichas', 'name')]: 'Grimbold', [header('Fichas', 'type')]: 'npc', [header('Fichas', 'col')]: 3, [header('Fichas', 'row')]: 4 },
      { [header('Fichas', 'scene')]: 'La forja', [header('Fichas', 'name')]: 'Hacha rúnica', [header('Fichas', 'type')]: 'objeto', [header('Fichas', 'col')]: 5, [header('Fichas', 'row')]: 4 },
      { [header('Fichas', 'scene')]: 'La forja', [header('Fichas', 'name')]: 'Ogro', [header('Fichas', 'type')]: 'criatura', [header('Fichas', 'hp')]: 59, [header('Fichas', 'size')]: 2, [header('Fichas', 'hidden')]: 'sí' },
    ],
  });
  const dry = await importFile(buffer, true);
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.body));
  assert.deepStrictEqual(dry.body.errors, []);
  assert.deepStrictEqual(dry.body.created, { characters: 2, templates: 1, items: 2, scenes: 1, tokens: 3 });
  assert.strictEqual(dry.body.saved, false);
  const before = await (await api('/characters')).json();
  assert.ok(!(before.characters || before).some((c) => c.name === 'Grimbold'), 'la prueba no guarda');

  const real = await importFile(buffer, false);
  assert.strictEqual(real.body.saved, true);
  const chars = await (await api('/characters')).json();
  const grim = (chars.characters || chars).find((c) => c.name === 'Grimbold');
  assert.ok(grim, 'sin jugador: es un NPC del DM');
  assert.strictEqual(grim.ac, 16, 'cota de malla equipada');
  assert.strictEqual(grim.coins.gp, 40);
  assert.strictEqual(grim.inventory.find((i) => i.name === 'Hacha rúnica').weapon.damage, '1d10');
  const login = await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'jugador1', password: creds.jugador1 }) });
  const mine = await (await fetch(`${URL_BASE}/api/characters`, { headers: { authorization: `Bearer ${(await login.json()).token}` } })).json();
  assert.ok((mine.characters || mine).some((c) => c.name === 'Nueva de jugador1'), 'con jugador: es suyo');
  const tpls = (await (await api('/plantillas')).json()).templates;
  assert.ok(tpls.some((t) => t.name === 'Hacha rúnica'));
});

test('las filas con errores se informan con hoja y fila y no se importan', async () => {
  const header = (sheet, key) => SHEETS.find((s) => s.name === sheet).columns.find((c) => c.key === key).header;
  const buffer = await filled({
    Personajes: [{ [header('Personajes', 'race')]: 'Sin nombre' }],
    Objetos: [{ [header('Objetos', 'name')]: 'Rara', [header('Objetos', 'kind')]: 'nave espacial' }],
    Fichas: [{ [header('Fichas', 'scene')]: 'No existe', [header('Fichas', 'name')]: 'X' }],
  });
  const res = await importFile(buffer, true);
  const where = res.body.errors.map((e) => `${e.sheet}:${e.row}`);
  assert.deepStrictEqual(where, ['Personajes:2', 'Objetos:2', 'Fichas:2']);
  assert.match(res.body.errors[1].message, /nave espacial/);
});

test('solo el DM de la campaña importa', async () => {
  const { campaigns } = await (await api('/campaigns')).json();
  const login = await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'jugador1', password: creds.jugador1 }) });
  const { token } = await login.json();
  const form = new FormData();
  form.append('file', new Blob(['x']), 'a.xlsx');
  const res = await fetch(`${URL_BASE}/api/campaigns/${campaigns[0].id}/importar`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  assert.strictEqual(res.status, 403);
});
