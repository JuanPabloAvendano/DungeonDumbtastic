// Mis objetos: crear y editar objetos personalizados. Cada uno vale como cosa de inventario (peso,
// valor, arma o armadura) y como objeto del mapa (recoger, abrir, leer, activar).
import { h, clear, field, toast, modal, confirmDialog, pickImage } from '../ui.js';
import { api } from '../api.js';
import { gearFields } from '../inventory-ui.js';
import { formatGp } from '../inventory-rules.js';

const KIND_LABEL = { objeto: 'Objeto', arma: 'Arma', armadura: 'Armadura', escudo: 'Escudo' };
const USE_LABEL = { recoger: '✋ Se recoge', abrir: '🔓 Se abre', leer: '📖 Se lee', activar: '⚙ Se activa', ninguna: '👁 Solo se mira' };
const STOCK_IMAGES = ['bolsa', 'carta', 'cofre', 'llave', 'palanca', 'pocion', 'puerta'].map((n) => `/assets/objects/${n}.svg`);
const DEFAULT_IMG = '/assets/objects/bolsa.svg';
const BLANK = { name: '', kind: 'objeto', weight: 0, value: 0, note: '', img: DEFAULT_IMG, object: { use: 'recoger', description: '', secret: '', text: '' } };

let cache = null;

/** Mis objetos (se piden una vez y se recuerdan hasta que cambian). */
export async function loadTemplates(force = false) {
  if (!cache || force) cache = (await api.get('/plantillas')).templates;
  return cache;
}

/** Lo que va en el inventario al dar o añadir este objeto. */
export function templateToItem(t) {
  const { id, ownerId, updatedAt, object, ...item } = t;
  return structuredClone({ ...item, qty: 1 });
}

/** Ficha para el mapa: un objeto con su función y los datos que dará al recogerlo. */
export function templateToToken(t) {
  return { name: t.name, img: t.img || DEFAULT_IMG, hp: 1, maxHp: 1, size: 1, kind: 'objeto', object: { ...t.object, item: templateToItem(t) } };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Editor de un objeto propio. onSaved recibe la plantilla guardada. */
function templateForm(initial, { onSaved, onDeleted }) {
  let t = structuredClone({ ...BLANK, ...initial, object: { ...BLANK.object, ...(initial.object || {}) } });
  const box = h('div.tpl-form');
  const set = (patch, redraw = false) => {
    t = { ...t, ...patch };
    if (redraw) render();
  };
  const setObj = (patch) => { t = { ...t, object: { ...t.object, ...patch } }; };

  async function saveIt() {
    try {
      const { template } = t.id ? await api.patch(`/plantillas/${t.id}`, t) : await api.post('/plantillas', t);
      t = template;
      render();
      await loadTemplates(true);
      toast('Objeto guardado', 'ok');
      onSaved(template);
    } catch (err) { toast(err.message, 'error'); }
  }

  function render() {
    const img = h('img.tpl-img', { src: t.img || DEFAULT_IMG, alt: '' });
    clear(box,
      h('div.tpl-top',
        h('div.col.tpl-pic', img,
          h('button.btn.small', { type: 'button', onclick: async () => { const url = await pickImage(api); if (url) set({ img: url }, true); } }, 'Subir imagen'),
          h('div.tpl-stock', STOCK_IMAGES.map((src) => h('img', { src, alt: '', title: 'Usar esta imagen', onclick: () => set({ img: src }, true) })))),
        h('div.grid2.grow',
          field('Nombre', h('input', { value: t.name, maxlength: 40, required: true, placeholder: 'Hacha rúnica', oninput: (e) => set({ name: e.target.value }) })),
          field('Tipo', h('select', { onchange: (e) => set({ kind: e.target.value }, true) },
            Object.entries(KIND_LABEL).map(([k, label]) => h('option', { value: k, selected: k === t.kind }, label)))),
          field('Peso (lb)', h('input', { type: 'number', min: 0, step: 0.1, value: t.weight || 0, oninput: (e) => set({ weight: num(e.target.value) }) })),
          field('Valor (po)', h('input', { type: 'number', min: 0, step: 0.01, value: t.value || 0, oninput: (e) => set({ value: num(e.target.value) }) })))),
      gearFields(t, (patch) => set(patch, true)),
      field('Qué es / qué hace (lo ve quien lo tiene)', h('textarea', { rows: 2, maxlength: 400, oninput: (e) => set({ note: e.target.value }) }, t.note || '')),
      h('div.label-mini', 'En el mapa'),
      h('div.grid2',
        field('Al usarlo', h('select', { onchange: (e) => { setObj({ use: e.target.value }); render(); } },
          Object.entries(USE_LABEL).map(([k, label]) => h('option', { value: k, selected: k === t.object.use }, label)))),
        field('Descripción (la ven todos)', h('input', { value: t.object.description || '', maxlength: 600, placeholder: 'Un hacha con runas que brillan', oninput: (e) => setObj({ description: e.target.value }) }))),
      t.object.use === 'leer' ? field('Texto que se lee', h('textarea', { rows: 3, maxlength: 3000, oninput: (e) => setObj({ text: e.target.value }) }, t.object.text || '')) : null,
      field('Nota secreta (solo el DM)', h('input', { value: t.object.secret || '', maxlength: 600, oninput: (e) => setObj({ secret: e.target.value }) })),
      h('div.row.end',
        t.id ? h('button.btn.small.danger', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmDialog(`¿Borrar «${t.name}» de tus objetos? Lo que ya está en mapas o inventarios se queda.`))) return;
            try { await api.del(`/plantillas/${t.id}`); await loadTemplates(true); onDeleted(); } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Borrar') : null,
        t.id ? h('button.btn.small.ghost', { type: 'button', onclick: () => { t = { ...t, id: undefined, name: `${t.name} (copia)` }; render(); } }, 'Duplicar') : null,
        h('button.btn.primary', { type: 'button', onclick: saveIt }, t.id ? 'Guardar cambios' : 'Crear objeto')));
  }
  render();
  return box;
}

/**
 * Gestor de mis objetos: lista a la izquierda, editor a la derecha. `start` abre directamente uno
 * nuevo con esos datos (p. ej. guardar un objeto del mapa con ★).
 */
export async function openTemplateManager({ start = null, onChange } = {}) {
  const list = h('div.tpl-list');
  const editor = h('div.tpl-editor');
  let selected = null;
  let templates = [];

  function drawList() {
    clear(list,
      h('button.btn.small.primary', { onclick: () => edit(null) }, '+ Nuevo objeto'),
      templates.length ? templates.map((t) => h(`button.tpl-row${t.id === selected ? '.active' : ''}`, { onclick: () => edit(t) },
        h('img', { src: t.img || DEFAULT_IMG, alt: '' }),
        h('span.grow', h('b', t.name), h('small.muted', [KIND_LABEL[t.kind], t.value ? formatGp(t.value) : ''].filter(Boolean).join(' · '))))) : h('p.tiny.muted', 'Aún no tienes objetos propios.'));
  }
  async function refresh() {
    try { templates = await loadTemplates(true); } catch (err) { toast(err.message, 'error'); }
    drawList();
  }
  function edit(t) {
    selected = t?.id || null;
    clear(editor, templateForm(t || BLANK, {
      onSaved: (saved) => { selected = saved.id; refresh(); onChange?.(); },
      onDeleted: () => { refresh(); edit(null); onChange?.(); },
    }));
    drawList();
  }

  modal('🧰 Mis objetos', h('div.tpl-manager', list, editor), { wide: true });
  await refresh();
  edit(start);
}
