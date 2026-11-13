const test = require('node:test');
const assert = require('node:assert');
const sc = require('../server/scenes');

const G = 70;

function combatScene() {
  const scene = sc.newScene({ name: 'Cripta', grid: { size: G } });
  scene.tokens = [
    { id: 'a', ownerId: 'u1', x: 0, y: 0 },
    { id: 'b', ownerId: 'u2', x: 5 * G, y: 0 },
    { id: 'g', ownerId: null, x: 9 * G, y: 0 },
  ];
  sc.setInitiative(scene, { entries: [{ tokenId: 'a' }, { tokenId: 'b' }, { tokenId: 'g' }], turn: 0, round: 1 });
  return scene;
}

test('migra una campaña antigua a escenas sin perder fichas ni iniciativa', () => {
  const c = { playerIds: ['u1'], maps: [{ id: 'm', name: 'Bosque' }], scene: { mapId: 'm', gridSize: 64, showGrid: false },
    tokens: [{ id: 't' }], initiative: { entries: [{ tokenId: 't' }], turn: 0, round: 2 } };
  sc.migrate(c);
  assert.strictEqual(c.scenes.length, 1);
  assert.strictEqual(c.scenes[0].name, 'Bosque');
  assert.deepStrictEqual(c.scenes[0].grid, { size: 64, ox: 0, oy: 0, show: false });
  assert.strictEqual(c.scenes[0].tokens[0].id, 't');
  assert.strictEqual(c.scenes[0].initiative.round, 2);
  assert.strictEqual(c.activeSceneId, c.scenes[0].id);
  assert.strictEqual(c.scene, undefined);
});

test('cada jugador ve su escena asignada o la principal', () => {
  const c = { playerIds: ['u1', 'u2'], scenes: [{ id: 's1' }, { id: 's2' }], activeSceneId: 's1', playerScene: { u2: 's2', u9: 'borrada' } };
  assert.strictEqual(sc.sceneIdForPlayer(c, 'u1'), 's1');
  assert.strictEqual(sc.sceneIdForPlayer(c, 'u2'), 's2');
  assert.deepStrictEqual(sc.playersByScene(c), { s1: ['u1'], s2: ['u2'] });
});

test('fuera de combate se mueve libre; en combate solo en tu turno', () => {
  const free = sc.newScene({});
  free.tokens = [{ id: 'a', x: 0, y: 0 }];
  assert.ok(sc.checkMove(free, free.tokens[0], { x: 20 * G, y: 0 }, { isDM: false }).ok);

  const scene = combatScene();
  const b = scene.tokens[1];
  assert.match(sc.checkMove(scene, b, { x: 6 * G, y: 0 }, { isDM: false }).reason, /No es tu turno/);
  assert.ok(sc.checkMove(scene, b, { x: 6 * G, y: 0 }, { isDM: true }).ok);
});

test('el movimiento se acumula y no pasa de las casillas del turno (diagonal = 1)', () => {
  const scene = combatScene();
  const a = scene.tokens[0];
  assert.ok(sc.checkMove(scene, a, { x: 3 * G, y: 3 * G }, { isDM: false }).ok);
  sc.commitMove(scene, a, { x: 3 * G, y: 3 * G }, { isDM: false });
  assert.strictEqual(scene.initiative.turnState.used, 3);
  assert.match(sc.checkMove(scene, a, { x: 6 * G, y: 3 * G }, { isDM: false }).reason, /quedan 2/);
  assert.ok(sc.checkMove(scene, a, { x: 5 * G, y: 3 * G }, { isDM: false }).ok);
});

test('al pasar turno se reinicia el movimiento y la reacción del que empieza', () => {
  const scene = combatScene();
  sc.commitMove(scene, scene.tokens[0], { x: 2 * G, y: 0 }, { isDM: false });
  sc.spend(scene, 'b', 'reaction');
  assert.ok(scene.initiative.reactions.b);
  sc.advanceTurn(scene);
  assert.strictEqual(scene.initiative.turnState.tokenId, 'b');
  assert.strictEqual(scene.initiative.turnState.used, 0);
  assert.ok(!scene.initiative.reactions.b);
  sc.advanceTurn(scene);
  sc.advanceTurn(scene);
  assert.strictEqual(scene.initiative.round, 2);
  assert.strictEqual(scene.initiative.turnState.tokenId, 'a');
});

test('fuera de su turno el jugador solo tira si se lo piden o gasta la reacción', () => {
  const scene = combatScene();
  assert.ok(sc.rollGate(scene, 'u1', { isDM: false }).ok);
  assert.match(sc.rollGate(scene, 'u2', { isDM: false }).reason, /No es tu turno/);
  assert.ok(sc.rollGate(scene, 'u2', { isDM: false, answeringRequest: true }).ok);
  const gate = sc.rollGate(scene, 'u2', { isDM: false, useReaction: true });
  assert.strictEqual(gate.reactionOf, 'b');
  sc.spend(scene, 'b', 'reaction');
  assert.match(sc.rollGate(scene, 'u2', { isDM: false, useReaction: true }).reason, /Ya usaste/);
});

test('un jugador con dos personajes gasta la reacción del que está usando', () => {
  const scene = combatScene();
  scene.tokens = [...scene.tokens, { id: 'b2', ownerId: 'u2', characterId: 'ch-b2', x: 6 * G, y: 0 }];
  sc.setInitiative(scene, { entries: [...scene.initiative.entries, { tokenId: 'b2' }] });
  assert.strictEqual(sc.rollGate(scene, 'u2', { isDM: false, useReaction: true, characterId: 'ch-b2' }).reactionOf, 'b2');
  sc.spend(scene, 'b2', 'reaction');
  assert.match(sc.rollGate(scene, 'u2', { isDM: false, useReaction: true, characterId: 'ch-b2' }).reason, /Ya usaste/);
  // El otro personaje conserva la suya; un personaje ajeno no cuenta.
  assert.strictEqual(sc.rollGate(scene, 'u2', { isDM: false, useReaction: true }).reactionOf, 'b');
  assert.strictEqual(sc.rollGate(scene, 'u2', { isDM: false, useReaction: true, characterId: 'otro' }).reactionOf, 'b');
});

test('la cuadrícula calibrada limita el desfase al tamaño de casilla', () => {
  assert.deepStrictEqual(sc.cleanGrid({ size: 50.456, ox: 80, oy: -3, show: true }), { size: 50.46, ox: 50.46, oy: 0, show: true });
  assert.strictEqual(sc.cleanCrop(null, { x: 1 }), null);
  assert.deepStrictEqual(sc.cleanCrop({ x: 10, y: 20, w: 900, h: 600 }), { x: 10, y: 20, w: 900, h: 600 });
});
