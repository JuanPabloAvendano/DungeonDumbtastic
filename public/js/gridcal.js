// Calibrador de cuadrícula: pone el tablero encima del dibujo del mapa (tamaño y desfase de
// casilla) y permite recortar una zona de un mapa enorme. Lo usa el asistente de escenas.
import { h, clear } from './ui.js';

const MIN_ZOOM = 0.03;
const MAX_ZOOM = 6;
const MIN_CELL = 10;
const MAX_CELL = 400;
// Por encima de esto muchos móviles no pintan la imagen o van a tirones: mejor recortar.
const BIG_SIDE_PX = 8000;

const round2 = (v) => Math.round(v * 100) / 100;
const mod = (a, n) => ((a % n) + n) % n;

/**
 * @param {{ url:string, grid:{size:number,ox:number,oy:number,show:boolean}, crop:{x,y,w,h}|null }} init
 * @returns {{ el:HTMLElement, value:()=>{grid:object,crop:object|null}, natural:()=>{w:number,h:number}|null }}
 */
export function gridCalibrator({ url, grid, crop }) {
  let g = { ...grid };
  let cut = crop ? { ...crop } : null;
  let natural = null;
  let view = { x: 0, y: 0, z: 1 };
  let tool = 'pan';
  let cellsAcross = 1;

  const img = h('img.gc-img', { src: url, alt: '', draggable: 'false', decoding: 'async' });
  const gridEl = h('div.gc-grid');
  const cropEl = h('div.gc-crop.hidden');
  const drawEl = h('div.gc-draw.hidden');
  const inner = h('div.gc-inner', img, gridEl, cropEl, drawEl);
  const viewport = h('div.gc-view', inner);
  const info = h('div.gc-info.tiny.muted');
  const controls = h('div.gc-controls');
  const toolBar = h('div.seg.gc-tools');

  // ---------- pintar ----------
  function applyView() {
    inner.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    inner.style.setProperty('--gl', `${Math.max(1, 1.2 / view.z)}px`);
  }

  function paint() {
    Object.assign(gridEl.style, { backgroundSize: `${g.size}px ${g.size}px`, backgroundPosition: `${g.ox}px ${g.oy}px` });
    gridEl.classList.toggle('faint', !g.show);
    cropEl.classList.toggle('hidden', !cut);
    if (cut) Object.assign(cropEl.style, { left: `${cut.x}px`, top: `${cut.y}px`, width: `${cut.w}px`, height: `${cut.h}px` });
    if (!natural) return clear(info, 'Cargando imagen…');
    const area = cut || { w: natural.w, h: natural.h };
    const big = natural.w > BIG_SIDE_PX || natural.h > BIG_SIDE_PX;
    clear(info,
      `Imagen ${natural.w}×${natural.h}px`,
      cut ? ` · zona ${Math.round(cut.w)}×${Math.round(cut.h)}px` : '',
      ` · ${Math.floor(area.w / g.size)}×${Math.floor(area.h / g.size)} casillas de ${g.size}px`,
      big && !cut ? h('b.warn-text', ' · Mapa muy grande: recorta una zona por escena para que vaya fluido en móviles') : null);
  }

  function fit() {
    const r = viewport.getBoundingClientRect();
    if (!natural || !r.width) return;
    const f = cut || { x: 0, y: 0, w: natural.w, h: natural.h };
    const z = Math.min(r.width / f.w, r.height / f.h) * 0.95;
    view = { z, x: (r.width - f.w * z) / 2 - f.x * z, y: (r.height - f.h * z) / 2 - f.y * z };
    applyView();
  }

  img.addEventListener('load', () => {
    natural = { w: img.naturalWidth, h: img.naturalHeight };
    Object.assign(inner.style, { width: `${natural.w}px`, height: `${natural.h}px` });
    paint();
    renderControls();
    fit();
  });
  img.addEventListener('error', () => clear(info, h('b.warn-text', 'No se pudo cargar la imagen del mapa.')));

  // ---------- controles ----------
  const num = (value, attrs, onInput) => h('input.mod-input', { type: 'number', value, ...attrs, oninput: (e) => onInput(Number(e.target.value)) });
  const setGrid = (patch) => {
    const size = Math.min(MAX_CELL, Math.max(MIN_CELL, round2(patch.size ?? g.size)));
    g = { ...g, ...patch, size, ox: round2(mod(patch.ox ?? g.ox, size)), oy: round2(mod(patch.oy ?? g.oy, size)) };
    paint();
    renderControls();
  };

  function renderControls() {
    const sizeRange = h('input', { type: 'range', min: MIN_CELL, max: 200, step: 0.1, value: g.size });
    sizeRange.addEventListener('input', () => { g = { ...g, size: Number(sizeRange.value) }; paint(); });
    sizeRange.addEventListener('change', () => setGrid({ size: Number(sizeRange.value) }));
    const across = num(natural ? Math.round((cut?.w || natural.w) / g.size) : '', { min: 1, max: 500, title: 'Casillas a lo ancho' }, () => {});
    const nudge = (label, patch, title) => h('button.btn.small.ghost', { type: 'button', title, onclick: () => setGrid(patch) }, label);
    clear(controls,
      h('div.gc-row',
        h('span.label-mini', 'Casilla'),
        sizeRange,
        num(g.size, { min: MIN_CELL, max: MAX_CELL, step: 0.1 }, (v) => v >= MIN_CELL && setGrid({ size: v })),
        h('span.tiny.muted', 'px'),
        nudge('−', { size: g.size - 0.1 }, 'Casilla 0,1 px más pequeña'),
        nudge('+', { size: g.size + 0.1 }, 'Casilla 0,1 px más grande')),
      h('div.gc-row',
        h('span.label-mini', 'Ancho'),
        across,
        h('button.btn.small', {
          type: 'button',
          title: 'Si sabes cuántas casillas tiene el dibujo de lado a lado',
          onclick: () => { const n = Number(across.value); if (natural && n > 0) setGrid({ size: (cut?.w || natural.w) / n, ox: cut?.x || 0, oy: cut?.y || 0 }); },
        }, 'casillas a lo ancho → ajustar')),
      h('div.gc-row',
        h('span.label-mini', 'Desfase'),
        nudge('←', { ox: g.ox - 1 }, 'Mover la cuadrícula 1 px a la izquierda'),
        nudge('→', { ox: g.ox + 1 }, 'Mover la cuadrícula 1 px a la derecha'),
        nudge('↑', { oy: g.oy - 1 }, 'Mover la cuadrícula 1 px arriba'),
        nudge('↓', { oy: g.oy + 1 }, 'Mover la cuadrícula 1 px abajo'),
        h('span.tiny.muted', `x ${g.ox} · y ${g.oy}`),
        h('label.check.tiny', h('input', { type: 'checkbox', checked: g.show, onchange: (e) => { g = { ...g, show: e.target.checked }; paint(); } }), h('span', 'Mostrar a los jugadores'))));
  }

  function renderTools() {
    const tools = [
      ['pan', '✋ Mover', 'Arrastra para mover la vista, rueda para zoom'],
      ['cells', '▦ Marcar casillas', 'Dibuja un recuadro justo encima de casillas del dibujo'],
      ['crop', '✂ Recortar zona', 'Dibuja la zona del mapa que se usará en esta escena'],
    ];
    const cellsInput = num(cellsAcross, { min: 1, max: 50, title: 'Casillas que abarca el recuadro a lo ancho' }, (v) => { cellsAcross = Math.max(1, Math.round(v) || 1); });
    clear(toolBar,
      tools.map(([k, label, title]) => h(`button${tool === k ? '.on' : ''}`, { type: 'button', title, onclick: () => { tool = k; renderTools(); } }, label)),
      tool === 'cells' ? h('span.gc-hint', 'el recuadro abarca', cellsInput, 'casillas a lo ancho') : null,
      tool === 'crop' && cut ? h('button.btn.small.ghost', { type: 'button', onclick: () => { cut = null; paint(); renderControls(); renderTools(); fit(); } }, 'Usar mapa completo') : null);
    viewport.dataset.tool = tool;
  }

  // ---------- ratón ----------
  const toImage = (e) => {
    const r = viewport.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  let drag = null;

  viewport.addEventListener('pointerdown', (e) => {
    viewport.setPointerCapture(e.pointerId);
    if (tool === 'pan' || e.button !== 0) drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    else drag = { kind: tool, start: toImage(e) };
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      view = { ...view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
      applyView();
      return;
    }
    drag.rect = rectOf(drag.start, toImage(e));
    drawEl.classList.remove('hidden');
    Object.assign(drawEl.style, { left: `${drag.rect.x}px`, top: `${drag.rect.y}px`, width: `${drag.rect.w}px`, height: `${drag.rect.h}px` });
  });
  const end = () => {
    const d = drag;
    drag = null;
    drawEl.classList.add('hidden');
    if (!d?.rect || d.rect.w < 4) return;
    if (d.kind === 'cells') {
      const size = d.rect.w / cellsAcross;
      setGrid({ size, ox: mod(d.rect.x, size), oy: mod(d.rect.y, size) });
    } else if (d.kind === 'crop' && natural) {
      const x = Math.max(0, d.rect.x), y = Math.max(0, d.rect.y);
      cut = { x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(natural.w - x, d.rect.w)), h: Math.round(Math.min(natural.h - y, d.rect.h)) };
      if (cut.w < 50 || cut.h < 50) cut = null;
      paint();
      renderControls();
      renderTools();
    }
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.z * Math.exp(-e.deltaY * 0.0015)));
    const k = z / view.z;
    view = { z, x: mx - (mx - view.x) * k, y: my - (my - view.y) * k };
    applyView();
  }, { passive: false });
  new ResizeObserver(() => fit()).observe(viewport);

  renderTools();
  renderControls();
  paint();
  applyView();

  const el = h('div.gridcal', toolBar, viewport, info, controls,
    h('p.tiny.muted', 'Consejo: haz zoom sobre una zona con casillas claras y usa «Marcar casillas» sobre 3–5 casillas seguidas; luego afina con − / + y las flechas.'));
  return { el, value: () => ({ grid: { ...g }, crop: cut ? { ...cut } : null }), natural: () => natural };
}
