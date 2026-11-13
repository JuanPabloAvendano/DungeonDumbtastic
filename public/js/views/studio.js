// Taller de mapas del DM (estilo Dungeon Scrawl): preparar y retocar mapas fuera de la mesa —
// recortar, borrar, pintar, dibujar salas, colocar objetos sin fondo— y mandarlos a una campaña.
import { h, clear, field, toast, modal, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { MapEditor } from '../studio/editor.js';
import { openBackgroundRemover } from '../studio/bgremove.js';

const DEFAULT_GRID = 70;
const BLANK = { cols: 20, rows: 15, color: '#1c1822' };
const TOOLS = [
  ['select', '➚', 'Mover objetos (arrastra; asa cuadrada = tamaño, asa redonda = girar)'],
  ['pan', '✋', 'Mover la vista (también: clic derecho o barra espaciadora)'],
  ['brush', '🖌', 'Pincel'],
  ['erase', '⌫', 'Goma: borra partes del mapa'],
  ['room', '▭', 'Sala: arrastra para dibujar suelo y paredes sobre la cuadrícula'],
  ['crop', '✂', 'Recortar: arrastra el rectángulo que quieres conservar'],
];
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

function pickFile(accept = IMAGE_ACCEPT) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    input.click();
  });
}

async function uploadBlob(blob, endpoint, name) {
  const form = new FormData();
  form.append('image', blob, name);
  return (await api.post(endpoint, form)).url;
}

/** WebP pesa mucho menos que PNG en mapas grandes y conserva la transparencia; si no hay, PNG. */
function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => {
    if (b && b.type === 'image/webp') return resolve(b);
    canvas.toBlob(resolve, 'image/png');
  }, 'image/webp', 0.92));
}

