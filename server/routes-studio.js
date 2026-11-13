// Taller de mapas del DM: borradores editables, biblioteca de objetos (sellos) y enviar un mapa
// terminado a la biblioteca de una campaña.
const crypto = require('crypto');
const { db, save } = require('./db');
const camp = require('./campaigns');
const { safeUrl, MAP_LIMIT } = require('./realtime-board');

const DRAFT_LIMIT = 100;
const STAMP_LIMIT = 300;
const STAMPS_PER_DRAFT = 400;
const MAX_SIDE = 12000;
const POS_LIMIT = 20000;

const num = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : fallback;
};

/** Objeto colocado en el borrador: imagen de la biblioteca con posición, tamaño, giro y espejo. */
function cleanPlaced(p) {
  const url = safeUrl(p?.url);
  if (!url) return null;
  return {
    id: typeof p.id === 'string' ? p.id.slice(0, 40) : crypto.randomUUID(),
    url,
    x: num(p.x, -POS_LIMIT, POS_LIMIT, 0),
    y: num(p.y, -POS_LIMIT, POS_LIMIT, 0),
    w: num(p.w, 4, MAX_SIDE, 70),
    h: num(p.h, 4, MAX_SIDE, 70),
    rot: num(p.rot, -360, 360, 0),
    flip: p.flip === true,
  };
}

function cleanDraft(input, prev = {}) {
  const baseUrl = input.baseUrl !== undefined ? safeUrl(input.baseUrl) : prev.baseUrl;
  if (!baseUrl) throw new Error('Falta la imagen base del mapa');
  return {
    ...prev,
    name: camp.cleanText(input.name, 50, prev.name || 'Mapa').trim() || 'Mapa',
    baseUrl,
    width: num(input.width, 50, MAX_SIDE, prev.width || 1400),
    height: num(input.height, 50, MAX_SIDE, prev.height || 1050),
    grid: num(input.grid, 10, 400, prev.grid || 70),
    stamps: Array.isArray(input.stamps) ? input.stamps.slice(0, STAMPS_PER_DRAFT).map(cleanPlaced).filter(Boolean) : prev.stamps || [],
    updatedAt: new Date().toISOString(),
  };
}

const draftSummary = (d) => ({ id: d.id, name: d.name, baseUrl: d.baseUrl, width: d.width, height: d.height, updatedAt: d.updatedAt });

/**
 * @param {import('express').Router} r
 * @param {{ io, handle, httpError, dmOnly, logged }} deps
 */
function registerStudio(r, { io, handle, httpError, dmOnly, logged }) {
  const mine = (list, req) => list.filter((x) => x.ownerId === req.user.id);
  const findMine = (list, req, what) => {
    const item = list.find((x) => x.id === req.params.id && x.ownerId === req.user.id);
    if (!item) throw httpError(404, `${what} no encontrado`);
    return item;
  };

  // ---------- borradores ----------
  r.get('/studio/drafts', dmOnly, handle((req) => ({ drafts: mine(db().mapDrafts, req).map(draftSummary) })));

  r.get('/studio/drafts/:id', dmOnly, handle((req) => ({ draft: findMine(db().mapDrafts, req, 'Borrador') })));

  r.post('/studio/drafts', dmOnly, handle((req) => {
    if (mine(db().mapDrafts, req).length >= DRAFT_LIMIT) throw new Error(`Máximo ${DRAFT_LIMIT} borradores: borra alguno`);
    const draft = { id: crypto.randomUUID(), ownerId: req.user.id, ...cleanDraft(req.body || {}) };
    db().mapDrafts = [...db().mapDrafts, draft];
    save();
    return { draft };
  }));

  r.patch('/studio/drafts/:id', dmOnly, handle((req) => {
    const prev = findMine(db().mapDrafts, req, 'Borrador');
    const next = cleanDraft(req.body || {}, prev);
    db().mapDrafts = db().mapDrafts.map((d) => (d.id === prev.id ? next : d));
    save();
    return { draft: next };
  }));

  r.delete('/studio/drafts/:id', dmOnly, handle((req) => {
    const prev = findMine(db().mapDrafts, req, 'Borrador');
    db().mapDrafts = db().mapDrafts.filter((d) => d.id !== prev.id);
    save();
    return { ok: true };
  }));

  // ---------- objetos (carruajes, casas, muebles… con el fondo ya quitado) ----------
  const stampView = (s) => ({ id: s.id, name: s.name, url: s.url });

  r.get('/studio/stamps', dmOnly, handle((req) => ({ stamps: mine(db().stamps, req).map(stampView) })));

  r.post('/studio/stamps', dmOnly, handle((req) => {
    const url = safeUrl(req.body?.url);
    if (!url) throw new Error('Imagen no válida');
    if (mine(db().stamps, req).length >= STAMP_LIMIT) throw new Error(`Máximo ${STAMP_LIMIT} objetos`);
    const stamp = { id: crypto.randomUUID(), ownerId: req.user.id, name: camp.cleanText(req.body?.name, 40, 'Objeto').trim() || 'Objeto', url };
    db().stamps = [...db().stamps, stamp];
    save();
    return { stamp: stampView(stamp) };
  }));

  r.delete('/studio/stamps/:id', dmOnly, handle((req) => {
    const prev = findMine(db().stamps, req, 'Objeto');
    db().stamps = db().stamps.filter((s) => s.id !== prev.id);
    save();
    return { ok: true };
  }));

  // ---------- mapa terminado → biblioteca de una campaña ----------
  r.post('/campaigns/:id/maps', logged, handle((req) => {
    const c = camp.findCampaign(req.params.id);
    if (!c || !camp.canAccess(req.user, c)) throw httpError(404, 'Campaña no encontrada');
    if (!camp.isDM(req.user, c)) throw httpError(403, 'Solo el DM puede hacer esto');
    const url = safeUrl(req.body?.url);
    if (!url) throw new Error('Imagen inválida');
    if (c.maps.length >= MAP_LIMIT) throw new Error('Demasiados mapas en esa campaña');
    const map = { id: crypto.randomUUID(), name: camp.cleanText(req.body?.name, 50, 'Mapa').trim() || 'Mapa', url };
    c.maps = [...c.maps, map];
    save();
    io.to(c.id).emit('maps', c.maps);
    return { map };
  }));
}

module.exports = { registerStudio, cleanDraft, cleanPlaced };
