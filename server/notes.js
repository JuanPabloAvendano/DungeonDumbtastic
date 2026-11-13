// Notas privadas de la mesa: cada jugador apunta lo que pasa y el DM, además, lleva notas por
// personaje (PJ o NPC). Solo las ve quien las escribe. Texto con formato sencillo (negrita, cursiva,
// tamaños, listas…) guardado como HTML con lista blanca: sin atributos, estilos ni scripts.
const crypto = require('crypto');
const { db, save } = require('./db');
const camp = require('./campaigns');

const HTML_MAX = 20000;
const TITLE_MAX = 60;
const NOTES_PER_USER = 200;
// Etiquetas que deja el editor (negrita, cursiva, subrayado, tachado, tamaños, listas, resaltado).
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'p', 'div', 'ul', 'ol', 'li', 'h3', 'h4', 'mark', 'blockquote']);
const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/**
 * Deja solo las etiquetas permitidas, sin ningún atributo, y escapa todo lo demás. El contenido de
 * <script>/<style> se descarta entero. Las etiquetas que quedan abiertas se cierran al final.
 */
function sanitizeHtml(input) {
  const src = String(input || '').slice(0, HTML_MAX * 2).replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '');
  const out = [];
  const open = [];
  for (const m of src.matchAll(/<\/?([a-zA-Z0-9]+)[^>]*>|([^<]+)|(<)/g)) {
    if (m[2] !== undefined) {
      // Las entidades que ya vienen escapadas se conservan; lo demás se escapa.
      out.push(m[2].replace(/&(?!(amp|lt|gt|quot|nbsp|#\d+);)/g, '&amp;').replace(/[<>"]/g, (c) => ENTITY[c]));
      continue;
    }
    if (m[3]) {
      out.push('&lt;');
      continue;
    }
    const tag = m[1].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (tag === 'br') {
      out.push('<br>');
      continue;
    }
    if (!m[0].startsWith('</')) {
      open.push(tag);
      out.push(`<${tag}>`);
    } else if (open.includes(tag)) {
      // Cierra lo que haya quedado abierto dentro, para no dejar etiquetas cruzadas.
      while (open.length) {
        const t = open.pop();
        out.push(`</${t}>`);
        if (t === tag) break;
      }
    }
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('').slice(0, HTML_MAX);
}

/** Texto plano de una nota (para la vista previa de la lista). */
const plainText = (html) => html.replace(/<br>|<\/(p|div|li|h3|h4)>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const view = (n) => ({ id: n.id, characterId: n.characterId, title: n.title, html: n.html, preview: plainText(n.html).slice(0, 120), updatedAt: n.updatedAt });

/**
 * @param {import('express').Router} r
 * @param {{ handle, httpError, logged }} deps
 */
function registerNotes(r, { handle, httpError, logged }) {
  const campaignOf = (req) => {
    const c = camp.findCampaign(req.params.id);
    if (!c || !camp.canAccess(req.user, c)) throw httpError(404, 'Campaña no encontrada');
    return c;
  };
  /** Personaje sobre el que se apunta: el DM puede elegir cualquiera de la campaña; el jugador, los suyos. */
  const characterFor = (req, c, id) => {
    if (!id) return null;
    const ch = camp.charactersOf(c).find((x) => x.id === id);
    if (!ch || (!camp.isDM(req.user, c) && ch.ownerId !== req.user.id)) throw new Error('Personaje no válido para esta nota');
    return ch.id;
  };
  const mine = (req, c) => {
    const n = db().notes.find((x) => x.id === req.params.noteId && x.ownerId === req.user.id && x.campaignId === c.id);
    if (!n) throw httpError(404, 'Nota no encontrada');
    return n;
  };

  r.get('/campaigns/:id/notes', logged, handle((req) => {
    const c = campaignOf(req);
    const list = db().notes.filter((n) => n.campaignId === c.id && n.ownerId === req.user.id);
    return { notes: [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(view) };
  }));

  r.post('/campaigns/:id/notes', logged, handle((req) => {
    const c = campaignOf(req);
    if (db().notes.filter((n) => n.ownerId === req.user.id && n.campaignId === c.id).length >= NOTES_PER_USER) {
      throw new Error(`Máximo ${NOTES_PER_USER} notas por campaña`);
    }
    const note = {
      id: crypto.randomUUID(),
      campaignId: c.id,
      ownerId: req.user.id,
      characterId: characterFor(req, c, req.body?.characterId),
      title: camp.cleanText(req.body?.title, TITLE_MAX, '').trim() || 'Nota',
      html: sanitizeHtml(req.body?.html),
      updatedAt: new Date().toISOString(),
    };
    db().notes = [...db().notes, note];
    save();
    return { note: view(note) };
  }));

  r.patch('/campaigns/:id/notes/:noteId', logged, handle((req) => {
    const c = campaignOf(req);
    const prev = mine(req, c);
    const next = {
      ...prev,
      title: req.body?.title !== undefined ? camp.cleanText(req.body.title, TITLE_MAX, prev.title).trim() || prev.title : prev.title,
      html: req.body?.html !== undefined ? sanitizeHtml(req.body.html) : prev.html,
      characterId: req.body?.characterId !== undefined ? characterFor(req, c, req.body.characterId) : prev.characterId,
      updatedAt: new Date().toISOString(),
    };
    db().notes = db().notes.map((n) => (n.id === prev.id ? next : n));
    save();
    return { note: view(next) };
  }));

  r.delete('/campaigns/:id/notes/:noteId', logged, handle((req) => {
    const prev = mine(req, campaignOf(req));
    db().notes = db().notes.filter((n) => n.id !== prev.id);
    save();
    return { ok: true };
  }));
}

module.exports = { registerNotes, sanitizeHtml, plainText };
