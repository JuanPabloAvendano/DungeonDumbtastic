// Reglas de acceso y "vistas" de una campaña según quién la mira.
const crypto = require('crypto');
const { db, save } = require('./db');
const scenes = require('./scenes');
const fog = require('./fog');
const actions = require('./actions');
const objects = require('./objects');

const LOG_LIMIT = 300;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function findCampaign(id) {
  const c = db().campaigns.find((x) => x.id === id);
  return c ? scenes.migrate(c) : null;
}

function isDM(user, campaign) {
  return user.role === 'superadmin' || campaign.dmId === user.id;
}

function canAccess(user, campaign) {
  return isDM(user, campaign) || campaign.playerIds.includes(user.id);
}

function campaignsFor(user) {
  return db().campaigns.filter((c) => canAccess(user, c)).map(scenes.migrate);
}

function createCampaign(user, name) {
  const campaign = {
    id: crypto.randomUUID(),
    name: String(name || 'Nueva campaña').trim().slice(0, 60) || 'Nueva campaña',
    dmId: user.id,
    playerIds: [],
    maps: [],
    tracks: [],
    music: { trackId: null, playing: false, startedAt: 0, offset: 0, loop: true, volume: 0.7 },
    log: [],
    createdAt: new Date().toISOString(),
  };
  const first = scenes.newScene({ name: 'Escena 1' });
  Object.assign(campaign, { scenes: [first], activeSceneId: first.id, playerScene: {} });
  db().campaigns.push(campaign);
  save();
  return campaign;
}

function addLog(campaign, entry) {
  const full = { id: crypto.randomUUID(), at: new Date().toISOString(), ...entry };
  campaign.log = [...campaign.log, full].slice(-LOG_LIMIT);
  save();
  return full;
}

/** Lo que un usuario puede ver de una entrada del log (tiradas ocultas solo DM y autor). */
function logVisibleTo(user, campaign, entry) {
  return !entry.hidden || isDM(user, campaign) || entry.userId === user.id;
}

function memberIds(campaign) {
  return [campaign.dmId, ...campaign.playerIds];
}

function charactersOf(campaign) {
  const members = memberIds(campaign);
  return db().characters.filter((ch) => ch.campaignId === campaign.id && members.includes(ch.ownerId));
}

// Lo que un jugador ve de un NPC: aspecto y vida (para la barra de la ficha), no su hoja.
const NPC_PUBLIC = ['id', 'ownerId', 'campaignId', 'name', 'portrait', 'hp', 'maxHp'];

/** Escena que mira este usuario: el DM puede estar mirando (o preparando) otra. */
function viewedScene(user, campaign, dmViewId) {
  const id = isDM(user, campaign) ? dmViewId : scenes.sceneIdForPlayer(campaign, user.id);
  return scenes.findScene(campaign, id) || scenes.findScene(campaign, campaign.activeSceneId) || campaign.scenes[0];
}

/** Fichas que ve un jugador en una escena: sin las ocultas y, con niebla, solo las que alcanza su grupo. */
function playerTokens(campaign, scene) {
  return fog.visibleTokens({ ...scene, tokens: scene.tokens.filter((t) => !t.hidden) }, charactersOf(campaign), campaign.playerIds);
}

/**
 * Personajes que ve este usuario. Los del DM son NPC: el jugador no ve su hoja, y solo sabe de los
 * que tienen ficha a la vista en su escena (nombre, retrato y vida para la barra de la ficha).
 */
function charactersFor(user, campaign) {
  const list = charactersOf(campaign).map((ch) => ({ ...ch, npc: ch.ownerId === campaign.dmId }));
  if (isDM(user, campaign)) return list;
  const inSight = new Set(playerTokens(campaign, viewedScene(user, campaign)).map((t) => t.characterId).filter(Boolean));
  return list
    .filter((ch) => !ch.npc || inSight.has(ch.id))
    .map((ch) => (ch.npc ? { ...Object.fromEntries(NPC_PUBLIC.map((k) => [k, ch[k]])), npc: true } : ch));
}

/** Iniciativa para un jugador: los combatientes que no ve salen sin nombre ni retrato. */
function playerInitiative(initiative, shown) {
  const ids = new Set(shown.map((t) => t.id));
  return { ...initiative, entries: initiative.entries.map((e) => (ids.has(e.tokenId) ? e : { ...e, name: '¿?', img: null })) };
}

/**
 * Lo que un usuario ve de una escena: datos, fichas e iniciativa. Al jugador no le llegan las
 * fichas ocultas ni, con niebla, las que ningún personaje alcanza a ver.
 */
