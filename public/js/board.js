// Tablero: mapa, cuadrícula y fichas. Arrastrar fichas, mover cámara, zoom y "pings".
import { h, clear } from './ui.js';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const LIVE_MOVE_MS = 70;
const DEFAULT_MAP_SIZE = [1680, 1260];

export class Board {
  /**
   * @param {HTMLElement} container
   * @param {{ canMove:(t)=>boolean, onMove:(id,x,y,final)=>void, onSelect:(t|null)=>void,
   *           onPing:(x,y)=>void, onDrop:(data,x,y)=>void }} hooks
   */
  constructor(container, hooks) {
    this.hooks = hooks;
    this.view = { x: 0, y: 0, z: 1 };
    this.grid = 70;
    this.mapSize = DEFAULT_MAP_SIZE;
    this.tokens = [];
    this.characters = [];
    this.selected = null;
    this.els = new Map();

    this.map = h('img.board-map', { draggable: 'false', alt: '' });
    this.gridEl = h('div.board-grid');
    this.tokenLayer = h('div.board-tokens');
    this.fx = h('div.board-fx');
    this.world = h('div.board-world', this.map, this.gridEl, this.tokenLayer, this.fx);
    this.empty = h('div.board-empty', h('div', '🗺'), h('p', 'No hay mapa en esta escena.'));
    this.root = h('div.board', this.world, this.empty, h('div.board-help', 'Rueda: zoom · Arrastrar: mover · Doble clic: señalar'));
    container.append(this.root);

    this.map.addEventListener('load', () => {
      this.mapSize = [this.map.naturalWidth || DEFAULT_MAP_SIZE[0], this.map.naturalHeight || DEFAULT_MAP_SIZE[1]];
      this.layout();
      if (this.needsFit) this.fit();
    });
    this.bindPointer();
    this.bindDrop();
    new ResizeObserver(() => this.needsFit && this.fit()).observe(this.root);
  }

  // ---------- escena ----------
  setScene(scene, mapUrl) {
    this.grid = scene.gridSize || 70;
    this.showGrid = scene.showGrid;
    const changed = this.mapUrl !== mapUrl;
    this.mapUrl = mapUrl;
    this.empty.classList.toggle('hidden', Boolean(mapUrl));
    if (changed) {
      this.needsFit = true;
      if (mapUrl) this.map.src = mapUrl;
      else this.map.removeAttribute('src');
    }
    this.layout();
    this.renderTokens();
  }

  layout() {
    const [w, hgt] = this.mapSize;
    Object.assign(this.world.style, { width: `${w}px`, height: `${hgt}px` });
    this.gridEl.style.backgroundSize = `${this.grid}px ${this.grid}px`;
    this.gridEl.classList.toggle('hidden', !this.showGrid);
    this.applyView();
  }

  fit() {
    const r = this.root.getBoundingClientRect();
    if (!r.width) return;
    const [w, hgt] = this.mapSize;
    const z = Math.min(r.width / w, r.height / hgt) * 0.95;
    this.view = { z, x: (r.width - w * z) / 2, y: (r.height - hgt * z) / 2 };
    this.needsFit = false;
    this.applyView();
  }

  applyView() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  }

  toWorld(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.x) / this.view.z, y: (clientY - r.top - this.view.y) / this.view.z };
  }

  /** Centro visible del tablero en coordenadas del mapa (para colocar fichas nuevas). */
  center() {
    const r = this.root.getBoundingClientRect();
    const p = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return this.snap(p.x - this.grid / 2, p.y - this.grid / 2);
  }

  snap(x, y) {
    return { x: Math.round(x / this.grid) * this.grid, y: Math.round(y / this.grid) * this.grid };
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
      el.querySelector('.token-name').textContent = ch ? ch.name : t.name;
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      const bar = el.querySelector('.token-hp i');
      bar.style.width = `${pct * 100}%`;
      bar.className = pct > 0.5 ? 'ok' : pct > 0.25 ? 'mid' : 'low';
      clear(el.querySelector('.token-cond'), (t.conditions || []).slice(0, 4).map((c) => h('span', c)));
      if (!el.classList.contains('dragging')) {
        Object.assign(el.style, { width: `${px}px`, height: `${px}px`, transform: `translate(${t.x}px, ${t.y}px)` });
      }
      el.classList.toggle('hidden-token', Boolean(t.hidden));
      el.classList.toggle('down', hp <= 0);
      el.classList.toggle('selected', this.selected === t.id);
      el.classList.toggle('mine', this.hooks.canMove(t));
    }
    for (const [id, el] of this.els) {
      if (!alive.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    if (this.selected && !alive.has(this.selected)) this.select(null);
  }

  moveToken(id, x, y) {
    this.tokens = this.tokens.map((t) => (t.id === id ? { ...t, x, y } : t));
    const el = this.els.get(id);
    if (el && !el.classList.contains('dragging')) el.style.transform = `translate(${x}px, ${y}px)`;
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
    const c = (t.size * this.grid) / 2;
    this.view = { ...this.view, x: r.width / 2 - (t.x + c) * this.view.z, y: r.height / 2 - (t.y + c) * this.view.z };
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
      if (token && e.button === 0) {
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
      if (drag.kind === 'pan') {
        this.view = { ...this.view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy };
        this.applyView();
        return;
      }
      const p = this.toWorld(e.clientX, e.clientY);
      drag.x = p.x - drag.dx;
      drag.y = p.y - drag.dy;
      drag.moved = true;
      drag.el.style.transform = `translate(${drag.x}px, ${drag.y}px)`;
      const now = performance.now();
      if (now - drag.last > LIVE_MOVE_MS) {
        drag.last = now;
        this.hooks.onMove(drag.token.id, Math.round(drag.x), Math.round(drag.y), false);
      }
    });

    const end = () => {
      if (!drag) return;
      if (drag.kind === 'token') {
        drag.el.classList.remove('dragging');
        if (drag.moved) {
          const s = this.snap(drag.x, drag.y);
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
      const s = this.snap(p.x - this.grid / 2, p.y - this.grid / 2);
      try {
        this.hooks.onDrop(JSON.parse(raw), s.x, s.y);
      } catch (err) {
        console.warn('[tablero] drop inválido', err);
      }
    });
  }
}