// ---------------------------------------------------------------- portada del taller
export function studioView(root, { me, go, header, route }) {
  if (me.role !== 'dm' && me.role !== 'superadmin') {
    go('#/');
    return null;
  }
  if (route.id) return editorScreen(root, { go, route });
  const list = h('div.cards');
  clear(root, h('div.page', header(), h('main.lobby',
    h('section.hero', h('div', h('h2', 'Taller de mapas'),
      h('p.muted', 'Prepara y retoca tus mapas antes de usarlos: recorta, borra, pinta, dibuja salas y coloca objetos. Luego mándalos a la biblioteca de una campaña.'))),
    h('div.row.wrap',
      h('button.btn.primary', { onclick: () => go('#/mapas/nuevo') }, '+ Mapa en blanco'),
      h('button.btn', {
        onclick: async () => {
          const file = await pickFile();
          if (!file) return;
          try {
            toast('Subiendo imagen…');
            const url = await uploadBlob(file, '/upload/map', file.name);
            go(`#/mapas/nuevo?desde=${encodeURIComponent(url)}&nombre=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ''))}`);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, '⬆ Empezar desde una imagen')),
    h('section', h('h2.section-title', 'Mis borradores'), list))));
  api.get('/studio/drafts').then(({ drafts }) => {
    clear(list, drafts.length ? drafts.map((d) => h('article.card.campaign',
      h('div.card-img', { style: { backgroundImage: `url("${d.baseUrl}")` } }),
      h('div.card-body',
        h('h3', d.name),
        h('p.tiny.muted', `${Math.round(d.width / DEFAULT_GRID)}×${Math.round(d.height / DEFAULT_GRID)} casillas aprox. · ${new Date(d.updatedAt).toLocaleString()}`),
        h('div.row',
          h('button.btn.primary', { onclick: () => go(`#/mapas/${d.id}`) }, 'Abrir'),
          h('button.icon-btn', {
            title: 'Borrar borrador',
            onclick: async () => {
              if (!(await confirmDialog(`¿Borrar el borrador «${d.name}»? Los mapas ya enviados a campañas se quedan.`))) return;
              await api.del(`/studio/drafts/${d.id}`).catch((err) => toast(err.message, 'error'));
              studioView(root, { me, go, header, route });
            },
          }, '🗑'))))) : h('p.muted', 'Aún no tienes borradores.'));
  }).catch((err) => toast(err.message, 'error'));
  return null;
}

// ---------------------------------------------------------------- editor
function editorScreen(root, { go, route }) {
  let draftId = route.id === 'nuevo' ? null : route.id;
  let stamps = [];
  const name = h('input.studio-name', { value: route.params.get('nombre') || 'Mapa nuevo', maxlength: 50, title: 'Nombre del mapa' });
  const toolbar = h('div.studio-tools');
  const options = h('div.studio-options');
  const stageBox = h('div.studio-stage-box');
  const side = h('aside.studio-side');
  const status = h('span.tiny.muted');
  const screen = h('div.studio-screen',
    h('header.studio-top',
      h('button.btn.ghost.small', { onclick: () => leave('#/mapas') }, '← Taller'),
      name, status,
      h('div.grow'),
      h('button.btn.small.ghost', { title: 'Deshacer (Ctrl+Z)', onclick: () => ed.undo() }, '↶'),
      h('button.btn.small.ghost', { title: 'Encuadrar', onclick: () => ed.fit() }, '⤢'),
      h('button.btn.small', { onclick: () => save() }, '💾 Guardar'),
      h('button.btn.small.primary', { onclick: () => exportToCampaign() }, '▶ Enviar a una campaña')),
    h('div.studio-body', toolbar, h('div.studio-center', options, stageBox), side));
  clear(root, screen);
  document.body.classList.add('is-table');

  const ed = new MapEditor(stageBox, {
    onChange: () => { status.textContent = ed.dirty ? '● sin guardar' : ''; },
    onSelect: () => renderSide(),
    onCropRect: () => renderOptions(),
  });
  const warn = (e) => { if (ed.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);

  async function leave(hash) {
    if (ed.dirty && !(await confirmDialog('Hay cambios sin guardar. ¿Salir igualmente?'))) return;
    ed.dirty = false;
    go(hash);
  }

  // ---------- herramientas ----------
  function renderTools() {
    clear(toolbar, TOOLS.map(([k, icon, title]) => h(`button.tool-btn${ed.tool === k ? '.on' : ''}`, {
      title, onclick: () => { ed.setTool(k); renderTools(); renderOptions(); },
    }, icon)));
  }

  const color = (value, onInput, title) => h('input', { type: 'color', value, title, oninput: (e) => onInput(e.target.value) });
  const size = () => {
    const out = h('span.tiny', `${ed.brush.size}px`);
    return [h('input', { type: 'range', min: 2, max: 300, value: ed.brush.size, oninput: (e) => { ed.brush.size = Number(e.target.value); out.textContent = `${ed.brush.size}px`; } }), out];
  };

  function renderOptions() {
    const t = ed.tool;
    const label = (txt) => h('span.tiny.muted', txt);
    let body = [label(TOOLS.find(([k]) => k === t)?.[2] || '')];
    if (t === 'brush') body = [label('Color'), color(ed.brush.color, (v) => { ed.brush.color = v; }), label('Grosor'), size()];
    if (t === 'erase') {
      const fill = h('input', { type: 'checkbox', checked: Boolean(ed.eraseTo), onchange: (e) => { ed.eraseTo = e.target.checked ? fillColor.value : null; } });
      const fillColor = color(ed.eraseTo || '#1c1822', (v) => { if (ed.eraseTo) ed.eraseTo = v; }, 'Color de relleno');
      body = [label('Grosor'), size(), h('label.check.tiny', fill, h('span', 'Rellenar con color en vez de dejar transparente')), fillColor];
    }
    if (t === 'room') body = [label('Suelo'), color(ed.room.floor, (v) => { ed.room.floor = v; }), label('Paredes'), color(ed.room.wall, (v) => { ed.room.wall = v; }), label('Arrastra sobre la cuadrícula para dibujar una sala.')];
    if (t === 'crop') {
      const r = ed.cropRect;
      body = [label(r ? `${Math.round(r.w / ed.grid)}×${Math.round(r.h / ed.grid)} casillas` : 'Arrastra el rectángulo que quieres conservar.'),
        h('button.btn.small.primary', { disabled: !r, onclick: () => { if (ed.applyCrop()) { renderTools(); renderOptions(); } } }, '✂ Recortar'),
        r ? h('button.btn.small.ghost', { onclick: () => ed.setCrop(null) }, 'Cancelar') : null];
    }
    clear(options, body);
  }

  // ---------- panel derecho ----------
  async function loadStamps() {
    try {
      ({ stamps } = await api.get('/studio/stamps'));
    } catch (err) { toast(err.message, 'error'); }
    renderSide();
  }

  async function addObject(removeBg) {
    const file = await pickFile();
    if (!file) return;
    const blob = removeBg ? await openBackgroundRemover(file) : file;
    if (!blob) return;
    try {
      toast('Subiendo objeto…');
      const url = await uploadBlob(blob, '/upload', removeBg ? 'objeto.png' : file.name);
      const objName = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Objeto';
      const { stamp } = await api.post('/studio/stamps', { name: objName, url });
      stamps = [...stamps, stamp];
      await ed.addStamp(stamp.url);
      renderTools();
      renderSide();
    } catch (err) { toast(err.message, 'error'); }
  }

  function selectionBox(sel) {
    const sq = (px) => Math.round((px / ed.grid) * 10) / 10;
    const num = (value, onChange, attrs = {}) => h('input', { type: 'number', value, step: 0.5, ...attrs, onchange: (e) => onChange(Number(e.target.value)) });
    const keepAspect = (w) => ({ w: w * ed.grid, h: (w * ed.grid * sel.h) / sel.w });
    return h('div.col',
      h('div.label-mini', 'Objeto elegido'),
      h('div.grid2',
        field('Ancho (casillas)', num(sq(sel.w), (v) => v > 0 && ed.updateSelected(keepAspect(v)), { min: 0.1 })),
        field('Giro (°)', num(Math.round(sel.rot), (v) => ed.updateSelected({ rot: ((v % 360) + 360) % 360 }), { step: 15 }))),
      h('div.row.wrap',
        h('button.btn.small.ghost', { onclick: () => ed.updateSelected({ flip: !sel.flip }) }, '⇋ Espejo'),
        h('button.btn.small.ghost', { onclick: () => ed.reorderSelected(1) }, '⬆ Al frente'),
        h('button.btn.small.ghost', { onclick: () => ed.reorderSelected(-1) }, '⬇ Al fondo'),
        h('button.btn.small.ghost', { title: 'Lo funde con el mapa para poder borrar o pintar encima', onclick: () => ed.stampSelectedDown() }, '⤓ Fijar al mapa'),
        h('button.btn.small.danger', { onclick: () => ed.removeSelected() }, '🗑 Quitar')),
      h('p.tiny.muted', 'Arrastra para mover (Mayús: sin imán). Asa cuadrada: tamaño. Asa redonda: girar.'));
  }

  function canvasBox() {
    const gridIn = h('input', { type: 'number', min: 10, max: 400, value: ed.grid, onchange: (e) => { ed.grid = Math.max(10, Number(e.target.value) || DEFAULT_GRID); ed.changed(); } });
    const sideSel = h('select', [['right', 'Derecha'], ['bottom', 'Abajo'], ['left', 'Izquierda'], ['top', 'Arriba']].map(([v, l]) => h('option', { value: v }, l)));
    const amount = h('input', { type: 'number', value: 2, min: -50, max: 50, title: 'Casillas (negativo = acortar)' });
    const fillOn = h('input', { type: 'checkbox', checked: true });
    const fill = h('input', { type: 'color', value: BLANK.color });
    return h('div.col',
      h('div.label-mini', 'Lienzo'),
      h('p.tiny.muted', `${ed.width}×${ed.height} px · ${Math.round(ed.width / ed.grid)}×${Math.round(ed.height / ed.grid)} casillas`),
      h('div.grid2',
        field('Casilla (px)', gridIn),
        h('div.col',
          h('label.check.tiny', h('input', { type: 'checkbox', checked: ed.showGrid, onchange: (e) => { ed.showGrid = e.target.checked; ed.render(); } }), h('span', 'Ver cuadrícula')),
          h('label.check.tiny', h('input', { type: 'checkbox', checked: ed.snap, onchange: (e) => { ed.snap = e.target.checked; } }), h('span', 'Imán a la cuadrícula')))),
      h('div.label-mini', 'Ampliar o acortar'),
      h('div.row.wrap', sideSel, amount, h('label.check.tiny', fillOn, h('span', 'relleno')), fill,
        h('button.btn.small', { onclick: () => { ed.extend(sideSel.value, Number(amount.value) || 0, fillOn.checked ? fill.value : null); renderSide(); } }, 'Aplicar')),
      h('p.tiny.muted', 'Usa ✂ para recortar a mano. En la mesa, alinea la cuadrícula con el calibrador de la escena.'));
  }

  function renderSide() {
    const sel = ed.selectedStamp();
    clear(side,
      sel ? selectionBox(sel) : null,
      h('div.label-mini', 'Mis objetos'),
      stamps.length ? h('div.stamp-lib', stamps.map((st) => h('div.stamp-item', { title: `${st.name} · clic para colocar`, onclick: async () => { await ed.addStamp(st.url); renderTools(); } },
        h('img', { src: st.url, alt: '' }),
        h('span', st.name),
        h('button.lib-del', {
          title: 'Borrar de mis objetos',
          onclick: async (e) => {
            e.stopPropagation();
            if (!(await confirmDialog(`¿Borrar «${st.name}» de tus objetos? Los ya colocados se quedan.`))) return;
            await api.del(`/studio/stamps/${st.id}`).catch((err) => toast(err.message, 'error'));
            stamps = stamps.filter((x) => x.id !== st.id);
            renderSide();
          },
        }, '✕')))) : h('p.tiny.muted', 'Sube objetos que encuentres (un carruaje, una casa vista desde arriba, muebles…). Quedan guardados para todos tus mapas.'),
      h('div.col',
        h('button.btn.small.primary', { onclick: () => addObject(true) }, '⬆ Subir objeto y quitar fondo'),
        h('button.btn.small.ghost', { onclick: () => addObject(false) }, '⬆ Subir objeto tal cual (PNG ya transparente)')),
      canvasBox());
  }

  // ---------- guardar y enviar ----------
  async function save() {
    try {
      status.textContent = 'Guardando…';
      const baseUrl = await uploadBlob(await canvasBlob(ed.base), '/upload/map', 'base.webp');
      const body = { name: name.value, baseUrl, ...ed.serialize() };
      const { draft } = draftId ? await api.patch(`/studio/drafts/${draftId}`, body) : await api.post('/studio/drafts', body);
      ed.dirty = false;
      status.textContent = '✓ guardado';
      if (!draftId) {
        draftId = draft.id;
        history.replaceState(null, '', `#/mapas/${draft.id}`);
      }
      return true;
    } catch (err) {
      status.textContent = '● sin guardar';
      toast(err.message, 'error');
      return false;
    }
  }

  async function exportToCampaign() {
    let campaigns;
    try {
      campaigns = (await api.get('/campaigns')).campaigns.filter((c) => c.isDM);
    } catch (err) { return toast(err.message, 'error'); }
    if (!campaigns.length) return toast('Primero crea una campaña', 'info');
    const pick = h('select', campaigns.map((c) => h('option', { value: c.id }, c.name)));
    const dlg = modal('Enviar a una campaña', h('div.col',
      h('p.muted', 'Se añade el mapa (con los objetos fundidos) a la biblioteca de la campaña. El borrador sigue aquí para retocarlo.'),
      field('Campaña', pick),
      h('button.btn.primary', {
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            toast('Preparando el mapa…');
            const url = await uploadBlob(await canvasBlob(ed.flatten()), '/upload/map', 'mapa.webp');
            await api.post(`/campaigns/${pick.value}/maps`, { name: name.value, url });
            dlg.close();
            toast('Mapa añadido a la biblioteca de la campaña', 'ok');
          } catch (err) {
            e.target.disabled = false;
            toast(err.message, 'error');
          }
        },
      }, '▶ Enviar')));
  }

  // ---------- abrir ----------
  async function open() {
    try {
      if (draftId) {
        const { draft } = await api.get(`/studio/drafts/${draftId}`);
        name.value = draft.name;
        await ed.loadDraft(draft);
      } else if (route.params.get('desde')) {
        await ed.loadBase(route.params.get('desde'));
      } else {
        ed.blank(BLANK.cols * DEFAULT_GRID, BLANK.rows * DEFAULT_GRID, BLANK.color);
      }
    } catch (err) {
      toast(err.message, 'error');
      ed.blank(BLANK.cols * DEFAULT_GRID, BLANK.rows * DEFAULT_GRID, BLANK.color);
    }
    renderSide();
  }

  renderTools();
  renderOptions();
  renderSide();
  loadStamps();
  open();

  return () => {
    window.removeEventListener('beforeunload', warn);
    ed.destroy();
    // Un diálogo abierto (quitar fondo, enviar) no debe quedarse flotando sobre otra pantalla.
    document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  };
}
