// Tablero: mapa (o un recorte suyo), cuadrícula calibrada, fichas, alcance de movimiento y "pings".
import { h, clear } from './ui.js';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const LIVE_MOVE_MS = 70;
const DEFAULT_MAP_SIZE = [1680, 1260];
// Nombre, barra de PG y estados se miden en em sobre este tamaño: proporcionales a la ficha,
// sin pasar de 12 px (lo que se ve en una cuadrícula normal de 60 px o más).
const TOKEN_FONT_MAX = 12;
const TOKEN_FONT_RATIO = 0.2;
const tokenFontPx = (px) => Math.min(TOKEN_FONT_MAX, px * TOKEN_FONT_RATIO);
// Niebla: opacidad de lo que nunca se vio y de lo ya explorado (para el jugador y, más suave, para el DM).
const FOG_ALPHA = { player: { dark: 1, explored: 0.62 }, dm: { dark: 0.68, explored: 0.38 } };
const FOG_RGB = [10, 8, 16];
const DEFAULT_VISION = 6;

export class Board {
  /**
   * @param {HTMLElement} container
   * @param {{ canMove:(t)=>boolean, onMove:(id,x,y,final)=>void, onSelect:(t|null)=>void,
   *           onPing:(x,y)=>void, onDrop:(data,x,y)=>void, onMapReady?:()=>void,
   *           onFogPaint?:(cells:string[], mode:'reveal'|'cover')=>void }} hooks
   */
  constructor(container, hooks) {
    this.hooks = hooks;
    this.view = { x: 0, y: 0, z: 1 };
    this.grid = 70;
    this.ox = 0;
    this.oy = 0;
    this.crop = null;
    this.mapSize = DEFAULT_MAP_SIZE;
    this.tokens = [];
    this.characters = [];
    this.selected = null;
    this.reach = null;
    this.els = new Map();
    this.fog = null;
    this.fogBrush = null;

    this.map = h('img.board-map', { draggable: 'false', alt: '', decoding: 'async' });
    this.gridEl = h('div.board-grid');
    this.reachEl = h('div.board-reach.hidden');
    this.fogEl = h('canvas.board-fog.hidden');
    this.tokenLayer = h('div.board-tokens');
    this.fx = h('div.board-fx');
    // inner = el mapa entero en sus píxeles; world = la ventana (recorte) que se ve.
    this.inner = h('div.board-inner', this.map, this.gridEl, this.fogEl, this.reachEl, this.tokenLayer, this.fx);
    this.world = h('div.board-world', this.inner);
    this.empty = h('div.board-empty', h('div', '🗺'), h('p', 'No hay mapa en esta escena.'));
    this.root = h('div.board', this.world, this.empty, h('div.board-help', 'Rueda: zoom · Arrastrar: mover · Doble clic: señalar'));
    container.append(this.root);

    this.map.addEventListener('load', () => {
      this.mapSize = [this.map.naturalWidth || DEFAULT_MAP_SIZE[0], this.map.naturalHeight || DEFAULT_MAP_SIZE[1]];
      this.mapReady = true;
      this.layout();
      if (this.needsFit) this.fit();
      this.hooks.onMapReady?.();
    });
    this.bindPointer();
    this.bindDrop();
    // No encuadrar hasta conocer el tamaño real del mapa: con el de por defecto el centro cae fuera
    // de los mapas pequeños y las fichas colocadas «en el centro» quedan fuera y no se ven.
    new ResizeObserver(() => this.needsFit && this.mapReady && this.fit()).observe(this.root);
  }

  // ---------- escena ----------
  setScene(scene, mapUrl) {
    const g = scene.grid;
    const cropKey = JSON.stringify(scene.crop || null);
    const changed = this.mapUrl !== mapUrl || this.sceneId !== scene.id || this.cropKey !== cropKey;
    const newImage = this.mapUrl !== mapUrl;
    Object.assign(this, { grid: g.size, ox: g.ox, oy: g.oy, showGrid: g.show, crop: scene.crop || null, sceneId: scene.id, cropKey });
    this.empty.classList.toggle('hidden', Boolean(mapUrl));
    if (newImage) {
      // Sin mapa se usa el tamaño por defecto, que ya es el definitivo.
      this.mapReady = !mapUrl;
      if (mapUrl) this.map.src = mapUrl;
      else this.map.removeAttribute('src');
    }
    this.mapUrl = mapUrl;
    if (changed) this.needsFit = true;
    this.layout();
    // Mismo mapa con otro recorte o escena: ya está cargado, se encuadra ya. Mapa nuevo: al cargar.
    if (changed && (!newImage || !mapUrl)) this.fit();
    this.renderTokens();
  }

