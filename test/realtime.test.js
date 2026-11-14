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

async function call(username, method, url, body) {
  const token = await login(username);
  const res = await fetch(`${URL_BASE}/api${url}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const nextEvent = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
/** Espera al primer evento que cumpla la condición (con carga, pueden colarse avisos anteriores). */
const waitFor = (socket, event, pred) => new Promise((resolve) => {
  const fn = (v) => { if (pred(v)) { socket.off(event, fn); resolve(v); } };
  socket.on(event, fn);
});

test.before(async () => {
  const out = execFileSync('node', ['scripts/demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR, ADMIN_PASSWORD: 'admin-test-1' } }).toString();
  for (const m of out.matchAll(/(\w+)\s+contraseña: (\S+)/g)) creds[m[1]] = m[2];
  creds.admin = 'admin-test-1';
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

test('la escena en preparación no llega a los jugadores hasta lanzarla', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const before = pl.state.scene.id;
  const leaked = [];
  pl.socket.on('scene:state', (v) => leaked.push(v));
  const { id } = await dm.emit('scene:create', { name: 'Emboscada', tokens: [{ name: 'Orco', hp: 15, maxHp: 15, x: 70, y: 70 }] });
  await dm.emit('token:add', { name: 'Orco', x: 140, y: 70 });
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(leaked.length, 0);
  assert.strictEqual((await pl.emit('refresh', null)).state.scene.id, before);

  const arrived = new Promise((resolve) => pl.socket.once('scene:state', resolve));
  await dm.emit('scene:launch', { id });
  const view = await arrived;
  assert.strictEqual(view.arrived, true);
  assert.strictEqual(view.scene.name, 'Emboscada');
  assert.deepStrictEqual(view.tokens.map((t) => t.name), ['Orco', 'Orco 2']);
  assert.strictEqual(view.scenes, null);
  await dm.emit('scene:launch', { id: before });
  dm.socket.close();
  pl.socket.close();
});

test('escenas paralelas: cada jugador ve solo la suya', async () => {
  const dm = await connect('dm');
  const main = dm.state.activeSceneId;
  const { id } = await dm.emit('scene:create', { name: 'Calabozo de Lyra' });
  const lyra = dm.state.users.find((u) => u.username === 'jugador2');
  await dm.emit('scene:launch', { id, userIds: [lyra.id] });
  const p1 = await connect('jugador1');
  const p2 = await connect('jugador2');
  assert.strictEqual(p1.state.scene.id, main);
  assert.strictEqual(p2.state.scene.id, id);
  assert.match((await dm.emit('scene:delete', { id })).error, /jugadores/);
  await dm.emit('scene:launch', { id: main });
  assert.deepStrictEqual(await dm.emit('scene:delete', { id }), { ok: true });
  [dm, p1, p2].forEach((x) => x.socket.close());
});

test('en combate el jugador solo se mueve en su turno y como mucho las casillas del turno', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const g = pl.state.scene.grid.size;
  const mine = pl.state.tokens.find((t) => t.ownerId && t.name.startsWith('Thorin'));
  const goblin = dm.state.tokens.find((t) => t.name === 'Goblin');
  await dm.emit('initiative:set', { entries: [{ tokenId: goblin.id, name: 'Goblin', value: 20 }, { tokenId: mine.id, name: 'Thorin', value: 10 }], turn: 0, round: 1 });
  assert.match((await pl.emit('token:update', { id: mine.id, x: mine.x + g, y: mine.y, final: true })).error, /No es tu turno/);
  assert.match((await pl.emit('turn:end', {})).error, /No es tu turno/);
  assert.match((await pl.emit('roll', { expr: '1d20' })).error, /No es tu turno/);
  assert.ok((await pl.emit('roll', { expr: '1d20', reaction: true })).ok);
  assert.match((await pl.emit('roll', { expr: '1d20', reaction: true })).error, /Ya usaste/);

  await dm.emit('turn:end', {});
  assert.match((await pl.emit('token:update', { id: mine.id, x: mine.x + 6 * g, y: mine.y, final: true })).error, /quedan 5/);
  assert.ok((await pl.emit('token:update', { id: mine.id, x: mine.x + 3 * g, y: mine.y + 3 * g, final: true })).ok);
  assert.match((await pl.emit('token:update', { id: mine.id, x: mine.x + 6 * g, y: mine.y + 3 * g, final: true })).error, /quedan 2/);
  const state = (await pl.emit('refresh', null)).state;
  assert.strictEqual(state.initiative.turnState.used, 3);
  assert.ok((await pl.emit('turn:end', {})).ok);
  await dm.emit('initiative:set', { entries: [] });
  await pl.emit('token:update', { id: mine.id, x: mine.x, y: mine.y, final: true });
  dm.socket.close();
  pl.socket.close();
});

test('bestiario propio: cada DM ve y borra solo sus bestias, y se valida lo que se guarda', async () => {
  const call = async (username, method, url, body) => {
    const token = await login(username);
    const res = await fetch(`${URL_BASE}/api${url}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const created = await call('dm', 'POST', '/bestiary', { name: 'Devuelto', img: '/uploads/devuelto.png', hp: 22, size: 1 });
  assert.strictEqual(created.status, 200);
  assert.deepStrictEqual({ ...created.body.beast, id: undefined }, { id: undefined, name: 'Devuelto', img: '/uploads/devuelto.png', hp: 22, size: 1 });

  const list = await call('dm', 'GET', '/bestiary');
  assert.ok(list.body.bestiary.some((b) => b.id === created.body.beast.id));

  assert.strictEqual((await call('jugador1', 'GET', '/bestiary')).status, 403);
  assert.strictEqual((await call('dm', 'POST', '/bestiary', { name: 'X', img: 'javascript:alert(1)', hp: 5 })).status, 400);
  assert.strictEqual((await call('admin', 'DELETE', `/bestiary/${created.body.beast.id}`)).status, 404);
  assert.ok(!(await call('admin', 'GET', '/bestiary')).body.bestiary.some((b) => b.id === created.body.beast.id));

  assert.strictEqual((await call('dm', 'DELETE', `/bestiary/${created.body.beast.id}`)).status, 200);
  assert.ok(!(await call('dm', 'GET', '/bestiary')).body.bestiary.some((b) => b.id === created.body.beast.id));
});

