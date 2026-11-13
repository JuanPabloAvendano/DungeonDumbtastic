// Persistencia en SQLite: migración desde db.json, guardado entre reinicios e instantánea para el respaldo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/** Ejecuta código contra server/db.js en un proceso nuevo (como un reinicio del servidor). */
function inFreshProcess(dataDir, code) {
  const script = `const m = require(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))});\n${code}`;
  return execFileSync('node', ['--no-warnings', '-e', script], { env: { ...process.env, DATA_DIR: dataDir } }).toString().trim();
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'da-db-'));

test('la primera vez migra db.json a SQLite y aparta el JSON', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', username: 'ana' }], campaigns: [] }));
  const out = inFreshProcess(dir, 'console.log(m.db().users[0].username, m.db().notes.length)');
  assert.strictEqual(out, 'ana 0');
  assert.ok(fs.existsSync(path.join(dir, 'db.sqlite')));
  assert.ok(!fs.existsSync(path.join(dir, 'db.json')));
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('db.json.migrado-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lo guardado sobrevive a un reinicio', () => {
  const dir = tempDir();
  inFreshProcess(dir, "m.db().users.push({ id: 'u2', username: 'beto' }); m.db().settings.openRegistration = false; m.flush();");
  const out = inFreshProcess(dir, 'console.log(m.db().users.map((u) => u.username).join(","), m.db().settings.openRegistration)');
  assert.strictEqual(out, 'beto false');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la instantánea es una base SQLite completa que se puede abrir sola', () => {
  const dir = tempDir();
  const snap = path.join(dir, 'copia.sqlite');
  inFreshProcess(dir, `m.db().notes.push({ id: 'n1', text: 'hola' }); m.snapshot(${JSON.stringify(snap)});`);
  const other = tempDir();
  fs.copyFileSync(snap, path.join(other, 'db.sqlite'));
  assert.strictEqual(inFreshProcess(other, 'console.log(m.db().notes[0].text)'), 'hola');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test('cada guardado con cambios deja la hora en meta.savedAt (viaja con la base)', () => {
  const dir = tempDir();
  const out = inFreshProcess(dir, "const a = m.db().meta.savedAt; m.db().notes.push({ id: 'n2' }); m.flush(); const b = m.db().meta.savedAt; m.flush(); console.log(b > a, m.db().meta.savedAt === b)");
  assert.strictEqual(out, 'true true');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bootSavedAt recuerda con qué datos arrancó aunque luego se guarde más', () => {
  const dir = tempDir();
  const first = inFreshProcess(dir, "m.db().notes.push({ id: 'n3' }); m.flush(); console.log(m.savedAt())");
  const out = inFreshProcess(dir, "const boot = m.bootSavedAt(); m.db().notes.push({ id: 'n4' }); m.flush(); console.log(boot, m.savedAt() > boot)");
  assert.strictEqual(out, `${first} true`);
  fs.rmSync(dir, { recursive: true, force: true });
});