function sceneView(user, campaign, scene) {
  const dm = isDM(user, campaign);
  const { tokens, initiative, ...meta } = scene;
  // De los objetos, el jugador ve su versión pública (sin nota del DM, texto sin leer ni contenido cerrado).
  const shown = dm ? tokens : playerTokens(campaign, scene).map((t) => (objects.isObject(t) ? { ...t, object: objects.publicObject(t.object) } : t));
  return {
    scene: { ...meta, fog: fog.cleanFog(scene.fog) },
    tokens: shown,
    initiative: dm ? initiative : playerInitiative(initiative, shown),
    scenes: dm ? scenes.summary(campaign) : null,
    activeSceneId: campaign.activeSceneId,
    // Al jugador: qué NPC conoce ahora (cambia al moverse o al revelar fichas).
    characters: dm ? undefined : charactersFor(user, campaign),
  };
}

function viewFor(user, campaign, dmViewId) {
  const dm = isDM(user, campaign);
  const users = db().users
    .filter((u) => memberIds(campaign).includes(u.id))
    .map((u) => ({ id: u.id, displayName: u.displayName, username: u.username, role: u.id === campaign.dmId ? 'dm' : 'player' }));
  return {
    id: campaign.id,
    name: campaign.name,
    dmId: campaign.dmId,
    playerIds: campaign.playerIds,
    isDM: dm,
    users,
    maps: campaign.maps,
    ...sceneView(user, campaign, viewedScene(user, campaign, dmViewId)),
    tracks: campaign.tracks || [],
    music: campaign.music || { trackId: null, playing: false, startedAt: 0, offset: 0, loop: true, volume: 0.7 },
    characters: charactersFor(user, campaign),
    log: campaign.log.filter((e) => logVisibleTo(user, campaign, e)).slice(-120),
  };
}

/**
 * Quién firma un mensaje o una tirada: el propio usuario o, si lo pide, uno de sus personajes.
 * El DM además puede hablar como cualquier personaje de la campaña (sus NPC) o ficha de la escena.
 */
function speakerFor(user, campaign, scene, { characterId, tokenId } = {}) {
  const dm = isDM(user, campaign);
  const ch = characterId && charactersOf(campaign).find((x) => x.id === characterId && (dm || x.ownerId === user.id));
  if (ch) return { name: ch.name, img: ch.portrait || null, characterId: ch.id, by: user.displayName, as: true };
  const token = dm && tokenId && scene?.tokens.find((t) => t.id === tokenId);
  if (token) return { name: token.name, img: token.img || null, by: user.displayName, as: true };
  return { name: user.displayName };
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanText(v, max, fallback = '') {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

/** Normaliza una hoja de personaje que viene del cliente. */
function sanitizeCharacter(input, prev = {}) {
  const stats = { ...(prev.stats || {}) };
  ABILITIES.forEach((k) => {
    stats[k] = clampInt(input.stats?.[k], 1, 30, stats[k] ?? 10);
  });
  return {
    ...prev,
    name: cleanText(input.name, 40, prev.name || 'Aventurero').trim() || 'Aventurero',
    race: cleanText(input.race, 30, prev.race || ''),
    cls: cleanText(input.cls, 30, prev.cls || ''),
    level: clampInt(input.level, 1, 20, prev.level ?? 1),
    ac: clampInt(input.ac, 0, 40, prev.ac ?? 10),
    hp: clampInt(input.hp, -99, 999, prev.hp ?? 10),
    maxHp: clampInt(input.maxHp, 1, 999, prev.maxHp ?? 10),
    speed: clampInt(input.speed, 0, 200, prev.speed ?? 30),
    vision: clampInt(input.vision, 0, fog.MAX_VISION, prev.vision ?? fog.DEFAULT_VISION),
    portrait: cleanText(input.portrait, 300, prev.portrait || ''),
    notes: cleanText(input.notes, 4000, prev.notes || ''),
    actions: actions.cleanActions(input.actions, prev.actions || []),
    slots: actions.cleanSlots(input.slots, prev.slots || {}),
    inventory: objects.cleanInventory(input.inventory, prev.inventory || []),
    stats,
  };
}

module.exports = {
  findCampaign, isDM, canAccess, campaignsFor, createCampaign, addLog, logVisibleTo,
  viewFor, viewedScene, sceneView, charactersOf, charactersFor, speakerFor, sanitizeCharacter, clampInt, cleanText, ABILITIES,
};
