// Reglas de acceso y "vistas" de una campaña según quién la mira.
const crypto = require('crypto');
const { db, save } = require('./db');

const LOG_LIMIT = 300;
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function findCampaign(id) {
  return db().campaigns.find((c) => c.id === id) || null;
}

function isDM(user, campaign) {
  return user.role === 'superadmin' || campaign.dmId === user.id;
}

function canAccess(user, campaign) {
  return isDM(user, campaign) || campaign.playerIds.includes(user.id);
}

function campaignsFor(user) {
  return db().campaigns.filter((c) => canAccess(user, c));
}

function createCampaign(user, name) {
  const campaign = {
    id: crypto.randomUUID(),
    name: String(name || 'Nueva campaña').trim().slice(0, 60) || 'Nueva campaña',
    dmId: user.id,
    playerIds: [],
    maps: [],
    scene: { mapId: null, gridSize: 70, showGrid: true },
    tokens: [],
    initiative: { entries: [], turn: 0, round: 1 },
    tracks: [],
    music: { trackId: null, playing: false, startedAt: 0, offset: 0, loop: true, volume: 0.7 },
    log: [],
    createdAt: new Date().toISOString(),
  };
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

function viewFor(user, campaign) {
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
    scene: campaign.scene,
    tokens: dm ? campaign.tokens : campaign.tokens.filter((t) => !t.hidden),
    initiative: campaign.initiative,
    tracks: campaign.tracks || [],
    music: campaign.music || { trackId: null, playing: false, startedAt: 0, offset: 0, loop: true, volume: 0.7 },
    characters: charactersOf(campaign),
    log: campaign.log.filter((e) => logVisibleTo(user, campaign, e)).slice(-120),
  };
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
    portrait: cleanText(input.portrait, 300, prev.portrait || ''),
    notes: cleanText(input.notes, 4000, prev.notes || ''),
    stats,
  };
}

module.exports = {
  findCampaign, isDM, canAccess, campaignsFor, createCampaign, addLog, logVisibleTo,
  viewFor, charactersOf, sanitizeCharacter, clampInt, cleanText, ABILITIES,
};
