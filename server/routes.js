// API REST: cuentas, administración, campañas, personajes y subida de imágenes.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const multer = require('multer');
const { db, save, DATA_DIR } = require('./db');
const auth = require('./auth');
const camp = require('./campaigns');
const { log, snapshot, counters } = require('./logger');
const { safeUrl } = require('./realtime-board');
const { registerStudio } = require('./routes-studio');
const { registerCompendium } = require('./routes-compendium');
const { registerNotes } = require('./notes');
const objects = require('./objects');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// Los mapas pueden ser enormes (escaneos, mapas de región); el navegador los aguanta con zoom.
const MAX_MAP_BYTES = 40 * 1024 * 1024;
const BESTIARY_LIMIT = 200;
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const AUDIO_TYPES = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'audio/wave': '.wav', 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function uploader(types, maxBytes, label) {
  return multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${types[file.mimetype]}`),
    }),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => cb(types[file.mimetype] ? null : new Error(label), true),
  });
}
const imageUpload = uploader(IMAGE_TYPES, MAX_UPLOAD_BYTES, 'Solo PNG, JPG, WEBP o GIF');
const mapUpload = uploader(IMAGE_TYPES, MAX_MAP_BYTES, 'Solo PNG, JPG, WEBP o GIF');
const audioUpload = uploader(AUDIO_TYPES, MAX_AUDIO_BYTES, 'Solo audio MP3, OGG, WAV, M4A, AAC, FLAC o WEBM');

/** Direcciones de la red local (wifi / hotspot) para jugar sin internet. */
function lanUrls(port) {
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !/^(lo|docker|br-|veth|virbr)/.test(name))
    .flatMap(([, addrs]) => addrs || [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
}

/** Envuelve un handler para que los Error lanzados lleguen como 400 con mensaje. */
const handle = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Error' });
  }
};

// Freno a fuerza bruta: como mucho LOGIN_MAX intentos fallidos por IP cada LOGIN_WINDOW_MS.
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const failedLogins = new Map();

function loginBlocked(ip) {
  const recent = (failedLogins.get(ip) || []).filter((t) => Date.now() - t < LOGIN_WINDOW_MS);
  failedLogins.set(ip, recent);
  return recent.length >= LOGIN_MAX;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function buildRouter(io) {
  const r = express.Router();
  r.use(express.json({ limit: '200kb' }));

  // ---------- cuentas ----------
  r.post('/auth/register', handle((req) => {
    if (!db().settings.openRegistration) throw httpError(403, 'El registro está cerrado. Pide una cuenta al admin.');
    const { username, password, displayName } = req.body || {};
    auth.createUser({ username, password, displayName, role: 'player' });
    const { token, user } = auth.login(username, password);
    return { token, user: auth.publicUser(user) };
  }));

  r.post('/auth/login', handle((req) => {
    if (loginBlocked(req.ip)) throw httpError(429, 'Demasiados intentos. Espera unos minutos.');
    try {
      const { token, user } = auth.login(req.body?.username, req.body?.password);
      log.info('inicio de sesión', { user: user.username, ip: req.ip });
      return { token, user: auth.publicUser(user) };
    } catch (err) {
      failedLogins.set(req.ip, [...(failedLogins.get(req.ip) || []), Date.now()]);
      log.warn('inicio de sesión fallido', { user: String(req.body?.username || '').slice(0, 30), ip: req.ip });
      throw err;
    }
  }));

  r.post('/auth/logout', handle((req) => {
    auth.logout(auth.tokenFromReq(req));
    return { ok: true };
  }));

  r.get('/me', auth.requireAuth(), handle((req) => ({
    user: auth.publicUser(req.user),
    settings: { openRegistration: db().settings.openRegistration },
  })));

  r.get('/public-settings', handle(() => ({ openRegistration: db().settings.openRegistration })));

  // ---------- super admin ----------
  const admin = auth.requireAuth('superadmin');

  r.get('/admin/users', admin, handle(() => ({ users: db().users.map(auth.publicUser) })));

  r.post('/admin/users', admin, handle((req) => ({ user: auth.publicUser(auth.createUser(req.body || {})) })));

  r.patch('/admin/users/:id', admin, handle((req) => {
    const user = db().users.find((u) => u.id === req.params.id);
    if (!user) throw httpError(404, 'Usuario no encontrado');
    const { role, displayName, password } = req.body || {};
    if (role !== undefined) {
      if (!auth.ROLES.includes(role)) throw new Error('Rol inválido');
      const admins = db().users.filter((u) => u.role === 'superadmin');
      if (user.role === 'superadmin' && role !== 'superadmin' && admins.length === 1) throw new Error('Debe quedar al menos un super admin');
      user.role = role;
    }
    if (displayName !== undefined) user.displayName = camp.cleanText(displayName, 40, user.displayName).trim() || user.displayName;
    if (password !== undefined) {
      if (String(password).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
      Object.assign(user, auth.hashPassword(String(password)));
      db().sessions = db().sessions.filter((s) => s.userId !== user.id);
    }
    save();
    return { user: auth.publicUser(user) };
  }));

  r.delete('/admin/users/:id', admin, handle((req) => {
    if (req.params.id === req.user.id) throw new Error('No puedes borrarte a ti mismo');
    const d = db();
    d.users = d.users.filter((u) => u.id !== req.params.id);
    d.sessions = d.sessions.filter((s) => s.userId !== req.params.id);
    d.campaigns.forEach((c) => { c.playerIds = c.playerIds.filter((id) => id !== req.params.id); });
    save();
    return { ok: true };
  }));

  r.patch('/admin/settings', admin, handle((req) => {
    if (typeof req.body?.openRegistration === 'boolean') db().settings.openRegistration = req.body.openRegistration;
    save();
    return { settings: db().settings };
  }));

  r.get('/admin/campaigns', admin, handle(() => ({
    campaigns: db().campaigns.map((c) => ({
      id: c.id, name: c.name, dm: db().users.find((u) => u.id === c.dmId)?.displayName || '—', players: c.playerIds.length,
    })),
  })));

  r.get('/admin/monitor', admin, handle((req) => {
    const presence = io.daPresence ? io.daPresence() : [];
    const mem = process.memoryUsage();
    return {
      ...snapshot({ level: req.query.level, limit: 150 }),
      system: {
        node: process.version, pid: process.pid, platform: `${os.type()} ${os.release()}`,
        rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576),
        load: os.loadavg().map((x) => Math.round(x * 100) / 100), freeMemMb: Math.round(os.freemem() / 1048576),
      },
      sockets: io.engine.clientsCount,
      presence,
      lan: lanUrls(Number(process.env.PORT) || 3000),
      db: { users: db().users.length, campaigns: db().campaigns.length, characters: db().characters.length },
    };
  }));

  // ---------- campañas ----------
  const logged = auth.requireAuth();

  function accessible(req) {
    const c = camp.findCampaign(req.params.id);
    if (!c || !camp.canAccess(req.user, c)) throw httpError(404, 'Campaña no encontrada');
    return c;
  }
  function owned(req) {
    const c = accessible(req);
    if (!camp.isDM(req.user, c)) throw httpError(403, 'Solo el DM puede hacer esto');
    return c;
  }

  r.get('/campaigns', logged, handle((req) => ({
    campaigns: camp.campaignsFor(req.user).map((c) => ({
      id: c.id,
      name: c.name,
      isDM: camp.isDM(req.user, c),
      dm: db().users.find((u) => u.id === c.dmId)?.displayName || '—',
      players: c.playerIds.map((id) => db().users.find((u) => u.id === id)?.displayName).filter(Boolean),
      mapThumb: c.maps.find((m) => m.id === c.scenes.find((sc) => sc.id === c.activeSceneId)?.mapId)?.url || null,
    })),
  })));

  r.post('/campaigns', auth.requireAuth('dm', 'superadmin'), handle((req) => {
    const campaign = camp.createCampaign(req.user, req.body?.name);
    notifyLobby([req.user.id]);
    return { campaign };
  }));

  r.patch('/campaigns/:id', logged, handle((req) => {
    const c = owned(req);
    if (req.body?.name) c.name = camp.cleanText(req.body.name, 60, c.name).trim() || c.name;
    save();
    io.to(c.id).emit('campaign:meta', { name: c.name });
    notifyLobby(membersOf(c));
    return { ok: true };
  }));

  r.delete('/campaigns/:id', logged, handle((req) => {
    const c = owned(req);
    db().campaigns = db().campaigns.filter((x) => x.id !== c.id);
    save();
    io.to(c.id).emit('campaign:deleted');
    notifyLobby(membersOf(c));
    return { ok: true };
  }));

  r.post('/campaigns/:id/players', logged, handle((req) => {
    const c = owned(req);
    const name = String(req.body?.username || '').trim().toLowerCase();
    const user = db().users.find((u) => u.username === name);
    if (!user) throw httpError(404, `No existe el usuario "${name}"`);
    if (user.id === c.dmId) throw new Error('El DM ya está en la campaña');
    if (!c.playerIds.includes(user.id)) c.playerIds = [...c.playerIds, user.id];
    save();
    io.to(c.id).emit('campaign:refresh');
    notifyLobby([user.id, c.dmId]);
    return { ok: true };
  }));

  r.delete('/campaigns/:id/players/:userId', logged, handle((req) => {
    const c = owned(req);
    c.playerIds = c.playerIds.filter((id) => id !== req.params.userId);
    save();
    io.to(c.id).emit('campaign:refresh');
    // Si estaba en la mesa, vuelve al lobby.
    io.to(`user:${req.params.userId}`).emit('campaign:removed', { id: c.id });
    notifyLobby([req.params.userId, c.dmId]);
    return { ok: true };
  }));

  /** El lobby de estos usuarios se recarga solo (campañas en las que entran o salen, personajes). */
  function notifyLobby(userIds) {
    for (const id of new Set(userIds)) io.to(`user:${id}`).emit('lobby:refresh');
  }
  const membersOf = (c) => [c.dmId, ...c.playerIds];

  // ---------- personajes ----------
  /** Cada socket de la sala recibe su propia lista (los jugadores no ven la hoja de los NPC). */
  function emitCharacters(c) {
    if (!c) return;
    for (const sid of io.sockets.adapter.rooms.get(c.id) || []) {
      const sock = io.sockets.sockets.get(sid);
      const user = sock && db().users.find((u) => u.id === sock.data.userId);
      if (user) sock.emit('characters', camp.charactersFor(user, c));
    }
  }

  r.get('/characters', logged, handle((req) => ({
    characters: db().characters.filter((ch) => ch.ownerId === req.user.id),
  })));

  r.post('/characters', logged, handle((req) => {
    const campaignId = req.body?.campaignId || null;
    if (campaignId) {
      const c = camp.findCampaign(campaignId);
      if (!c || !camp.canAccess(req.user, c)) throw httpError(404, 'Campaña no encontrada');
    }
    const ch = {
      id: crypto.randomUUID(),
      ownerId: req.user.id,
      campaignId,
      ...camp.sanitizeCharacter(req.body || {}),
      ...(req.user.role === 'player' ? { vision: undefined } : {}),
      createdAt: new Date().toISOString(),
    };
    db().characters.push(ch);
    save();
    if (campaignId) emitCharacters(camp.findCampaign(campaignId));
    notifyLobby([req.user.id]);
    return { character: ch };
  }));

  r.patch('/characters/:id', logged, handle((req) => {
    const idx = db().characters.findIndex((ch) => ch.id === req.params.id);
    const prev = db().characters[idx];
    const c = prev?.campaignId ? camp.findCampaign(prev.campaignId) : null;
    if (!prev || (prev.ownerId !== req.user.id && !(c && camp.isDM(req.user, c)))) throw httpError(404, 'Personaje no encontrado');
    const next = camp.sanitizeCharacter(req.body || {}, prev);
    // La visión decide cuánto ve con niebla: solo la cambia el DM.
    if (!(c && camp.isDM(req.user, c))) next.vision = prev.vision;
    // Solo el dueño puede mover su personaje a otra campaña (a una a la que tenga acceso).
    if (req.body?.campaignId !== undefined && prev.ownerId === req.user.id && req.body.campaignId !== prev.campaignId) {
      const target = req.body.campaignId ? camp.findCampaign(req.body.campaignId) : null;
      if (req.body.campaignId && (!target || !camp.canAccess(req.user, target))) throw httpError(404, 'Campaña no encontrada');
      next.campaignId = target ? target.id : null;
    }
    db().characters[idx] = next;
    save();
    // Se avisa después de guardar: si no, la campaña nueva recibe la lista sin el personaje que llega.
    if (c) emitCharacters(c);
    const target = next.campaignId !== prev.campaignId && camp.findCampaign(next.campaignId);
    if (target) emitCharacters(target);
    notifyLobby([prev.ownerId]);
    return { character: next };
  }));

  r.delete('/characters/:id', logged, handle((req) => {
    const prev = db().characters.find((ch) => ch.id === req.params.id);
    if (!prev || prev.ownerId !== req.user.id) throw httpError(404, 'Personaje no encontrado');
    db().characters = db().characters.filter((ch) => ch.id !== prev.id);
    save();
    const c = prev.campaignId && camp.findCampaign(prev.campaignId);
    if (c) emitCharacters(c);
    notifyLobby([prev.ownerId]);
    return { ok: true };
  }));

  // ---------- bestiario propio del DM (sirve en todas sus campañas) ----------
  const dmOnly = auth.requireAuth('dm', 'superadmin');
  const beastView = (b) => ({ id: b.id, name: b.name, img: b.img, hp: b.hp, size: b.size, ...(b.kind === 'objeto' ? { kind: 'objeto', object: b.object } : {}) });

  r.get('/bestiary', dmOnly, handle((req) => ({
    bestiary: db().bestiary.filter((b) => b.ownerId === req.user.id).map(beastView),
  })));

  r.post('/bestiary', dmOnly, handle((req) => {
    const p = req.body || {};
    const img = safeUrl(p.img);
    if (!img) throw new Error('Imagen no válida');
    if (db().bestiary.filter((b) => b.ownerId === req.user.id).length >= BESTIARY_LIMIT) throw new Error(`Máximo ${BESTIARY_LIMIT} bestias`);
    const beast = {
      id: crypto.randomUUID(),
      ownerId: req.user.id,
      name: camp.cleanText(p.name, 40, 'Criatura').trim() || 'Criatura',
      img,
      hp: camp.clampInt(p.hp, 1, 9999, 10),
      size: camp.clampInt(p.size, 1, 6, 1),
      // También se guardan objetos ya configurados (un cofre con su contenido, una carta con su texto).
      ...(p.kind === 'objeto' ? { kind: 'objeto', object: objects.cleanObject(p.object || {}) } : {}),
    };
    db().bestiary = [...db().bestiary, beast];
    save();
    return { beast: beastView(beast) };
  }));

  r.delete('/bestiary/:id', dmOnly, handle((req) => {
    const beast = db().bestiary.find((b) => b.id === req.params.id && b.ownerId === req.user.id);
    if (!beast) throw httpError(404, 'Bestia no encontrada');
    db().bestiary = db().bestiary.filter((b) => b.id !== beast.id);
    save();
    return { ok: true };
  }));

  registerStudio(r, { io, handle, httpError, dmOnly, logged });
  registerCompendium(r, { handle, httpError, logged });
  registerNotes(r, { handle, httpError, logged });

  // ---------- imágenes ----------
  const receive = (mw, field, tooBig) => (req, res) => {
    mw.single(field)(req, res, (err) => {
      if (err) {
        log.warn('subida rechazada', { user: req.user.username, error: err.message });
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? tooBig : err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo' });
      counters.uploads += 1;
      log.info('archivo subido', { user: req.user.username, kind: field, bytes: req.file.size, file: req.file.filename });
      res.json({ url: `/uploads/${req.file.filename}` });
    });
  };
  r.post('/upload', logged, receive(imageUpload, 'image', 'Imagen demasiado grande (máx 15 MB)'));
  r.post('/upload/map', auth.requireAuth('dm', 'superadmin'), receive(mapUpload, 'image', 'Mapa demasiado grande (máx 40 MB)'));
  r.post('/upload/audio', auth.requireAuth('dm', 'superadmin'), receive(audioUpload, 'audio', 'Audio demasiado grande (máx 40 MB)'));

  return r;
}

module.exports = { buildRouter, UPLOAD_DIR, lanUrls };
