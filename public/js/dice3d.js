// Animación de dados 3D a pantalla completa. El resultado lo decide el servidor:
// aquí el dado rueda y "aterriza" mostrando la cara que salió.
import * as THREE from 'three';
import { h, clear } from './ui.js';

const ROLL_MS = 1900;
const HOLD_MS = 2600;
const HOLD_COMPACT_MS = 1700;
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- geometrías
function d10Geometry() {
  // Trapezoedro pentagonal: caras de cometa planas si h = z0 (1+cos36)/(1-cos36)
  const z0 = 0.1;
  const c36 = Math.cos(Math.PI / 5);
  const top = z0 * (1 + c36) / (1 - c36);
  const ring = Array.from({ length: 10 }, (_, k) => {
    const a = (k * Math.PI) / 5;
    return new THREE.Vector3(Math.cos(a), Math.sin(a), k % 2 ? -z0 : z0);
  });
  const T = new THREE.Vector3(0, 0, top);
  const B = new THREE.Vector3(0, 0, -top);
  const tris = [];
  for (let j = 0; j < 5; j++) {
    const a = ring[2 * j], b = ring[(2 * j + 1) % 10], c = ring[(2 * j + 2) % 10];
    tris.push([T, a, b], [T, b, c]);
    const d = ring[(2 * j + 1) % 10], e = ring[(2 * j + 2) % 10], f = ring[(2 * j + 3) % 10];
    tris.push([B, e, d], [B, f, e]);
  }
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((tri, i) => tri.forEach((v, k) => v.toArray(pos, i * 9 + k * 3)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.scale(1.05, 1.05, 1.05);
  g.computeVertexNormals();
  return g;
}

const GEOMETRY = {
  4: () => new THREE.TetrahedronGeometry(1.15),
  6: () => new THREE.BoxGeometry(1.35, 1.35, 1.35),
  8: () => new THREE.OctahedronGeometry(1.1),
  10: d10Geometry,
  12: () => new THREE.DodecahedronGeometry(1.1),
  20: () => new THREE.IcosahedronGeometry(1.15),
};

/** Agrupa triángulos coplanares en caras: normal, centro y tamaño útil para el número. */
function extractFaces(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position;
  const faces = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    let face = faces.find((f) => f.normal.dot(n) > 0.999);
    if (!face) faces.push((face = { normal: n, verts: [] }));
    face.verts.push(a.clone(), b.clone(), c.clone());
  }
  return faces.map((f) => {
    const uniq = f.verts.filter((v, i) => f.verts.findIndex((w) => w.distanceTo(v) < 1e-4) === i);
    const center = uniq.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(uniq.length);
    const radius = Math.min(...uniq.map((v) => v.distanceTo(center)));
    let up = UP.clone().sub(f.normal.clone().multiplyScalar(UP.dot(f.normal)));
    if (up.lengthSq() < 1e-3) up = new THREE.Vector3(0, 0, -1).sub(f.normal.clone().multiplyScalar(-f.normal.z));
    up.normalize();
    const right = new THREE.Vector3().crossVectors(up, f.normal);
    const basis = new THREE.Matrix4().makeBasis(right, up, f.normal);
    return { normal: f.normal, center, radius, quat: new THREE.Quaternion().setFromRotationMatrix(basis) };
  });
}

// ---------------------------------------------------------------- texturas de números
const labelCache = new Map();
function labelTexture(text, color) {
  const key = `${text}|${color}`;
  if (labelCache.has(key)) return labelCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${text.length > 2 ? 46 : text.length > 1 ? 62 : 76}px Cinzel, Georgia, serif`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(text, 64, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 68);
  if (text === '6' || text === '9') ctx.fillRect(44, 106, 40, 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(key, tex);
  return tex;
}

function faceLabels(sides, variant) {
  if (variant === 'tens') return Array.from({ length: 10 }, (_, i) => String(i * 10).padStart(2, '0'));
  if (variant === 'units') return Array.from({ length: 10 }, (_, i) => String(i));
  if (sides === 2) return ['1', '2', '1', '2', '1', '2'];
  return Array.from({ length: sides }, (_, i) => String(i + 1));
}

const THEMES = [
  { body: 0x2a1450, edge: 0xe8c66a, text: '#f6dc8a' },
  { body: 0x5a1020, edge: 0xf0c27a, text: '#ffe2a8' },
  { body: 0x0f3a3a, edge: 0x9ff0d8, text: '#d8fff2' },
  { body: 0x1b2a55, edge: 0xb9c8ff, text: '#e6ecff' },
  { body: 0x3a2a12, edge: 0xffd36b, text: '#ffe7a0' },
];

function buildDie(sides, value, theme, variant) {
  const geoSides = sides === 2 ? 6 : sides === 100 ? 10 : sides;
  const geometry = GEOMETRY[geoSides]();
  const faces = extractFaces(geometry);
  const labels = faceLabels(sides, variant);
  const group = new THREE.Group();
  const body = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
    color: theme.body, roughness: 0.28, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.2,
    flatShading: true, transparent: true,
  }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 10),
    new THREE.LineBasicMaterial({ color: theme.edge, transparent: true }),
  );
  group.add(body, edges);

  faces.forEach((f, i) => {
    const size = f.radius * (geoSides === 4 ? 1.15 : geoSides === 6 ? 1.1 : 1.35);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: labelTexture(labels[i % labels.length], theme.text), transparent: true, depthWrite: false }),
    );
    plane.position.copy(f.center).add(f.normal.clone().multiplyScalar(0.012));
    plane.quaternion.copy(f.quat);
    group.add(plane);
  });

  // Cara a mostrar: la que tiene el número que decidió el servidor.
  const wanted = String(value);
  const idx = Math.max(0, labels.findIndex((l) => l === wanted));
  const target = faces[idx % faces.length].quat.clone().invert();
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, -0.12, 0));
  group.userData = { target: tilt.multiply(target), materials: [body.material, edges.material] };
  return group;
}

// ---------------------------------------------------------------- overlay
function easeOutBounce(x) {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Convierte el resultado del servidor en dados individuales a dibujar. */
function diceFromResult(result) {
  const out = [];
  for (const g of result.groups) {
    g.values.forEach((v, i) => {
      if (g.sides === 100) {
        const units = v % 10;
        const tens = (v - units) % 100;
        out.push({ sides: 100, value: String(tens).padStart(2, '0'), variant: 'tens', kept: g.kept[i] });
        out.push({ sides: 100, value: String(units), variant: 'units', kept: g.kept[i] });
      } else {
        out.push({ sides: g.sides, value: v, kept: g.kept[i] });
      }
    });
  }
  return out.slice(0, 12);
}

export class DiceOverlay {
  constructor() {
    this.queue = [];
    this.busy = false;
    this.root = h('div.dice-overlay.hidden', { onclick: () => this.skip?.() });
    this.canvasBox = h('div.dice-canvas');
    this.top = h('div.dice-top');
    this.bottom = h('div.dice-bottom');
    this.root.append(this.top, this.canvasBox, this.bottom);
    document.body.append(this.root);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.canvasBox.append(this.renderer.domElement);
    } catch (err) {
      console.warn('[dados] WebGL no disponible, se muestran solo números', err);
      this.renderer = null;
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0, 11);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.4);
    key.position.set(3, 5, 8);
    const rim = new THREE.PointLight(0xb48cff, 40, 30);
    rim.position.set(-5, -2, 4);
    const warm = new THREE.PointLight(0xffb347, 30, 30);
    warm.position.set(5, -3, 5);
    this.scene.add(key, rim, warm);
  }

  /** @param {object} entry Entrada del log de tipo 'roll' @param {{compact?: boolean}} opts */
  show(entry, opts = {}) {
    this.queue.push({ entry, opts });
    if (this.queue.length > 4) this.queue = this.queue.filter((q, i) => !q.opts.compact || i >= this.queue.length - 2);
    if (!this.busy) this.next();
  }

  async next() {
    const item = this.queue.shift();
    if (!item) {
      this.busy = false;
      this.root.classList.add('hidden');
      return;
    }
    this.busy = true;
    await this.play(item.entry, item.opts);
    this.next();
  }

  play(entry, { compact = false } = {}) {
    return new Promise((resolve) => {
      const { result, dc, label, name, mode, natural, success } = entry;
      const dice = diceFromResult(result);
      this.root.classList.toggle('compact', compact);
      this.root.classList.remove('hidden', 'landed', 'crit', 'fumble', 'success', 'fail');
      clear(this.top,
        h('div.dice-who', name, entry.hidden ? ' · tirada oculta' : ''),
        h('div.dice-label', label || `Tirada ${result.expr}`),
        mode ? h('div.dice-mode', mode === 'adv' ? 'Ventaja' : 'Desventaja') : null,
        dc ? h('div.dice-dc', h('small', 'CD'), h('b', dc)) : null);
      clear(this.bottom);

      const size = compact ? [360, 240] : [Math.min(window.innerWidth, 1100), Math.min(window.innerHeight * 0.55, 520)];
      const theme = THEMES[[...String(entry.userId || name)].reduce((s, ch) => s + ch.charCodeAt(0), 0) % THEMES.length];

      const meshes = dice.map((d, i) => {
        const m = buildDie(d.sides, d.value, theme, d.variant);
        const cols = Math.min(dice.length, 6);
        const row = Math.floor(i / 6);
        const spacing = dice.length > 3 ? 2.5 : 3;
        m.userData.rest = new THREE.Vector3((i % 6 - (cols - 1) / 2) * spacing, dice.length > 6 ? 1.4 - row * 2.8 : 0, 0);
        m.userData.start = new THREE.Vector3((Math.random() - 0.5) * 10, 7 + Math.random() * 2, -2);
        m.userData.spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        m.userData.spin = 14 + Math.random() * 10;
        m.userData.delay = i * 90;
        m.userData.kept = d.kept;
        m.quaternion.random();
        m.userData.startQ = m.quaternion.clone();
        this.scene.add(m);
        return m;
      });

      if (this.renderer) {
        this.renderer.setSize(size[0], size[1]);
        this.camera.aspect = size[0] / size[1];
        const spread = Math.min(dice.length, 6) * 2.6 + 2;
        this.camera.position.z = Math.max(dice.length === 1 ? 6.5 : 9, spread * 1.25);
        this.camera.updateProjectionMatrix();
      }

      const t0 = performance.now();
      let landed = false;
      let done = false;
      let holdTimer = null;
      const tmpQ = new THREE.Quaternion();

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(holdTimer);
        meshes.forEach((m) => this.scene.remove(m));
        this.skip = null;
        resolve();
      };

      const land = () => {
        landed = true;
        meshes.forEach((m) => {
          if (!m.userData.kept) m.userData.materials.forEach((mat) => { mat.opacity = 0.28; });
        });
        this.root.classList.add('landed');
        if (natural === 20) this.root.classList.add('crit');
        else if (natural === 1) this.root.classList.add('fumble');
        if (success === true) this.root.classList.add('success');
        if (success === false) this.root.classList.add('fail');
        const parts = result.groups.flatMap((g) => g.values.filter((_, i) => g.kept[i]).map((v) => (g.sign < 0 ? -v : v)));
        const breakdown = [...parts.map(String), result.modifier ? String(result.modifier) : null].filter(Boolean)
          .join(' + ').replace(/\+ -/g, '− ');
        clear(this.bottom,
          h('div.dice-total', result.total),
          parts.length > 1 || result.modifier ? h('div.dice-breakdown', breakdown) : null,
          h('div.dice-verdict', verdictText(natural, success, dc)),
          h('div.dice-hint', 'clic para cerrar'));
        holdTimer = setTimeout(finish, compact ? HOLD_COMPACT_MS : HOLD_MS);
      };
      this.skip = () => (landed ? finish() : null);

      const frame = (now) => {
        if (done) return;
        let allLanded = true;
        for (const m of meshes) {
          const u = m.userData;
          const t = Math.min(1, Math.max(0, (now - t0 - u.delay) / ROLL_MS));
          if (t < 1) allLanded = false;
          const drop = easeOutBounce(Math.min(1, t / 0.7));
          m.position.lerpVectors(u.start, u.rest, drop);
          const angle = u.spin * (1 - (1 - t) ** 3);
          tmpQ.setFromAxisAngle(u.spinAxis, angle);
          m.quaternion.copy(u.startQ).premultiply(tmpQ);
          m.quaternion.slerp(u.target, smooth(0.45, 1, t));
          const s = 0.7 + 0.3 * Math.min(1, t * 2) + (t > 0.98 && !landed ? 0.06 : 0);
          m.scale.setScalar(s);
        }
        this.renderer?.render(this.scene, this.camera);
        if (allLanded && !landed) land();
        requestAnimationFrame(frame);
      };
      if (this.renderer) requestAnimationFrame(frame);
      else land();
    });
  }
}

function verdictText(natural, success, dc) {
  if (natural === 20) return '¡CRÍTICO!';
  if (natural === 1) return 'PIFIA';
  if (dc) return success ? 'ÉXITO' : 'FALLO';
  return '';
}
