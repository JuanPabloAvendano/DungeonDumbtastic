// Mis objetos: plantillas propias de cada usuario. Un objeto personalizado sirve a la vez como cosa de
// inventario (peso, valor, arma o armadura) y como objeto del mapa (recoger, abrir, leer, activar).
const crypto = require('crypto');
const { db, save } = require('./db');
const { cleanItem, cleanObject } = require('./objects');

const TEMPLATE_LIMIT = 300;
const URL_RE = /^\/(uploads|assets)\/[\w./-]+$/;
const safeImg = (v) => (typeof v === 'string' && URL_RE.test(v) && !v.includes('..') ? v : null);

/** Normaliza una plantilla; lo que no llega se conserva de la anterior. */
function cleanTemplate(input = {}, prev = {}) {
  const merged = { ...prev, ...input };
  const name = String(merged.name || '').trim();
  if (!name) throw new Error('El objeto necesita un nombre');
  const { id, qty, equipped, img, ...item } = cleanItem({ ...merged, name });
  return {
    ...item,
    img: input.img !== undefined ? safeImg(input.img) : prev.img ?? null,
    object: cleanObject({ use: 'recoger', ...(input.object || {}) }, prev.object || {}),
  };
}

function registerTemplates(r, { handle, httpError, logged }) {
  const mine = (req) => db().itemTemplates.filter((t) => t.ownerId === req.user.id);
  const own = (req) => {
    const t = mine(req).find((x) => x.id === req.params.id);
    if (!t) throw httpError(404, 'Ese objeto no existe');
    return t;
  };

  r.get('/plantillas', logged, handle((req) => ({ templates: mine(req) })));

  r.post('/plantillas', logged, handle((req) => {
    if (mine(req).length >= TEMPLATE_LIMIT) throw new Error(`Máximo ${TEMPLATE_LIMIT} objetos propios`);
    const template = { id: crypto.randomUUID(), ownerId: req.user.id, ...cleanTemplate(req.body), updatedAt: new Date().toISOString() };
    db().itemTemplates = [...db().itemTemplates, template];
    save();
    return { template };
  }));

  r.patch('/plantillas/:id', logged, handle((req) => {
    const prev = own(req);
    const template = { ...prev, ...cleanTemplate(req.body, prev), id: prev.id, ownerId: prev.ownerId, updatedAt: new Date().toISOString() };
    db().itemTemplates = db().itemTemplates.map((t) => (t.id === prev.id ? template : t));
    save();
    return { template };
  }));

  r.delete('/plantillas/:id', logged, handle((req) => {
    const t = own(req);
    db().itemTemplates = db().itemTemplates.filter((x) => x.id !== t.id);
    save();
    return { ok: true };
  }));
}

module.exports = { registerTemplates, cleanTemplate };
