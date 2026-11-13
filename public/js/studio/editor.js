// Motor del taller de mapas: una capa base de píxeles (imagen subida o lienzo en blanco) sobre la
// que se pinta, borra, dibujan salas y se recorta, y encima objetos que se mueven, escalan y giran.
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 6;
const HANDLE_PX = 10;
const ROTATE_OFFSET_PX = 28;
const UNDO_LIMIT = 12;
// Por encima de este tamaño cada copia para deshacer pesa demasiado (4 bytes por píxel).
const BIG_CANVAS_PX = 16e6;
const UNDO_LIMIT_BIG = 3;
const CHECKER_PX = 16;
const ROTATE_STEP = 15;

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
  img.src = url;
});

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function copyCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class MapEditor {
  /**
   * @param {HTMLElement} container
   * @param {{ onChange?:()=>void, onSelect?:(stamp:object|null)=>void, onCropRect?:(rect:object|null)=>void }} hooks
   */
  constructor(container, hooks = {}) {
    this.hooks = hooks;
    this.base = makeCanvas(1400, 1050);
    this.grid = 70;
    this.showGrid = true;
    this.snap = true;
    this.stamps = [];
    this.selected = null;
    this.tool = 'select';
    this.brush = { color: '#2b2233', size: 24 };
    this.room = { floor: '#d9cfb8', wall: '#2a2230' };
    this.eraseTo = null; // null = deja transparente; si no, el color con que rellena la goma
    this.view = { x: 0, y: 0, z: 1 };
    this.undoStack = [];
    this.cropRect = null;
    this.roomPreview = null;
    this.dirty = false;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'studio-canvas';
    this.root = document.createElement('div');
    this.root.className = 'studio-stage';
    this.root.append(this.canvas);
    container.append(this.root);
    new ResizeObserver(() => this.resize()).observe(this.root);
    this.bindPointer();
    this.onKey = (e) => this.handleKey(e);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  // ---------- documento ----------
  get width() { return this.base.width; }
  get height() { return this.base.height; }

  blank(w, h, color) {
    this.base = makeCanvas(w, h);
    if (color) {
      const ctx = this.base.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
    }
    this.stamps = [];
    this.afterLoad();
  }

  async loadBase(url) {
    const img = await loadImage(url);
    this.base = makeCanvas(img.naturalWidth, img.naturalHeight);
    this.base.getContext('2d').drawImage(img, 0, 0);
    this.stamps = [];
    this.afterLoad();
  }

  /** Abre un borrador guardado: base + objetos colocados. */
  async loadDraft(d) {
    await this.loadBase(d.baseUrl);
    this.grid = d.grid || this.grid;
    const placed = await Promise.all((d.stamps || []).map(async (s) => ({ ...s, img: await loadImage(s.url).catch(() => null) })));
    this.stamps = placed.filter((s) => s.img);
    this.afterLoad();
  }

  afterLoad() {
    this.undoStack = [];
    this.select(null);
    this.setCrop(null);
    this.dirty = false;
    this.fit();
    this.changed(false);
  }

  /** Lo que se guarda del borrador (la base se sube aparte como imagen). */
  serialize() {
    return {
      width: this.width, height: this.height, grid: this.grid,
      stamps: this.stamps.map(({ id, url, x, y, w, h, rot, flip }) => ({ id, url, x, y, w, h, rot, flip })),
    };
  }

  // ---------- deshacer ----------
  pushUndo() {
    const limit = this.width * this.height > BIG_CANVAS_PX ? UNDO_LIMIT_BIG : UNDO_LIMIT;
    this.undoStack = [...this.undoStack, { base: copyCanvas(this.base), stamps: this.stamps.map((s) => ({ ...s })) }].slice(-limit);
  }

  undo() {
    const last = this.undoStack[this.undoStack.length - 1];
    if (!last) return false;
    this.undoStack = this.undoStack.slice(0, -1);
    this.base = last.base;
    this.stamps = last.stamps;
    if (this.selected && !this.stamps.some((s) => s.id === this.selected)) this.select(null);
    else this.hooks.onSelect?.(this.selectedStamp());
    this.changed();
    return true;
  }

  changed(markDirty = true) {
    if (markDirty) this.dirty = true;
    this.render();
    this.hooks.onChange?.();
  }

  // ---------- objetos ----------
  async addStamp(url, at) {
    const img = await loadImage(url);
    // Tamaño inicial: el de la imagen, sin pasar de 4 casillas de lado.
    const scale = Math.min(1, (this.grid * 4) / Math.max(img.naturalWidth, img.naturalHeight));
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const c = at || this.viewCenter();
    this.pushUndo();
    const stamp = { id: newId(), url, img, x: c.x - w / 2, y: c.y - h / 2, w, h, rot: 0, flip: false };
    this.stamps = [...this.stamps, stamp];
    this.setTool('select');
    this.select(stamp.id);
    this.changed();
  }

  selectedStamp() {
    return this.stamps.find((s) => s.id === this.selected) || null;
  }

  select(id) {
    this.selected = id;
    this.hooks.onSelect?.(this.selectedStamp());
    this.render();
  }

  /** Cambia propiedades del objeto elegido (sin mutar el original). */
  updateSelected(patch) {
    const s = this.selectedStamp();
    if (!s) return;
    this.pushUndo();
    this.stamps = this.stamps.map((x) => (x.id === s.id ? { ...x, ...patch } : x));
    this.hooks.onSelect?.(this.selectedStamp());
    this.changed();
  }

  removeSelected() {
    if (!this.selected) return;
    this.pushUndo();
    this.stamps = this.stamps.filter((s) => s.id !== this.selected);
    this.select(null);
    this.changed();
  }

  /** dir: 1 = al frente, -1 = al fondo. */
  reorderSelected(dir) {
    const s = this.selectedStamp();
    if (!s) return;
    this.pushUndo();
    const rest = this.stamps.filter((x) => x.id !== s.id);
    this.stamps = dir > 0 ? [...rest, s] : [s, ...rest];
    this.changed();
  }

  /** Funde el objeto con la base: ya no se mueve, pero se puede borrar o pintar encima. */
  stampSelectedDown() {
    const s = this.selectedStamp();
    if (!s) return;
    this.pushUndo();
    this.drawStamp(this.base.getContext('2d'), s);
    this.stamps = this.stamps.filter((x) => x.id !== s.id);
    this.select(null);
    this.changed();
  }

  // ---------- herramientas sobre la base ----------
  setTool(tool) {
    this.tool = tool;
    if (tool !== 'crop') this.setCrop(null);
    this.root.dataset.tool = tool;
    this.render();
  }

  snapPoint(p) {
    if (!this.snap) return p;
    const g = this.grid;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  rectFrom(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  strokeTo(from, to) {
    const ctx = this.base.getContext('2d');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.brush.size;
    if (this.tool === 'erase' && !this.eraseTo) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
    } else {
      ctx.strokeStyle = this.tool === 'erase' ? this.eraseTo : this.brush.color;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Sala al estilo Dungeon Scrawl: suelo relleno con baldosas y paredes gruesas en el borde. */
  drawRoom(r) {
    if (r.w < 4 || r.h < 4) return;
    const ctx = this.base.getContext('2d');
    const g = this.grid;
    ctx.save();
    ctx.fillStyle = this.room.floor;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(0, 0, 0, .12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = r.x + g; x < r.x + r.w; x += g) { ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); }
    for (let y = r.y + g; y < r.y + r.h; y += g) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
    ctx.stroke();
    ctx.strokeStyle = this.room.wall;
    ctx.lineWidth = Math.max(4, g / 7);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  setCrop(rect) {
    this.cropRect = rect;
    this.hooks.onCropRect?.(rect);
    this.render();
  }

  /** Recorta el mapa al rectángulo elegido; los objetos se desplazan con él. */
  applyCrop() {
    const r = this.cropRect;
    if (!r || r.w < 20 || r.h < 20) return false;
    this.pushUndo();
    const next = makeCanvas(r.w, r.h);
    next.getContext('2d').drawImage(this.base, -r.x, -r.y);
    this.base = next;
    this.stamps = this.stamps.map((s) => ({ ...s, x: s.x - r.x, y: s.y - r.y }));
    this.setTool('select');
    this.fit();
    this.changed();
    return true;
  }

  /** Amplía (o, con casillas negativas, acorta) el lienzo por un lado, rellenando lo nuevo con un color. */
  extend(side, squares, color) {
    const add = Math.round(squares * this.grid);
    if (!add) return;
    const horizontal = side === 'left' || side === 'right';
    const dx = side === 'left' ? add : 0;
    const dy = side === 'top' ? add : 0;
    const w = this.width + (horizontal ? add : 0);
    const h = this.height + (horizontal ? 0 : add);
    if (w < 50 || h < 50) return;
    this.pushUndo();
    const next = makeCanvas(w, h);
    const ctx = next.getContext('2d');
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(this.base, dx, dy);
    this.base = next;
    this.stamps = this.stamps.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    this.fit();
    this.changed();
  }

  // ---------- exportar ----------
  drawStamp(ctx, s) {
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
    ctx.rotate((s.rot * Math.PI) / 180);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -s.w / 2, -s.h / 2, s.w, s.h);
    ctx.restore();
  }

  /** Mapa final: base + objetos (sin cuadrícula: la pone el tablero). */
  flatten() {
    const out = copyCanvas(this.base);
    const ctx = out.getContext('2d');
    this.stamps.forEach((s) => this.drawStamp(ctx, s));
    return out;
  }

  // ---------- vista ----------
  resize() {
    const r = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    if (!this.fitted) this.fit();
    this.render();
  }

  fit() {
    const r = this.root.getBoundingClientRect();
    if (!r.width) return;
    const z = Math.min(r.width / this.width, r.height / this.height) * 0.92;
    this.view = { z, x: (r.width - this.width * z) / 2, y: (r.height - this.height * z) / 2 };
    this.fitted = true;
    this.render();
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.x) / this.view.z, y: (clientY - r.top - this.view.y) / this.view.z };
  }

  viewCenter() {
    const r = this.canvas.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const { x, y, z } = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * x, dpr * y);
    this.drawChecker(ctx, z);
    ctx.imageSmoothingEnabled = z < 1;
    ctx.drawImage(this.base, 0, 0);
    ctx.imageSmoothingEnabled = true;
    this.stamps.forEach((s) => this.drawStamp(ctx, s));
    if (this.showGrid) this.drawGrid(ctx, z);
    this.drawSelection(ctx, z);
    this.drawPreviews(ctx, z);
  }

  /** Tablero de ajedrez bajo lo transparente, como en los editores de imagen. */
  drawChecker(ctx, z) {
    const step = CHECKER_PX / z;
    ctx.save();
    ctx.fillStyle = '#2a2433';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#211c29';
    for (let row = 0, cy = 0; cy < this.height; row++, cy += step) {
      for (let cx = (row % 2) * step; cx < this.width; cx += step * 2) ctx.fillRect(cx, cy, Math.min(step, this.width - cx), Math.min(step, this.height - cy));
    }
    ctx.restore();
  }

  drawGrid(ctx, z) {
    const g = this.grid;
    if (g * z < 4) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, .16)';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let gx = 0; gx <= this.width; gx += g) { ctx.moveTo(gx, 0); ctx.lineTo(gx, this.height); }
    for (let gy = 0; gy <= this.height; gy += g) { ctx.moveTo(0, gy); ctx.lineTo(this.width, gy); }
    ctx.stroke();
    ctx.restore();
  }

  drawSelection(ctx, z) {
    const s = this.selectedStamp();
    if (!s || this.tool !== 'select') return;
    const hs = HANDLE_PX / z;
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
    ctx.rotate((s.rot * Math.PI) / 180);
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = '#e3bf6a';
    ctx.fillStyle = '#e3bf6a';
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
    ctx.setLineDash([]);
    ctx.fillRect(s.w / 2 - hs / 2, s.h / 2 - hs / 2, hs, hs);
    ctx.beginPath();
    ctx.moveTo(0, -s.h / 2);
    ctx.lineTo(0, -s.h / 2 - ROTATE_OFFSET_PX / z);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -s.h / 2 - ROTATE_OFFSET_PX / z, hs / 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPreviews(ctx, z) {
    const preview = this.cropRect || this.roomPreview;
    if (preview) {
      ctx.save();
      ctx.lineWidth = 2 / z;
      if (this.cropRect) {
        // Fuera del recorte se oscurece: así se ve qué queda.
        ctx.fillStyle = 'rgba(0, 0, 0, .55)';
        ctx.beginPath();
        ctx.rect(0, 0, this.width, this.height);
        ctx.rect(preview.x, preview.y, preview.w, preview.h);
        ctx.fill('evenodd');
        ctx.strokeStyle = '#8f6bff';
      } else {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = this.room.floor;
        ctx.fillRect(preview.x, preview.y, preview.w, preview.h);
        ctx.strokeStyle = this.room.wall;
      }
      ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
      ctx.restore();
    }
    if (this.cursor && (this.tool === 'brush' || this.tool === 'erase')) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, .8)';
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, this.brush.size / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- ratón / táctil ----------
  /** Qué hay bajo el puntero: asa de girar/escalar del elegido, o el objeto más alto. */
  hitTest(p) {
    const z = this.view.z;
    const local = (s) => {
      const a = (-s.rot * Math.PI) / 180;
      const dx = p.x - (s.x + s.w / 2);
      const dy = p.y - (s.y + s.h / 2);
      return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
    };
    const sel = this.selectedStamp();
    if (sel) {
      const l = local(sel);
      const near = (hx, hy) => Math.abs(l.x - hx) < HANDLE_PX / z && Math.abs(l.y - hy) < HANDLE_PX / z;
      if (near(0, -sel.h / 2 - ROTATE_OFFSET_PX / z)) return { stamp: sel, part: 'rotate' };
      if (near(sel.w / 2, sel.h / 2)) return { stamp: sel, part: 'scale' };
    }
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i];
      const l = local(s);
      if (Math.abs(l.x) <= s.w / 2 && Math.abs(l.y) <= s.h / 2) return { stamp: s, part: 'move' };
    }
    return null;
  }

  bindPointer() {
    let drag = null;
    const c = this.canvas;
    const pan = (e) => ({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y });

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = this.toWorld(e.clientX, e.clientY);
      if (e.button !== 0 || this.tool === 'pan' || this.spaceDown) {
        drag = pan(e);
        return;
      }
      if (this.tool === 'select') {
        const hit = this.hitTest(p);
        if (!hit) {
          this.select(null);
          drag = pan(e);
          return;
        }
        this.select(hit.stamp.id);
        this.pushUndo();
        drag = { kind: hit.part, start: p, orig: { ...hit.stamp } };
        return;
      }
      if (this.tool === 'brush' || this.tool === 'erase') {
        this.pushUndo();
        this.strokeTo(p, p);
        drag = { kind: 'stroke', last: p };
        this.render();
        return;
      }
      if (this.tool === 'room' || this.tool === 'crop') drag = { kind: this.tool, start: this.snapPoint(p) };
    });

    c.addEventListener('pointermove', (e) => {
      const p = this.toWorld(e.clientX, e.clientY);
      this.cursor = p;
      if (!drag) {
        if (this.tool === 'brush' || this.tool === 'erase') this.render();
        return;
      }
      this.dragMove(drag, p, e);
    });

    const end = () => {
      if (!drag) return;
      if (drag.kind === 'room' && this.roomPreview) {
        this.pushUndo();
        this.drawRoom(this.roomPreview);
        this.roomPreview = null;
        this.changed();
      } else if (['move', 'scale', 'rotate', 'stroke'].includes(drag.kind)) {
        this.hooks.onSelect?.(this.selectedStamp());
        this.changed();
      }
      drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.cursor = null; this.render(); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.z * Math.exp(-e.deltaY * 0.0015)));
      const k = z / this.view.z;
      this.view = { z, x: mx - (mx - this.view.x) * k, y: my - (my - this.view.y) * k };
      this.render();
    }, { passive: false });
  }

  dragMove(drag, p, e) {
    if (drag.kind === 'pan') {
      this.view = { ...this.view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
      this.render();
      return;
    }
    if (drag.kind === 'stroke') {
      this.strokeTo(drag.last, p);
      drag.last = p;
      this.render();
      return;
    }
    if (drag.kind === 'room') {
      this.roomPreview = this.rectFrom(drag.start, this.snapPoint(p));
      this.render();
      return;
    }
    if (drag.kind === 'crop') {
      this.setCrop(this.rectFrom(drag.start, this.snapPoint(p)));
      return;
    }
    const o = drag.orig;
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    if (drag.kind === 'move') {
      const raw = { x: o.x + p.x - drag.start.x, y: o.y + p.y - drag.start.y };
      // Con imán, la esquina del objeto cae en la cuadrícula (Mayús lo suelta).
      this.patchLive(o.id, this.snap && !e.shiftKey ? this.snapPoint(raw) : raw);
    } else if (drag.kind === 'scale') {
      const k = Math.max(0.05, Math.hypot(p.x - cx, p.y - cy) / Math.hypot(o.w / 2, o.h / 2));
      const w = o.w * k;
      const h = o.h * k;
      this.patchLive(o.id, { w, h, x: cx - w / 2, y: cy - h / 2 });
    } else if (drag.kind === 'rotate') {
      let rot = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (!e.shiftKey) rot = Math.round(rot / ROTATE_STEP) * ROTATE_STEP;
      this.patchLive(o.id, { rot: ((rot % 360) + 360) % 360 });
    }
  }

  patchLive(id, patch) {
    this.stamps = this.stamps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    this.render();
  }

  handleKey(e) {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === ' ') {
      this.spaceDown = e.type === 'keydown';
      return;
    }
    if (e.type !== 'keydown') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.removeSelected();
    }
  }
}
