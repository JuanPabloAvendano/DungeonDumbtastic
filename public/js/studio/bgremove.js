// Quitar el fondo a un objeto bajado de internet (un carruaje, una casa vista desde arriba…):
// relleno por inundación desde los bordes o desde donde se hace clic, con tolerancia ajustable.
import { h, clear, modal, toast } from '../ui.js';

// Los objetos no necesitan más: así la inundación es rápida y el PNG pesa poco.
const MAX_SIDE = 1600;
const DEFAULT_TOLERANCE = 24;
const DEFAULT_BRUSH = 24;
const EDGE_SOFTEN = 1.6;
const ALPHA_KEEP = 8;
const UNDO_LIMIT = 10;

/** Distancia de color al cuadrado entre el píxel i y el color c. */
function dist2(d, i, c) {
  const r = d[i] - c[0];
  const g = d[i + 1] - c[1];
  const b = d[i + 2] - c[2];
  return r * r + g * g + b * b;
}

/**
 * Vuelve transparente la zona contigua de color parecido a cada semilla.
 * @param {ImageData} img se modifica (es el búfer de trabajo de este diálogo)
 * @param {number[]} seeds índices de píxel donde empieza cada inundación
 * @param {number} tolerance 0–255
 */
export function floodClear(img, seeds, tolerance) {
  const { data: d, width: w, height: hgt } = img;
  const tol2 = tolerance * tolerance * 3;
  const cleared = new Uint8Array(w * hgt);
  for (const seed of seeds) {
    if (cleared[seed] || d[seed * 4 + 3] === 0) continue;
    const color = [d[seed * 4], d[seed * 4 + 1], d[seed * 4 + 2]];
    const stack = [seed];
    while (stack.length) {
      const p = stack.pop();
      if (cleared[p]) continue;
      const i = p * 4;
      if (d[i + 3] !== 0 && dist2(d, i, color) > tol2) continue;
      cleared[p] = 1;
      const x = p % w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (p >= w) stack.push(p - w);
      if (p < w * (hgt - 1)) stack.push(p + w);
    }
  }
  for (let p = 0; p < cleared.length; p++) if (cleared[p]) d[p * 4 + 3] = 0;
  softenEdges(img, cleared, tolerance);
  return img;
}

/** Los píxeles del borde que se parecen bastante al fondo quedan semitransparentes (sin dientes de sierra). */
function softenEdges(img, cleared, tolerance) {
  const { data: d, width: w } = img;
  const soft2 = (tolerance * EDGE_SOFTEN) ** 2 * 3;
  for (let p = 0; p < cleared.length; p++) {
    if (cleared[p] || d[p * 4 + 3] === 0) continue;
    const nb = [p - 1, p + 1, p - w, p + w].find((q) => q >= 0 && q < cleared.length && cleared[q]);
    if (nb === undefined) continue;
    const i = p * 4;
    const c = [d[i], d[i + 1], d[i + 2]];
    // Compara con el color original del vecino borrado (sigue en RGB aunque su alfa sea 0).
    if (dist2(d, nb * 4, c) <= soft2) d[i + 3] = Math.round(d[i + 3] * 0.5);
  }
}

/** Todos los píxeles del borde de la imagen: el fondo suele tocar los cuatro lados. */
export function borderSeeds(w, hgt) {
  const seeds = [];
  for (let x = 0; x < w; x++) seeds.push(x, (hgt - 1) * w + x);
  for (let y = 1; y < hgt - 1; y++) seeds.push(y * w, y * w + w - 1);
  return seeds;
}

/** Recorta los márgenes transparentes. Devuelve un canvas nuevo. */
function trimmed(canvas) {
  const ctx = canvas.getContext('2d');
  const { data: d, width: w, height: hgt } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = w; let y0 = hgt; let x1 = -1; let y1 = -1;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > ALPHA_KEEP) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return canvas;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, -x0, -y0);
  return out;
}

