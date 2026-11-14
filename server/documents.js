// Documentos propios: cada usuario sube los suyos (PDF, texto, Markdown, imágenes) y los consulta
// siempre; el DM los comparte en su campaña con todos sus jugadores o con algunos. Los archivos viven en
// DATA_DIR/docs y NO se sirven por URL directa: se descargan pasando por canSee. El texto se extrae al
// subir (pdftotext para PDF) y se guarda al lado como <archivo>.txt para buscar dentro.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const multer = require('multer');
const { db, save, DATA_DIR } = require('./db');
const camp = require('./campaigns');
const { log } = require('./logger');

const DOCS_DIR = path.join(DATA_DIR, 'docs');
const MAX_DOC_BYTES = 40 * 1024 * 1024;
const MAX_DOCS_PER_USER = 100;
const MAX_TEXT_CHARS = 4 * 1024 * 1024;
const SEARCH_LIMIT = 30;
const SNIPPET_CHARS = 90;
const PDF_TIMEOUT_MS = 60000;
const DOC_TYPES = {
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/markdown': '.md', 'text/x-markdown': '.md',
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
};
const TEXT_EXT = new Set(['.txt', '.md']);

fs.mkdirSync(DOCS_DIR, { recursive: true });

/** Minúsculas y sin tildes, para buscar «dragon» y encontrar «Dragón». */
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿Puede este usuario ver el documento? Dueño, o jugador/DM de una campaña con la que se compartió. */
function canSee(doc, user, campaigns) {
  if (doc.ownerId === user.id) return true;
  return (doc.shares || []).some((sh) => {
    const c = campaigns.find((x) => x.id === sh.campaignId);
    if (!c) return false;
    if (c.dmId === user.id) return true;
    return c.playerIds.includes(user.id) && (sh.userIds === null || sh.userIds.includes(user.id));
  });
}

/** Coincidencias de `q` en el texto por páginas: [{ page, snippet }] (una por página). */
function searchPages(pages, q) {
  const needle = fold(q).trim();
  if (!needle) return [];
  return pages.flatMap((text, i) => {
    const at = fold(text).indexOf(needle);
    if (at < 0) return [];
    const from = Math.max(0, at - SNIPPET_CHARS);
    const snippet = text.slice(from, at + needle.length + SNIPPET_CHARS).replace(/\s+/g, ' ').trim();
    return [{ page: i + 1, snippet: `${from ? '…' : ''}${snippet}…` }];
  });
}

const textFile = (doc) => path.join(DOCS_DIR, `${doc.file}.txt`);

/** Texto de un archivo recién subido, separado en páginas por \f. */
function extractText(file, ext) {
  if (TEXT_EXT.has(ext)) return Promise.resolve(fs.readFileSync(file, 'utf8').slice(0, MAX_TEXT_CHARS));
  if (ext !== '.pdf') return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 64 * 1024 * 1024, timeout: PDF_TIMEOUT_MS }, (err, out) => {
      if (err) log.warn('no se pudo extraer texto del PDF', { file: path.basename(file), error: err.message });
      resolve(err ? '' : String(out).slice(0, MAX_TEXT_CHARS));
    });
  });
}

// Texto por documento en memoria, cargado al buscar por primera vez.
const pageCache = new Map();
function pagesOf(doc) {
  if (!pageCache.has(doc.id)) {
    let text = '';
    try { text = fs.readFileSync(textFile(doc), 'utf8'); } catch { /* sin texto (imagen) */ }
    pageCache.set(doc.id, text.split('\f'));
  }
  return pageCache.get(doc.id);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: DOCS_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${DOC_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(DOC_TYPES[file.mimetype] ? null : new Error('Solo PDF, texto (.txt, .md) o imágenes PNG/JPG/WEBP'), true),
});

/** Limpia los repartos: solo campañas donde quien comparte es DM, y jugadores de esa campaña. */
function cleanShares(shares, user) {
  if (!Array.isArray(shares)) throw new Error('Repartos inválidos');
  return shares.slice(0, 20).map((sh) => {
    const c = camp.findCampaign(sh?.campaignId);
    if (!c || !camp.isDM(user, c)) throw new Error('Solo el DM de una campaña puede compartir documentos en ella');
    const userIds = Array.isArray(sh.userIds) ? sh.userIds.filter((id) => c.playerIds.includes(id)) : null;
    return { campaignId: c.id, userIds };
  });
}