test('los NPC del DM tienen hoja completa, pero los jugadores solo ven nombre, retrato y vida de los que tienen a la vista', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const live = nextEvent(pl.socket, 'characters');
  const npc = { name: 'Vizconde Drael', race: 'Humano', cls: 'Mago', level: 7, ac: 15, hp: 40, maxHp: 40, stats: { int: 18 }, notes: 'Es el villano', campaignId: dm.state.id };
  const { status, body } = await call('dm', 'POST', '/characters', npc);
  assert.strictEqual(status, 200);
  assert.ok(!(await live).some((c) => c.id === body.character.id), 'sin ficha a la vista, el jugador no sabe que existe');
  const dmView = (await dm.emit('refresh')).state.characters.find((c) => c.id === body.character.id);
  assert.strictEqual(dmView.stats.int, 18);
  assert.strictEqual(dmView.notes, 'Es el villano');
  // Al colocar su ficha junto al grupo, el jugador recibe solo lo público.
  const pc = pl.state.tokens.find((t) => t.characterId && t.ownerId);
  const placed = nextEvent(pl.socket, 'scene:state');
  await dm.emit('token:add', { characterId: body.character.id, x: pc.x, y: pc.y });
  const seen = (await placed).characters.find((c) => c.id === body.character.id);
  // La voz va incluida para que los jugadores oigan al NPC con la voz que eligió el DM.
  assert.deepStrictEqual(Object.keys(seen).sort(), ['campaignId', 'hp', 'id', 'maxHp', 'name', 'npc', 'ownerId', 'portrait', 'voice']);
  assert.ok(pl.state.characters.some((c) => !c.npc && c.stats), 'los personajes de los jugadores no se recortan');
  dm.socket.close();
  pl.socket.close();
});

