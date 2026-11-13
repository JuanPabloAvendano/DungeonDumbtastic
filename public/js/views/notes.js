// Notas de la mesa: cada uno apunta lo suyo (solo lo ve quien lo escribe). El DM puede atar una nota
// a un personaje (PJ o NPC); el jugador, a uno de los suyos o a nada. Formato sencillo con un editor
// en el navegador; el servidor guarda solo negrita, cursiva, tamaños, listas y resaltado.
import { h, clear, toast, confirmDialog, clock } from '../ui.js';
import { api } from '../api.js';

const SAVE_DELAY_MS = 900;
const FORMATS = [
  ['bold', 'B', 'Negrita (Ctrl+B)'], ['italic', 'I', 'Cursiva (Ctrl+I)'], ['underline', 'U', 'Subrayado (Ctrl+U)'], ['strikeThrough', 'S', 'Tachado'],
];
const BLOCKS = [['h3', 'Título'], ['h4', 'Subtítulo'], ['p', 'Normal']];

const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Panel persistente (se crea una vez por mesa para no perder lo que se está escribiendo al refrescar).
 * @param {{ s:object, me:object }} ctx
 */
export function createNotes(ctx) {
  let notes = [];
  let openId = null;
  let filter = 'all';
  let timer = null;
  let loaded = false;
  const el = h('div.panel.notes-panel');

  const characters = () => ctx.s.characters.filter((ch) => ctx.s.isDM || ch.ownerId === ctx.me.id);
  const nameOf = (id) => ctx.s.characters.find((c) => c.id === id)?.name || null;

  async function load() {
    try {
      ({ notes } = await api.get(`/campaigns/${ctx.s.id}/notes`));
      loaded = true;
      render();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function create(characterId = null) {
    try {
      const title = characterId ? `Sobre ${nameOf(characterId)}` : `Sesión ${new Date().toLocaleDateString()}`;
      const { note } = await api.post(`/campaigns/${ctx.s.id}/notes`, { title, html: '', characterId });
      notes = [note, ...notes];
      openId = note.id;
      render();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function patch(id, body, status) {
    try {
      const { note } = await api.patch(`/campaigns/${ctx.s.id}/notes/${id}`, body);
      notes = notes.map((n) => (n.id === id ? note : n));
      if (status) status.textContent = `✓ guardado ${clock(note.updatedAt)}`;
    } catch (err) {
      if (status) status.textContent = '● sin guardar';
      toast(err.message, 'error');
    }
  }

  function aboutSelect(value, onChange) {
    return h('select.small', { title: 'Sobre quién es la nota', onchange: (e) => onChange(e.target.value || null) },
      h('option', { value: '' }, ctx.s.isDM ? 'General (la partida)' : 'Para mí'),
      characters().map((ch) => h('option', { value: ch.id, selected: ch.id === value }, `${ch.npc ? 'NPC · ' : ''}${ch.name}`)));
  }

  function renderList() {
    const shown = notes.filter((n) => filter === 'all' || (filter === 'general' ? !n.characterId : n.characterId === filter));
    let newFor = null;
    const pick = aboutSelect(null, (v) => { newFor = v; });
    clear(el,
      h('div.row.wrap', h('button.btn.small.primary', { onclick: () => create(newFor) }, '+ Nota'), pick),
      h('div.row', h('span.tiny.muted', 'Ver'), h('select.small', { onchange: (e) => { filter = e.target.value; render(); } },
        h('option', { value: 'all', selected: filter === 'all' }, 'Todas'),
        h('option', { value: 'general', selected: filter === 'general' }, ctx.s.isDM ? 'Generales' : 'Para mí'),
        characters().map((ch) => h('option', { value: ch.id, selected: filter === ch.id }, ch.name)))),
      !loaded ? h('p.tiny.muted', 'Cargando…') : shown.length ? shown.map((n) => h('button.note-item', { onclick: () => { openId = n.id; render(); } },
        h('div.row.between', h('b', n.title), h('span.tiny.muted', clock(n.updatedAt))),
        n.characterId ? h('span.tiny.note-about', `👤 ${nameOf(n.characterId) || 'personaje que ya no está'}`) : null,
        h('p.tiny.muted', n.preview || 'Vacía'))) : h('p.tiny.muted', 'Sin notas todavía. Solo tú ves las tuyas.'));
  }

  function renderEditor(n) {
    const status = h('span.tiny.muted', `guardado ${clock(n.updatedAt)}`);
    const body = h('div.note-body', { contenteditable: 'true', spellcheck: 'true' });
    // El HTML viene del servidor, que ya lo pasó por su lista blanca de etiquetas sin atributos.
    body.innerHTML = n.html;
    const queue = () => {
      clearTimeout(timer);
      status.textContent = '● escribiendo…';
      timer = setTimeout(() => patch(n.id, { html: body.innerHTML }, status), SAVE_DELAY_MS);
    };
    body.addEventListener('input', queue);
    const cmd = (name, arg) => {
      body.focus();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(name, false, arg);
      queue();
    };
    const highlight = () => {
      const text = String(window.getSelection() || '');
      if (text) cmd('insertHTML', `<mark>${escapeHtml(text)}</mark>`);
    };
    const keep = (e) => e.preventDefault(); // que el botón no robe la selección del texto
    const title = h('input.note-title', {
      value: n.title, maxlength: 60,
      oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => patch(n.id, { title: e.target.value }, status), SAVE_DELAY_MS); },
    });
    const back = () => {
      clearTimeout(timer);
      patch(n.id, { html: body.innerHTML, title: title.value });
      openId = null;
      render();
    };
    const remove = async () => {
      if (!(await confirmDialog(`¿Borrar la nota «${n.title}»?`))) return;
      try {
        await api.del(`/campaigns/${ctx.s.id}/notes/${n.id}`);
        notes = notes.filter((x) => x.id !== n.id);
        openId = null;
        render();
      } catch (err) { toast(err.message, 'error'); }
    };
    clear(el,
      h('div.row.between', h('button.btn.small.ghost', { onclick: back }, '← Notas'), status),
      title,
      h('div.row', aboutSelect(n.characterId, (v) => patch(n.id, { characterId: v }, status))),
      h('div.note-tools',
        FORMATS.map(([name, label, tip]) => h(`button.ntool.t-${name}`, { title: tip, onmousedown: keep, onclick: () => cmd(name) }, label)),
        h('span.ntool-sep'),
        BLOCKS.map(([tag, label]) => h('button.ntool', { title: label, onmousedown: keep, onclick: () => cmd('formatBlock', tag) }, label)),
        h('span.ntool-sep'),
        h('button.ntool', { title: 'Lista', onmousedown: keep, onclick: () => cmd('insertUnorderedList') }, '•'),
        h('button.ntool', { title: 'Lista numerada', onmousedown: keep, onclick: () => cmd('insertOrderedList') }, '1.'),
        h('button.ntool', { title: 'Resaltar lo seleccionado', onmousedown: keep, onclick: highlight }, '🖍'),
        h('button.ntool', { title: 'Deshacer (Ctrl+Z)', onmousedown: keep, onclick: () => cmd('undo') }, '↶')),
      body,
      h('div.row.end', h('button.btn.small.danger', { onclick: remove }, '🗑 Borrar')));
  }

  function render() {
    const n = openId && notes.find((x) => x.id === openId);
    if (n) renderEditor(n);
    else renderList();
  }

  return {
    el,
    /** Al entrar a la pestaña la primera vez se cargan; luego no se rehace mientras se escribe. */
    show() {
      if (!loaded) load();
      else if (!openId) render();
      return el;
    },
    /** Abre (o crea) la nota sobre un personaje: el DM lo usa desde el inspector de una ficha. */
    async openFor(characterId) {
      if (!loaded) await load();
      const found = notes.find((x) => x.characterId === characterId);
      if (!found) return create(characterId);
      openId = found.id;
      render();
    },
  };
}