function registerDocuments(r, { handle, httpError, logged }) {
  const visible = (req) => (db().documents || []).filter((d) => canSee(d, req.user, db().campaigns));
  const view = (req, d) => ({
    id: d.id, title: d.title, mime: d.mime, size: d.size, pages: d.pages, createdAt: d.createdAt, file: d.file,
    mine: d.ownerId === req.user.id, owner: db().users.find((u) => u.id === d.ownerId)?.displayName || '—',
    shares: d.ownerId === req.user.id ? d.shares : undefined,
  });
  const ownDoc = (req) => {
    const d = (db().documents || []).find((x) => x.id === req.params.id && x.ownerId === req.user.id);
    if (!d) throw httpError(404, 'Documento no encontrado');
    return d;
  };

  r.get('/documentos', logged, handle((req) => ({ documents: visible(req).map((d) => view(req, d)) })));

  r.get('/documentos/buscar', logged, handle((req) => {
    const q = String(req.query.q || '').slice(0, 100);
    const inTitle = (d) => (q.trim() && fold(d.title).includes(fold(q).trim()) ? [{ page: 1, snippet: d.title }] : []);
    const results = visible(req).flatMap((d) => [...inTitle(d), ...searchPages(pagesOf(d), q)]
      .slice(0, 5).map((hit) => ({ id: d.id, title: d.title, ...hit })));
    return { results: results.slice(0, SEARCH_LIMIT) };
  }));

  r.post('/documentos', logged, (req, res) => {
    if ((db().documents || []).filter((d) => d.ownerId === req.user.id).length >= MAX_DOCS_PER_USER) {
      return res.status(400).json({ error: `Máximo ${MAX_DOCS_PER_USER} documentos por persona` });
    }
    upload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Documento demasiado grande (máx 40 MB)' : err.message });
      if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo' });
      try {
        const ext = path.extname(req.file.filename);
        const text = await extractText(req.file.path, ext);
        fs.writeFileSync(path.join(DOCS_DIR, `${req.file.filename}.txt`), text);
        const title = String(req.body?.title || req.file.originalname || 'Documento').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 80) || 'Documento';
        const doc = {
          id: crypto.randomUUID(), ownerId: req.user.id, title, file: req.file.filename, mime: req.file.mimetype, size: req.file.size,
          pages: ext === '.pdf' ? Math.max(1, text.split('\f').filter((p) => p.trim()).length) : 1, shares: [], createdAt: new Date().toISOString(),
        };
        db().documents = [...(db().documents || []), doc];
        save();
        log.info('documento subido', { user: req.user.username, bytes: req.file.size, mime: req.file.mimetype });
        res.json({ document: view(req, doc) });
      } catch (e) {
        log.error('no se pudo guardar el documento', { error: e.message });
        fs.rmSync(req.file.path, { force: true });
        res.status(500).json({ error: 'No se pudo guardar el documento' });
      }
    });
  });

  r.get('/documentos/:id/archivo', logged, (req, res) => {
    const d = visible(req).find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.title)}${path.extname(d.file)}"`);
    res.sendFile(path.join(DOCS_DIR, d.file), (e) => e && !res.headersSent && res.status(404).json({ error: 'Archivo perdido' }));
  });

  r.patch('/documentos/:id', logged, handle((req) => {
    const prev = ownDoc(req);
    const next = {
      ...prev,
      title: req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 80) || prev.title : prev.title,
      shares: req.body?.shares !== undefined ? cleanShares(req.body.shares, req.user) : prev.shares,
    };
    db().documents = db().documents.map((d) => (d.id === prev.id ? next : d));
    save();
    return { document: view(req, next) };
  }));

  r.delete('/documentos/:id', logged, handle((req) => {
    const d = ownDoc(req);
    db().documents = db().documents.filter((x) => x.id !== d.id);
    pageCache.delete(d.id);
    for (const f of [path.join(DOCS_DIR, d.file), textFile(d)]) fs.rmSync(f, { force: true });
    save();
    return { ok: true };
  }));
}

module.exports = { registerDocuments, canSee, searchPages, DOCS_DIR };
