// Crea una campaña de ejemplo con un DM, tres jugadores, personajes y fichas en el mapa.
// Uso (con el servidor APAGADO): npm run demo   → imprime las contraseñas generadas.
const crypto = require('crypto');
const { db, flush } = require('../server/db');
const auth = require('../server/auth');
const camp = require('../server/campaigns');
const scenes = require('../server/scenes');

const G = 70;
const pass = () => crypto.randomBytes(5).toString('base64url');

function ensureUser(username, displayName, role) {
  const found = db().users.find((u) => u.username === username);
  if (found) return { user: found, password: null };
  const password = pass();
  return { user: auth.createUser({ username, password, displayName, role }), password };
}

db();
auth.ensureSuperAdmin();
const accounts = [
  ensureUser('dm', 'El Narrador', 'dm'),
  ensureUser('jugador1', 'Thorin', 'player'),
  ensureUser('jugador2', 'Lyra', 'player'),
  ensureUser('jugador3', 'Sombra', 'player'),
];
const [dm, ...players] = accounts.map((a) => a.user);

let c = db().campaigns.find((x) => x.name === 'La Cripta del Bosque' && x.dmId === dm.id);
if (!c) {
  c = camp.createCampaign(dm, 'La Cripta del Bosque');
  c.playerIds = players.map((p) => p.id);
  c.maps = [
    { id: crypto.randomUUID(), name: 'Ruinas del bosque', url: '/assets/demo/map-bosque.svg' },
    { id: crypto.randomUUID(), name: 'Cripta olvidada', url: '/assets/demo/map-cripta.svg' },
  ];
  const scene = Object.assign(c.scenes[0], { name: 'Las ruinas', mapId: c.maps[0].id });
  // Segunda escena ya preparada (sin lanzar) para probar el flujo de preparar → lanzar.
  const crypt = Object.assign(scenes.newScene({ name: 'La cripta' }), { mapId: c.maps[1].id });
  c.scenes.push(crypt);

  const sheets = [
    { name: 'Thorin Barbapiedra', race: 'Enano', cls: 'Guerrero', level: 3, ac: 18, hp: 31, maxHp: 31, speed: 25,
      portrait: '/assets/demo/token-guerrero.svg', stats: { str: 16, dex: 12, con: 16, int: 9, wis: 12, cha: 10 },
      notes: 'Hacha de batalla (1d8+3). Escudo. Odia a los goblins.' },
    { name: 'Lyra Hojaluna', race: 'Elfa', cls: 'Maga', level: 3, ac: 12, hp: 17, maxHp: 17, speed: 30,
      portrait: '/assets/demo/token-maga.svg', stats: { str: 8, dex: 14, con: 12, int: 17, wis: 13, cha: 11 },
      notes: 'Proyectil mágico, Escudo, Bola de fuego (pronto). Libro de conjuros con tapas de plata.' },
    { name: 'Sombra', race: 'Mediano', cls: 'Pícaro', level: 3, ac: 15, hp: 21, maxHp: 21, speed: 25,
      portrait: '/assets/demo/token-picaro.svg', stats: { str: 10, dex: 17, con: 13, int: 12, wis: 12, cha: 14 },
      notes: 'Ataque furtivo 2d6. Herramientas de ladrón. Debe dinero a medio puerto.' },
  ];
  const spots = [[9, 9], [10, 9], [9, 10]];
  sheets.forEach((s, i) => {
    const ch = { id: crypto.randomUUID(), ownerId: players[i].id, campaignId: c.id, ...camp.sanitizeCharacter(s), createdAt: new Date().toISOString() };
    db().characters.push(ch);
    scene.tokens.push({ id: crypto.randomUUID(), name: ch.name, img: ch.portrait, x: spots[i][0] * G, y: spots[i][1] * G,
      size: 1, ownerId: ch.ownerId, characterId: ch.id, hp: ch.hp, maxHp: ch.maxHp, hidden: false, conditions: [] });
  });
  [['Goblin', 'goblin', 7, 6, 4, false], ['Goblin', 'goblin', 7, 8, 3, false], ['Lobo', 'lobo', 11, 5, 3, false], ['Esqueleto', 'esqueleto', 13, 9, 3, true]]
    .forEach(([name, img, hp, gx, gy, hidden]) => scene.tokens.push({ id: crypto.randomUUID(), name, img: `/assets/demo/token-${img}.svg`,
      x: gx * G, y: gy * G, size: 1, ownerId: null, characterId: null, hp, maxHp: hp, hidden, conditions: [] }));
  crypt.tokens.push({ id: crypto.randomUUID(), name: 'Esqueleto', img: '/assets/demo/token-esqueleto.svg', x: 8 * G, y: 4 * G,
    size: 1, ownerId: null, characterId: null, hp: 13, maxHp: 13, hidden: false, conditions: [] });
  camp.addLog(c, { type: 'chat', userId: dm.id, name: dm.displayName, text: 'La niebla cubre las ruinas. Algo se mueve entre los árboles… ¡Tirad Percepción!' });
}
flush();

console.info('\nCampaña de ejemplo lista: "La Cripta del Bosque"\n');
accounts.forEach(({ user, password }) => {
  console.info(`  ${user.role.padEnd(7)} ${user.username.padEnd(9)} ${password ? `contraseña: ${password}` : '(ya existía, contraseña sin cambios)'}`);
});
console.info('');