test('la visión con niebla solo la cambia el DM', async () => {
  const pl = await connect('jugador1');
  const mine = pl.state.characters.find((c) => !c.npc && pl.state.users.find((u) => u.id === c.ownerId)?.username === 'jugador1');
  const res = await call('jugador1', 'PATCH', `/characters/${mine.id}`, { ...mine, vision: 60 });
  assert.notStrictEqual(res.body.character.vision, 60);
  const byDm = await call('dm', 'PATCH', `/characters/${mine.id}`, { ...mine, vision: 12 });
  assert.strictEqual(byDm.body.character.vision, 12);
  pl.socket.close();
});

test('hablar como: cada uno firma con sus personajes y solo el DM saca diálogos de NPC', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const mine = pl.state.characters.find((c) => c.ownerId && !c.npc && pl.state.users.find((u) => u.id === c.ownerId)?.username === 'jugador1');
  const npc = (await dm.emit('refresh')).state.characters.find((c) => c.npc);
  const say = async (who, payload) => {
    const got = nextEvent(who.socket, 'log');
    await who.emit('chat', payload);
    return got;
  };
  const asMine = await say(pl, { text: 'Hola', characterId: mine.id });
  assert.strictEqual(asMine.name, mine.name);
  assert.strictEqual(asMine.as, true);
  // Un jugador no puede hacerse pasar por un NPC ni sacar diálogos.
  const spoof = await say(pl, { text: 'Soy el villano', characterId: npc.id, dialog: true });
  assert.notStrictEqual(spoof.name, npc.name);
  assert.ok(!spoof.dialog);
  const line = await say(dm, { text: 'Bienvenidos a mi castillo', characterId: npc.id, dialog: true });
  assert.strictEqual(line.name, npc.name);
  assert.strictEqual(line.dialog, true);
  assert.strictEqual(line.sceneId, dm.state.scene.id);
  dm.socket.close();
  pl.socket.close();
});

test('un jugador puede llevar dos personajes en la misma campaña y colocar los dos', async () => {
  const pl = await connect('jugador1');
  const { body } = await call('jugador1', 'POST', '/characters', { name: 'Gemelo', campaignId: pl.state.id });
  const state = (await pl.emit('refresh')).state;
  const me = state.characters.find((c) => c.id === body.character.id).ownerId;
  assert.ok(state.characters.filter((c) => c.ownerId === me).length >= 2);
  assert.deepStrictEqual(await pl.emit('token:add', { characterId: body.character.id, x: 0, y: 0 }), { ok: true });
  const roll = nextEvent(pl.socket, 'log');
  await pl.emit('roll', { expr: '1d20', label: 'Percepción', characterId: body.character.id });
  assert.strictEqual((await roll).name, 'Gemelo');
  pl.socket.close();
});