  /** Rectángulo visible en píxeles del mapa. */
  frame() {
    const [w, hgt] = this.mapSize;
    return this.crop || { x: 0, y: 0, w, h: hgt };
  }

  layout() {
    const [w, hgt] = this.mapSize;
    const f = this.frame();
    Object.assign(this.world.style, { width: `${f.w}px`, height: `${f.h}px` });
    Object.assign(this.inner.style, { width: `${w}px`, height: `${hgt}px`, transform: `translate(${-f.x}px, ${-f.y}px)` });
    Object.assign(this.gridEl.style, { backgroundSize: `${this.grid}px ${this.grid}px`, backgroundPosition: `${this.ox}px ${this.oy}px` });
    this.gridEl.classList.toggle('hidden', !this.showGrid);
    this.renderReach();
    this.renderFog();
    this.applyView();
  }

  fit() {
    const r = this.root.getBoundingClientRect();
    if (!r.width) return;
    const f = this.frame();
    const z = Math.min(r.width / f.w, r.height / f.h) * 0.95;
    this.view = { z, x: (r.width - f.w * z) / 2, y: (r.height - f.h * z) / 2 };
    this.needsFit = false;
    this.applyView();
  }

  applyView() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  }

  /** Pantalla → píxeles del mapa (teniendo en cuenta el recorte). */
  toWorld(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    const f = this.frame();
    return { x: (clientX - r.left - this.view.x) / this.view.z + f.x, y: (clientY - r.top - this.view.y) / this.view.z + f.y };
  }

  /** Centro visible del tablero en coordenadas del mapa (para colocar fichas nuevas). */
  center() {
    const r = this.root.getBoundingClientRect();
    const p = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return this.snapToMap(p.x - this.grid / 2, p.y - this.grid / 2);
  }

  /** Ajusta a la casilla más cercana respetando el desfase de la cuadrícula calibrada. */
  snap(x, y) {
    const g = this.grid;
    const r2 = (v) => Math.round(v * 100) / 100;
    return { x: r2(this.ox + Math.round((x - this.ox) / g) * g), y: r2(this.oy + Math.round((y - this.oy) / g) * g) };
  }

  // ---------- alcance de movimiento (combate) ----------
  /** @param {{ tokenId:string, anchor:{x:number,y:number}, remaining:number, clamp:boolean } | null} reach */
  setReach(reach) {
    this.reach = reach;
    this.renderReach();
    for (const [id, el] of this.els) el.classList.toggle('acting', reach?.tokenId === id);
  }

  renderReach() {
    const r = this.reach;
    const t = r && this.tokens.find((x) => x.id === r.tokenId);
    this.reachEl.classList.toggle('hidden', !t || !r.anchor);
    if (!t || !r.anchor) return;
    const g = this.grid;
    const side = (2 * r.remaining + t.size) * g;
    Object.assign(this.reachEl.style, {
      width: `${side}px`, height: `${side}px`,
      transform: `translate(${r.anchor.x - r.remaining * g}px, ${r.anchor.y - r.remaining * g}px)`,
    });
  }

  /** Mantiene el arrastre dentro del alcance (cada diagonal cuenta una casilla). */
  clampToReach(token, x, y) {
    const r = this.reach;
    if (!r || !r.clamp || r.tokenId !== token.id || !r.anchor) return { x, y };
    const span = r.remaining * this.grid;
    const lim = (v, a) => Math.min(a + span, Math.max(a - span, v));
    return { x: lim(x, r.anchor.x), y: lim(y, r.anchor.y) };
  }

  // ---------- niebla de guerra ----------
  /**
   * @param {{ on:boolean, revealed:string[], explored:string[] } | null} fog
   * @param {{ dm:boolean, playerIds:string[] }} who
   */
  setFog(fog, { dm, playerIds }) {
    this.fog = fog?.on ? { revealed: new Set(fog.revealed), explored: new Set(fog.explored), dm, playerIds } : null;
    this.renderFog();
  }

  /** Pincel del DM: { mode: 'reveal'|'cover', size: casillas de lado } o null para mover/seleccionar. */
  setFogBrush(brush) {
    this.fogBrush = brush;
    this.root.classList.toggle('fog-painting', Boolean(brush));
  }

  cellOf(x, y) {
    return [Math.floor((x - this.ox) / this.grid), Math.floor((y - this.oy) / this.grid)];
  }

  /** Casillas que ven ahora las fichas de los jugadores (mismo cálculo que el servidor). */
  visibleCells() {
    const set = new Set(this.fog.revealed);
    const g = this.grid;
    for (const t of this.tokens) {
      if (t.hidden || !t.ownerId || !this.fog.playerIds.includes(t.ownerId)) continue;
      const ch = t.characterId && this.characters.find((c) => c.id === t.characterId);
      const vision = typeof ch?.vision === 'number' ? ch.vision : DEFAULT_VISION;
      const pos = this.livePos?.id === t.id ? this.livePos : t;
      const cx = pos.x + (t.size * g) / 2;
      const cy = pos.y + (t.size * g) / 2;
      const reach = (vision + t.size / 2) * g;
      const [x0, y0] = this.cellOf(cx - reach, cy - reach);
      const [x1, y1] = this.cellOf(cx + reach, cy + reach);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (Math.hypot(this.ox + (x + 0.5) * g - cx, this.oy + (y + 0.5) * g - cy) <= reach) set.add(`${x},${y}`);
        }
      }
    }
    return set;
  }

  /** Una casilla = un píxel del lienzo; el navegador lo estira con suavizado y los bordes quedan difusos. */
  renderFog() {
    this.fogEl.classList.toggle('hidden', !this.fog);
    if (!this.fog) return;
    const [w, hgt] = this.mapSize;
    const g = this.grid;
    const [cx0, cy0] = this.cellOf(0, 0);
    const [cx1, cy1] = this.cellOf(w - 1, hgt - 1);
    const cols = cx1 - cx0 + 1;
    const rows = cy1 - cy0 + 1;
    if (this.fogEl.width !== cols) this.fogEl.width = cols;
    if (this.fogEl.height !== rows) this.fogEl.height = rows;
    Object.assign(this.fogEl.style, { left: `${this.ox + cx0 * g}px`, top: `${this.oy + cy0 * g}px`, width: `${cols * g}px`, height: `${rows * g}px` });
    const alpha = FOG_ALPHA[this.fog.dm ? 'dm' : 'player'];
    const visible = this.visibleCells();
    const ctx2d = this.fogEl.getContext('2d');
    const img = ctx2d.createImageData(cols, rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = `${x + cx0},${y + cy0}`;
        const a = visible.has(k) ? 0 : this.fog.explored.has(k) ? alpha.explored : alpha.dark;
        const i = (y * cols + x) * 4;
        img.data[i] = FOG_RGB[0];
        img.data[i + 1] = FOG_RGB[1];
        img.data[i + 2] = FOG_RGB[2];
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx2d.putImageData(img, 0, 0);
  }

  /** Casillas bajo el pincel (cuadrado de `size` de lado centrado en el puntero). */
  brushCells(p) {
    const [cx, cy] = this.cellOf(p.x, p.y);
    const r = Math.floor((this.fogBrush.size - 1) / 2);
    const out = [];
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) out.push(`${x},${y}`);
    return out;
  }

  /** Aplica el pincel en local para que se vea al instante; el servidor confirma al soltar. */
  paintAt(p, cells) {
    for (const k of this.brushCells(p)) {
      cells.add(k);
      if (!this.fog) continue;
      if (this.fogBrush.mode === 'reveal') this.fog.revealed.add(k);
      else { this.fog.revealed.delete(k); this.fog.explored.delete(k); }
    }
    this.renderFog();
  }

  // ---------- límites del mapa ----------
  /** La ficha entra entera en el mapa visible (el tablero recorta lo que queda fuera). */
  isOnMap(t) {
    const f = this.frame();
    const px = t.size * this.grid;
    return t.x >= f.x && t.y >= f.y && t.x + px <= f.x + f.w && t.y + px <= f.y + f.h;
  }

  /** Fichas que quedaron fuera del mapa (cambio de mapa, recorte o arrastre) y por eso no se ven. */
  lostTokens(tokens = this.tokens) {
    if (!this.mapReady) return [];
    return tokens.filter((t) => !this.isOnMap(t));
  }

  /** Mantiene una ficha de `size` casillas dentro del mapa visible. */
  clampToMap(x, y, size = 1) {
    const f = this.frame();
    const px = size * this.grid;
    const lim = (v, a, len) => Math.max(a, Math.min(a + Math.max(0, len - px), v));
    return { x: lim(x, f.x, f.w), y: lim(y, f.y, f.h) };
  }

  /** Casilla más cercana sin salirse del mapa: si el redondeo la saca por un borde, retrocede una casilla. */
  snapToMap(x, y, size = 1) {
    const c = this.clampToMap(x, y, size);
    const s = this.snap(c.x, c.y);
    const f = this.frame();
    const px = size * this.grid;
    const back = (v, a, len) => (v + px > a + len ? v - this.grid : v < a ? v + this.grid : v);
    return { x: back(s.x, f.x, f.w), y: back(s.y, f.y, f.h) };
  }

  // ---------- fichas ----------
  setTokens(tokens, characters = this.characters) {
    this.tokens = tokens;
    this.characters = characters;
    this.renderTokens();
  }

  renderTokens() {
    const alive = new Set();
    for (const t of this.tokens) {
      alive.add(t.id);
      let el = this.els.get(t.id);
      if (!el) {
        el = h('div.token', { 'data-id': t.id },
          h('img', { draggable: 'false', alt: '' }),
          h('div.token-hp', h('i')),
          h('div.token-name'),
          h('div.token-cond'));
        this.tokenLayer.append(el);
        this.els.set(t.id, el);
      }
      const ch = t.characterId && this.characters.find((c) => c.id === t.characterId);
      const hp = ch ? ch.hp : t.hp;
      const maxHp = ch ? ch.maxHp : t.maxHp;
      const px = t.size * this.grid;
      const img = el.querySelector('img');
      if (img.getAttribute('src') !== t.img) img.src = t.img;
      // Objeto: imagen cuadrada (se puede girar), sin barra de PG, por debajo de las criaturas.
      const isObject = t.kind === 'objeto';
      el.classList.toggle('object-token', isObject);
      img.style.transform = isObject && t.object?.rot ? `rotate(${t.object.rot}deg)` : '';
      el.querySelector('.token-name').textContent = ch ? ch.name : t.name;
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      const bar = el.querySelector('.token-hp i');
      bar.style.width = `${pct * 100}%`;
      bar.className = pct > 0.5 ? 'ok' : pct > 0.25 ? 'mid' : 'low';
      clear(el.querySelector('.token-cond'), (t.conditions || []).slice(0, 4).map((c) => h('span', c)));
      if (!el.classList.contains('dragging')) {
        Object.assign(el.style, { width: `${px}px`, height: `${px}px`, fontSize: `${tokenFontPx(px)}px`, transform: `translate(${t.x}px, ${t.y}px)` });
      }
      el.classList.toggle('hidden-token', Boolean(t.hidden));
      el.classList.toggle('down', hp <= 0);
      el.classList.toggle('selected', this.selected === t.id);
      el.classList.toggle('mine', this.hooks.canMove(t));
      el.classList.toggle('acting', this.reach?.tokenId === t.id);
    }
    for (const [id, el] of this.els) {
      if (!alive.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    if (this.selected && !alive.has(this.selected)) this.select(null);
    this.renderReach();
    this.renderFog();
  }

  moveToken(id, x, y) {
    this.tokens = this.tokens.map((t) => (t.id === id ? { ...t, x, y } : t));
    const el = this.els.get(id);
    if (el && !el.classList.contains('dragging')) el.style.transform = `translate(${x}px, ${y}px)`;
    if (this.fog) this.renderFog();
  }

  select(id) {
    this.selected = id;
    for (const [tid, el] of this.els) el.classList.toggle('selected', tid === id);
    this.hooks.onSelect(this.tokens.find((t) => t.id === id) || null);
  }

  focusToken(id) {
    const t = this.tokens.find((x) => x.id === id);
    if (!t) return;
    const r = this.root.getBoundingClientRect();
    const f = this.frame();
    const c = (t.size * this.grid) / 2;
    this.view = { ...this.view, x: r.width / 2 - (t.x - f.x + c) * this.view.z, y: r.height / 2 - (t.y - f.y + c) * this.view.z };
    this.applyView();
  }

  ping(x, y, name) {
    const p = h('div.ping', { style: { left: `${x}px`, top: `${y}px` } }, h('span', name));
    this.fx.append(p);
    setTimeout(() => p.remove(), 2200);
  }

  // ---------- ratón / táctil ----------
  bindPointer() {
    let drag = null;

    this.root.addEventListener('pointerdown', (e) => {
      const tokenEl = e.target.closest('.token');
      const token = tokenEl && this.tokens.find((t) => t.id === tokenEl.dataset.id);
      this.root.setPointerCapture(e.pointerId);
      if (this.fogBrush && e.button === 0) {
        drag = { kind: 'paint', cells: new Set() };
        this.paintAt(this.toWorld(e.clientX, e.clientY), drag.cells);
      } else if (token && e.button === 0) {
        this.select(token.id);
        if (!this.hooks.canMove(token)) return;
        const p = this.toWorld(e.clientX, e.clientY);
        drag = { kind: 'token', token, el: tokenEl, dx: p.x - token.x, dy: p.y - token.y, last: 0, moved: false };
        tokenEl.classList.add('dragging');
      } else {
        if (!token && e.button === 0) this.select(null);
        drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
        this.root.classList.add('panning');
      }
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'paint') {
        this.paintAt(this.toWorld(e.clientX, e.clientY), drag.cells);
        return;
      }
      if (drag.kind === 'pan') {
        this.view = { ...this.view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
        this.applyView();
        return;
      }
      const p = this.toWorld(e.clientX, e.clientY);
      const r = this.clampToReach(drag.token, p.x - drag.dx, p.y - drag.dy);
      const c = this.clampToMap(r.x, r.y, drag.token.size);
      drag.x = c.x;
      drag.y = c.y;
      drag.moved = true;
      drag.el.style.transform = `translate(${drag.x}px, ${drag.y}px)`;
      const now = performance.now();
      if (now - drag.last > LIVE_MOVE_MS) {
        drag.last = now;
        // La visión acompaña a la ficha mientras se arrastra.
        if (this.fog) {
          this.livePos = { id: drag.token.id, x: drag.x, y: drag.y };
          this.renderFog();
        }
        this.hooks.onMove(drag.token.id, Math.round(drag.x), Math.round(drag.y), false);
      }
    });

    const end = () => {
      if (!drag) return;
      if (drag.kind === 'paint' && drag.cells.size) this.hooks.onFogPaint?.([...drag.cells], this.fogBrush?.mode || 'reveal');
      this.livePos = null;
      if (drag.kind === 'token') {
        drag.el.classList.remove('dragging');
        if (drag.moved) {
          const s = this.snapToMap(drag.x, drag.y, drag.token.size);
          drag.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
          this.moveToken(drag.token.id, s.x, s.y);
          this.hooks.onMove(drag.token.id, s.x, s.y, true);
        }
      }
      this.root.classList.remove('panning');
      drag = null;
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);

    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.root.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.z * Math.exp(-e.deltaY * 0.0015)));
      const k = z / this.view.z;
      this.view = { z, x: mx - (mx - this.view.x) * k, y: my - (my - this.view.y) * k };
      this.applyView();
    }, { passive: false });

    this.root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.token')) return;
      const p = this.toWorld(e.clientX, e.clientY);
      this.hooks.onPing(Math.round(p.x), Math.round(p.y));
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindDrop() {
    this.root.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-da')) {
        e.preventDefault();
        this.root.classList.add('drop-ok');
      }
    });
    this.root.addEventListener('dragleave', () => this.root.classList.remove('drop-ok'));
    this.root.addEventListener('drop', (e) => {
      this.root.classList.remove('drop-ok');
      const raw = e.dataTransfer.getData('application/x-da');
      if (!raw) return;
      e.preventDefault();
      const p = this.toWorld(e.clientX, e.clientY);
      const s = this.snapToMap(p.x - this.grid / 2, p.y - this.grid / 2);
      try {
        this.hooks.onDrop(JSON.parse(raw), s.x, s.y);
      } catch (err) {
        console.warn('[tablero] drop inválido', err);
      }
    });
  }
}
