// Documentos propios: subir (PDF, texto, imágenes), buscar dentro, leer y, si eres DM de la campaña,
// compartirlos con todos tus jugadores o con algunos. Se usa en el lobby y en el cajón de la mesa.
import { h, clear, field, toast, modal, confirmDialog } from '../ui.js';
import { api } from '../api.js';

const DEBOUNCE_MS = 300;
const ACCEPT = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp';
const ICON = { 'application/pdf': '📕', 'text/plain': '📄', 'text/markdown': '📝', 'text/x-markdown': '📝' };
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Descarga el archivo con la sesión y devuelve una URL local (blob) para verlo. */
async function blobUrl(doc) {
  const res = await fetch(`/api/documentos/${doc.id}/archivo`, { headers: { Authorization: `Bearer ${api.token()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Visor: PDF en el lector del navegador (en la página pedida), texto tal cual, imagen a tamaño. */
async function openViewer(doc, page = 1) {
  const body = h('div.doc-viewer', h('p.muted', 'Abriendo…'));
  let url = null;
  const m = modal(doc.title, body, { wide: true, onClose: () => url && URL.revokeObjectURL(url) });
  try {
    url = await blobUrl(doc);
    if (doc.mime === 'application/pdf') clear(body, h('iframe.doc-frame', { src: `${url}#page=${page}`, title: doc.title }));
    else if (doc.mime.startsWith('image/')) clear(body, h('img.doc-image', { src: url, alt: doc.title }));
    else clear(body, h('pre.doc-text', await (await fetch(url)).text()));
  } catch (err) {
    m.close();
    toast(err.message, 'error');
  }
}

/** El DM elige con quién de la campaña lo comparte: nadie, todos los jugadores o algunos. */
function openShare(doc, campaign, onDone) {
  const current = (doc.shares || []).find((s) => s.campaignId === campaign.id);
  const mode = h('select',
    h('option', { value: 'none', selected: !current }, 'Solo yo'),
    h('option', { value: 'all', selected: current && current.userIds === null }, 'Todos los jugadores de la campaña'),
    h('option', { value: 'some', selected: current && Array.isArray(current.userIds) }, 'Solo algunos jugadores'));
  const picks = campaign.players.map((p) => [p.id, h('input', { type: 'checkbox', checked: Boolean(current?.userIds?.includes(p.id)) })]);
  const pickBox = h('div.loot-picks', campaign.players.map((p, i) => h('label.check', picks[i][1], h('span', p.displayName))));
  const sync = () => pickBox.classList.toggle('hidden', mode.value !== 'some');
  mode.addEventListener('change', sync);
  sync();
  const m = modal(`Compartir «${doc.title}»`, [
    field(`En «${campaign.name}»`, mode), pickBox,
    h('div.row.end', h('button.btn.primary', {
      onclick: async () => {
        const others = (doc.shares || []).filter((s) => s.campaignId !== campaign.id);
        const mine = mode.value === 'none' ? [] : [{ campaignId: campaign.id, userIds: mode.value === 'all' ? null : picks.filter(([, b]) => b.checked).map(([id]) => id) }];
        try {
          await api.patch(`/documentos/${doc.id}`, { shares: [...others, ...mine] });
          toast('Guardado', 'ok');
          m.close();
          onDone();
        } catch (err) { toast(err.message, 'error'); }
      },
    }, 'Guardar')),
  ]);
}

/**
 * Panel de documentos. `campaign` (opcional, en la mesa): { id, name, isDM, players:[{id,displayName}] }
 * para poder compartir allí.
 */
export function documentsPanel({ campaign = null } = {}) {
  const search = h('input', { type: 'search', placeholder: 'Buscar dentro de tus documentos…', 'aria-label': 'Buscar en documentos' });
  const fileInput = h('input.hidden', { type: 'file', accept: ACCEPT });
  const list = h('div.doc-list');
  let docs = [];
  let timer = null;

  async function load() {
    try { docs = (await api.get('/documentos')).documents; } catch (err) { toast(err.message, 'error'); }
    if (!search.value.trim()) drawList();
  }

  const shareBadge = (d) => {
    if (!d.mine) return h('small.doc-badge', `de ${d.owner}`);
    const here = campaign && (d.shares || []).find((s) => s.campaignId === campaign.id);
    if (here) return h('small.doc-badge.shared', here.userIds === null ? 'compartido con todos' : `compartido con ${here.userIds.length}`);
    return (d.shares || []).length ? h('small.doc-badge', 'compartido') : null;
  };

  function drawList() {
    clear(list, docs.length ? docs.map((d) => h('div.doc-row',
      h('button.doc-open', { onclick: () => openViewer(d) },
        h('span.doc-icon', d.mime.startsWith('image/') ? '🖼' : ICON[d.mime] || '📄'),
        h('span.grow', h('b', d.title), h('small.muted', [d.mime === 'application/pdf' ? `${d.pages} pág.` : '', sizeText(d.size)].filter(Boolean).join(' · ')))),
      shareBadge(d),
      d.mine && campaign?.isDM ? h('button.btn.small.ghost', { title: 'Compartir con tus jugadores', onclick: () => openShare(d, campaign, load) }, '👥') : null,
      d.mine ? h('button.icon-btn.small', {
        title: 'Borrar',
        onclick: async () => {
          if (!(await confirmDialog(`¿Borrar «${d.title}»? Dejará de verlo todo el que lo tenga compartido.`))) return;
          try { await api.del(`/documentos/${d.id}`); load(); } catch (err) { toast(err.message, 'error'); }
        },
      }, '🗑') : null))
      : h('div.cp-empty', h('p', 'Aún no tienes documentos.'), h('p.tiny.muted', 'Sube PDF, notas en texto o Markdown, o imágenes (mapas, cartas, retratos). Solo los ves tú hasta que, como DM, los compartas.')));
  }

  async function runSearch() {
    const q = search.value.trim();
    if (!q) return drawList();
    try {
      const { results } = await api.get(`/documentos/buscar?q=${encodeURIComponent(q)}`);
      clear(list, results.length ? results.map((r) => h('button.doc-hit', { onclick: () => openViewer(docs.find((d) => d.id === r.id) || r, r.page) },
        h('b', r.title), h('small.muted', ` · pág. ${r.page}`), h('div.tiny', r.snippet)))
        : h('p.muted.tiny', `Nada con «${q}» en tus documentos.`));
    } catch (err) { toast(err.message, 'error'); }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    toast(`Subiendo «${file.name}»…`);
    try {
      const res = await fetch('/api/documentos', { method: 'POST', headers: { Authorization: `Bearer ${api.token()}` }, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      toast('Documento subido', 'ok');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, DEBOUNCE_MS); });

  const el = h('div.doc-panel',
    h('div.row', search, h('button.btn.small.primary', { onclick: () => fileInput.click() }, '⬆ Subir'), fileInput),
    list);
  load();
  return { el, refresh: load, focus: () => search.focus() };
}

/** Biblioteca personal en una ventana (desde el lobby). */
export function openDocumentsLibrary() {
  modal('📄 Mis documentos', documentsPanel().el, { wide: true });
}