test('taller de mapas: borradores y objetos son de cada DM y el mapa terminado llega a la campaña', async () => {
  const dm = await connect('dm');
  const draft = { name: 'Cripta retocada', baseUrl: '/uploads/base.webp', width: 1400, height: 1050, grid: 70,
    stamps: [{ url: '/uploads/carro.png', x: 10, y: 20, w: 140, h: 90, rot: 45, flip: true }, { url: 'https://malo.example/x.png' }] };
  const created = await call('dm', 'POST', '/studio/drafts', draft);
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.draft.stamps.length, 1, 'descarta objetos con URL externa');
  assert.strictEqual((await call('dm', 'POST', '/studio/drafts', { ...draft, baseUrl: 'javascript:alert(1)' })).status, 400);
  assert.strictEqual((await call('jugador1', 'GET', '/studio/drafts')).status, 403);
  assert.strictEqual((await call('admin', 'GET', `/studio/drafts/${created.body.draft.id}`)).status, 404);
  const patched = await call('dm', 'PATCH', `/studio/drafts/${created.body.draft.id}`, { name: 'Cripta final', stamps: [] });
  assert.strictEqual(patched.body.draft.name, 'Cripta final');
  assert.strictEqual(patched.body.draft.baseUrl, '/uploads/base.webp');

  const stamp = await call('dm', 'POST', '/studio/stamps', { name: 'Carruaje', url: '/uploads/carro.png' });
  assert.ok((await call('dm', 'GET', '/studio/stamps')).body.stamps.some((x) => x.id === stamp.body.stamp.id));
  assert.ok(!(await call('admin', 'GET', '/studio/stamps')).body.stamps.some((x) => x.id === stamp.body.stamp.id));

  const live = nextEvent(dm.socket, 'maps');
  const sent = await call('dm', 'POST', `/campaigns/${dm.state.id}/maps`, { name: 'Cripta final', url: '/uploads/final.webp' });
  assert.strictEqual(sent.status, 200);
  assert.ok((await live).some((m) => m.url === '/uploads/final.webp'));
  assert.strictEqual((await call('jugador1', 'POST', `/campaigns/${dm.state.id}/maps`, { name: 'x', url: '/uploads/x.png' })).status, 403);
  assert.strictEqual((await call('dm', 'DELETE', `/studio/drafts/${created.body.draft.id}`)).status, 200);
  dm.socket.close();
});

test('niebla: el jugador no recibe las fichas lejos de su grupo hasta que el DM las revela', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const far = { name: 'Acechador', img: '/assets/demo/token-lobo.svg', hp: 5, maxHp: 5, x: 30000, y: 30000 };
  await dm.emit('token:add', far);
  const seen = waitFor(pl.socket, 'scene:state', (v) => v.scene.fog.on);
  assert.deepStrictEqual(await dm.emit('fog:set', { on: true }), { ok: true });
  const view = await seen;
  assert.strictEqual(view.scene.fog.on, true);
  assert.ok(!view.tokens.some((t) => t.name === 'Acechador'));
  const hiddenId = (await dm.emit('refresh')).state.tokens.find((t) => t.name === 'Acechador').id;
  const iniSeen = waitFor(pl.socket, 'scene:state', (v) => v.initiative.entries.length === 1);
  await dm.emit('initiative:set', { entries: [{ tokenId: hiddenId, name: 'Acechador', value: 15, img: '/assets/demo/token-lobo.svg' }], turn: 0, round: 1 });
  const entry = (await iniSeen).initiative.entries[0];
  assert.deepStrictEqual([entry.name, entry.img], ['¿?', null], 'la iniciativa no delata a quien está en la niebla');
  await dm.emit('initiative:set', { entries: [] });
  assert.ok(view.scene.fog.explored.length > 0, 'lo que ven los personajes queda explorado');
  assert.match((await pl.emit('fog:paint', { cells: ['1,1'], mode: 'reveal' })).error, /Solo el DM/);
  const { size, ox, oy } = view.scene.grid;
  const cell = `${Math.floor((30000 - ox) / size)},${Math.floor((30000 - oy) / size)}`;
  const revealed = waitFor(pl.socket, 'scene:state', (v) => v.tokens.some((t) => t.name === 'Acechador'));
  await dm.emit('fog:paint', { cells: [cell], mode: 'reveal' });
  assert.ok((await revealed).tokens.some((t) => t.name === 'Acechador'));
  await dm.emit('fog:set', { on: false, reset: true });
  const added = (await dm.emit('refresh')).state.tokens.find((t) => t.name === 'Acechador');
  await dm.emit('token:remove', { id: added.id });
  dm.socket.close();
  pl.socket.close();
});