async function toCanvas(source) {
  const bmp = await createImageBitmap(source);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/**
 * Diálogo para quitar el fondo. Resuelve con un PNG (Blob) recortado, o null si se cancela.
 * @param {Blob} source imagen elegida por el DM
 */
export async function openBackgroundRemover(source) {
  let work;
  try {
    work = await toCanvas(source);
  } catch {
    toast('No se pudo leer esa imagen', 'error');
    return null;
  }
  const ctx = work.getContext('2d', { willReadFrequently: true });
  const original = ctx.getImageData(0, 0, work.width, work.height);
  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = work.width;
  originalCanvas.height = work.height;
  originalCanvas.getContext('2d').putImageData(original, 0, 0);
  let history = [];
  // Herramienta del clic: varita (borra la zona parecida), goma o pincel que restaura el original.
  let mode = 'wand';
  const brush = h('input', { type: 'range', min: 4, max: 160, value: DEFAULT_BRUSH, title: 'Tamaño del pincel' });
  const modes = h('div.seg');
  const tolerance = h('input', { type: 'range', min: 0, max: 120, value: DEFAULT_TOLERANCE });
  const tolLabel = h('b', DEFAULT_TOLERANCE);
  tolerance.addEventListener('input', () => { tolLabel.textContent = tolerance.value; });
  work.className = 'bg-canvas';

  const snapshot = () => { history = [...history, ctx.getImageData(0, 0, work.width, work.height)].slice(-UNDO_LIMIT); };
  const apply = (seeds) => {
    snapshot();
    const img = history[history.length - 1];
    const next = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    ctx.putImageData(floodClear(next, seeds, Number(tolerance.value)), 0, 0);
  };

  const at = (e) => {
    const r = work.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * work.width, y: ((e.clientY - r.top) / r.height) * work.height };
  };
  /** Goma o restaurar: un círculo del tamaño del pincel. */
  const dab = (p) => {
    const radius = Number(brush.value) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill();
    } else {
      ctx.clip();
      ctx.clearRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      ctx.drawImage(originalCanvas, 0, 0);
    }
    ctx.restore();
  };
  let painting = false;
  work.addEventListener('pointerdown', (e) => {
    const p = at(e);
    // Varita: clic en una zona del fondo (por ejemplo, el hueco entre las ruedas) para borrarla.
    if (mode === 'wand') return apply([Math.floor(p.y) * work.width + Math.floor(p.x)]);
    work.setPointerCapture(e.pointerId);
    snapshot();
    painting = true;
    dab(p);
  });
  work.addEventListener('pointermove', (e) => { if (painting) dab(at(e)); });
  work.addEventListener('pointerup', () => { painting = false; });
  const renderModes = () => clear(modes, [['wand', '🪄 Varita'], ['erase', '⌫ Goma'], ['restore', '🖌 Restaurar']].map(([k, label]) => h(`button${mode === k ? '.on' : ''}`, {
    onclick: () => { mode = k; work.dataset.mode = k; renderModes(); },
  }, label)));
  renderModes();

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
      dlg.close();
    };
    const dlg = modal('Quitar el fondo', h('div.bg-remover',
      h('div.bg-view', work),
      h('p.tiny.muted', 'Varita: clic sobre el fondo para borrar esa zona. «Desde los bordes» borra lo que toca los lados. Si se come parte del objeto, deshaz o pásale el pincel «Restaurar». Funciona mejor con fondos lisos (blanco, un color).'),
      h('div.row.wrap', modes,
        h('label.row', h('span.tiny', 'Pincel'), brush),
        h('label.row', h('span.tiny', 'Tolerancia'), tolerance, tolLabel)),
      h('div.row.wrap',
        h('button.btn.small', { onclick: () => apply(borderSeeds(work.width, work.height)) }, '✂ Desde los bordes'),
        h('button.btn.small.ghost', { onclick: () => { const last = history.pop(); if (last) ctx.putImageData(last, 0, 0); } }, '↶ Deshacer'),
        h('button.btn.small.ghost', { onclick: () => { history = []; ctx.putImageData(original, 0, 0); } }, '⟲ Original')),
      h('div.row.end',
        h('button.btn.ghost', { onclick: () => finish(null) }, 'Cancelar'),
        h('button.btn.primary', { onclick: () => trimmed(work).toBlob((blob) => finish(blob), 'image/png') }, 'Guardar objeto'))),
    { wide: true, onClose: () => finish(null) });
  });
}