test('traer un personaje a la campaña lo ve el DM al momento, sin recargar', async () => {
  const dm = await connect('dm');
  const loose = (await call('jugador2', 'POST', '/characters', { name: 'Recién llegado' })).body.character;
  const live = nextEvent(dm.socket, 'characters');
  await call('jugador2', 'PATCH', `/characters/${loose.id}`, { ...loose, campaignId: dm.state.id });
  assert.ok((await live).some((c) => c.id === loose.id));
  dm.socket.close();
});

test('el lobby se entera solo cuando el DM añade o quita a un jugador', async () => {
  const lobby = io(URL_BASE, { auth: { token: await login('jugador3') }, transports: ['websocket'] });
  await new Promise((resolve) => lobby.on('connect', resolve));
  const { body } = await call('dm', 'POST', '/campaigns', { name: 'Campaña nueva' });
  const added = nextEvent(lobby, 'lobby:refresh');
  await call('dm', 'POST', `/campaigns/${body.campaign.id}/players`, { username: 'jugador3' });
  await added;
  const removed = nextEvent(lobby, 'campaign:removed');
  await call('dm', 'DELETE', `/campaigns/${body.campaign.id}/players/${(await call('jugador3', 'GET', '/me')).body.user.id}`);
  assert.strictEqual((await removed).id, body.campaign.id);
  await call('dm', 'DELETE', `/campaigns/${body.campaign.id}`);
  lobby.close();
});

test('notas: cada uno ve solo las suyas, el DM las ata a cualquier personaje y el HTML se limpia', async () => {
  const dm = await connect('dm');
  const cid = dm.state.id;
  const others = dm.state.characters.filter((c) => !c.npc);
  const j1 = dm.state.users.find((u) => u.username === 'jugador1').id;
  const notJ1 = others.find((c) => c.ownerId !== j1);
  const created = await call('dm', 'POST', `/campaigns/${cid}/notes`, { title: 'Sospechoso', characterId: notJ1.id, html: '<b onclick="x()">Miente</b><script>alert(1)</script><img src=x onerror=alert(1)>' });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.note.html, '<b>Miente</b>');
  assert.strictEqual(created.body.note.preview, 'Miente');
  const mineJ1 = await call('jugador1', 'POST', `/campaigns/${cid}/notes`, { title: 'Lo que pasó', html: '<h3>Día 1</h3><ul><li>Cripta</li></ul>' });
  assert.strictEqual(mineJ1.body.note.html, '<h3>Día 1</h3><ul><li>Cripta</li></ul>');
  // El jugador no puede atar una nota al personaje de otro ni ver ni tocar las del DM.
  assert.strictEqual((await call('jugador1', 'POST', `/campaigns/${cid}/notes`, { characterId: notJ1.id })).status, 400);
  const listJ1 = (await call('jugador1', 'GET', `/campaigns/${cid}/notes`)).body.notes;
  assert.ok(listJ1.some((n) => n.id === mineJ1.body.note.id));
  assert.ok(!listJ1.some((n) => n.id === created.body.note.id));
  assert.strictEqual((await call('jugador1', 'PATCH', `/campaigns/${cid}/notes/${created.body.note.id}`, { html: 'hack' })).status, 404);
  assert.strictEqual((await call('jugador1', 'DELETE', `/campaigns/${cid}/notes/${created.body.note.id}`)).status, 404);
  const edited = await call('dm', 'PATCH', `/campaigns/${cid}/notes/${created.body.note.id}`, { html: '<i>Ahora</i> <u>sí</u>' });
  assert.strictEqual(edited.body.note.html, '<i>Ahora</i> <u>sí</u>');
  assert.strictEqual(edited.body.note.characterId, notJ1.id);
  assert.strictEqual((await call('dm', 'DELETE', `/campaigns/${cid}/notes/${created.body.note.id}`)).status, 200);
  dm.socket.close();
});

test('objetos: se usan de cerca, guardan sus secretos y pasan al inventario', async () => {
  const dm = await connect('dm');
  const pl = await connect('jugador1');
  const g = dm.state.scene.grid.size;
  const pc = pl.state.tokens.find((t) => t.characterId && pl.state.characters.find((c) => c.id === t.characterId && !c.npc && c.ownerId === t.ownerId) && t.ownerId === pl.state.characters.find((c) => c.id === t.characterId).ownerId && pl.state.users.find((u) => u.id === t.ownerId)?.username === 'jugador1');
  const place = async (name, object, dx) => {
    await dm.emit('token:add', { name, img: '/assets/objects/cofre.svg', kind: 'objeto', object, x: pc.x + dx * g, y: pc.y });
    return (await dm.emit('refresh')).state.tokens.find((t) => t.name === name);
  };
  const chest = await place('Cofre de prueba', { use: 'abrir', description: 'Un cofre', secret: 'Tiene trampa', contents: [{ name: 'Rubí', qty: 2 }] }, 1);
  const letter = await place('Carta de prueba', { use: 'leer', text: 'Nos vemos a medianoche' }, -1);
  const far = await place('Amuleto lejano', { use: 'recoger' }, 8);
  const door = await place('Puerta cerrada', { use: 'abrir', locked: true }, 0.99);

  const view = (await pl.emit('refresh')).state.tokens;
  const seenChest = view.find((t) => t.id === chest.id);
  assert.strictEqual(seenChest.object.secret, undefined, 'la nota del DM no llega');
  assert.strictEqual(seenChest.object.contents, null, 'el contenido cerrado no llega');
  assert.strictEqual(view.find((t) => t.id === letter.id).object.text, undefined, 'el texto sin leer no llega');

  assert.match((await pl.emit('object:interact', { id: far.id, characterId: pc.characterId })).error, /lejos/);
  assert.match((await pl.emit('object:interact', { id: door.id, characterId: pc.characterId })).error, /cerrad/);
  const opened = await pl.emit('object:interact', { id: chest.id, characterId: pc.characterId });
  assert.match(opened.result, /Rubí/);
  const open = (await pl.emit('refresh')).state.tokens.find((t) => t.id === chest.id).object;
  assert.strictEqual(open.contents[0].name, 'Rubí');
  await pl.emit('object:take', { id: chest.id, itemId: open.contents[0].id, characterId: pc.characterId });
  const read = await pl.emit('object:interact', { id: letter.id, characterId: pc.characterId });
  assert.strictEqual(read.text, 'Nos vemos a medianoche');

  const me = (await pl.emit('refresh')).state.characters.find((c) => c.id === pc.characterId);
  const rubi = me.inventory.find((i) => i.name === 'Rubí');
  assert.strictEqual(rubi.qty, 2);
  // Soltarlo lo deja en el mapa como objeto que se puede recoger, y recogerlo lo devuelve.
  await pl.emit('item:drop', { characterId: me.id, itemId: rubi.id });
  const dropped = (await pl.emit('refresh')).state.tokens.find((t) => t.name === 'Rubí');
  assert.deepStrictEqual([dropped.kind, dropped.object.use], ['objeto', 'recoger']);
  await pl.emit('object:interact', { id: dropped.id, characterId: me.id });
  const after = (await pl.emit('refresh')).state;
  assert.ok(!after.tokens.some((t) => t.id === dropped.id));
  assert.strictEqual(after.characters.find((c) => c.id === me.id).inventory.find((i) => i.name === 'Rubí').qty, 2);
  // Un jugador no puede crear objetos.
  await pl.emit('token:add', { name: 'Trampa', kind: 'objeto', x: 0, y: 0 });
  assert.ok(!(await dm.emit('refresh')).state.tokens.some((t) => t.name === 'Trampa' && t.kind === 'objeto'));
  for (const t of [chest, letter, far, door]) await dm.emit('token:remove', { id: t.id });
  dm.socket.close();
  pl.socket.close();
});
