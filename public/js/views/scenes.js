// Escenas del DM: lista (quién está en cada una), asistente para preparar una escena nueva
// y lanzarla a todos o solo a algunos jugadores (escenas paralelas).
import { h, clear, field, toast, modal, confirmDialog } from '../ui.js';
import { api } from '../api.js';
import { gridCalibrator } from '../gridcal.js';
import { DEMO_PORTRAITS } from '../sheet.js';
import { BESTIARY, DEMO_MAPS } from './table-panels.js';

const DEFAULT_GRID = { size: 70, ox: 0, oy: 0, show: true };
const DEFAULT_MAP_SIZE = { w: 1680, h: 1260 };
const MAX_PER_MONSTER = 12;
const STEPS = ['Escena', 'Cuadrícula', 'Fichas', 'Listo'];
// Tamaño recomendado de mapa: 70 px por casilla (la cuadrícula por defecto). Fuera de este rango el
// tablero se ve borroso (mapa pequeño con casillas diminutas) o pesa demasiado para los móviles.
const MAP_PX_PER_SQUARE = 70;
const MAP_SIDE_MIN = 1000;
const MAP_SIDE_MAX = 6000;
const MAP_SIZE_HINT = `Recomendado: ${MAP_PX_PER_SQUARE} px por casilla (p. ej. 2100×1400 para 30×20 casillas)`;

/** Lado mayor de la imagen elegida, o null si no se puede leer. */
async function longestSide(file) {
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.max(bmp.width, bmp.height);
    bmp.close();
    return side;
  } catch {
    return null;
  }
}

function uploadMapFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const side = await longestSide(file);
      if (side && side < MAP_SIDE_MIN) toast(`Mapa pequeño (${side} px de lado): se verá borroso. ${MAP_SIZE_HINT}`, 'info');
      if (side && side > MAP_SIDE_MAX) toast(`Mapa muy grande (${side} px de lado): puede ir lento en móviles. ${MAP_SIZE_HINT}`, 'info');
      try {
        toast(`Subiendo mapa (${(file.size / 1048576).toFixed(1)} MB)…`);
        const form = new FormData();
        form.append('image', file);
        const { url } = await api.post('/upload/map', form);
        resolve({ url, name: file.name.replace(/\.[^.]+$/, '').slice(0, 50) });
      } catch (err) {
        toast(err.message, 'error');
        resolve(null);
      }
    });
    input.click();
  });
}

/** Añade un mapa a la lista si no está ya (el aviso del servidor puede llegar antes que la respuesta). */
const withMap = (maps, map) => (maps.some((m) => m.id === map.id) ? maps : [...maps, map]);

/** Coloca las fichas iniciales en filas dentro de la zona visible, ya en casilla. */
function layoutTokens(list, frame, grid, fromBottom) {
  const g = grid.size;
  const cols = Math.max(1, Math.floor(frame.w / g) - 4);
  const row0 = fromBottom ? Math.floor((frame.y + frame.h - grid.oy) / g) - 3 : Math.ceil((frame.y - grid.oy) / g) + 2;
  const col0 = Math.ceil((frame.x - grid.ox) / g) + 2;
  return list.map((t, i) => ({
    ...t,
    x: grid.ox + (col0 + (i % cols)) * g,
    y: grid.oy + (row0 + (fromBottom ? -1 : 1) * Math.floor(i / cols)) * g,
  }));
}

/**
 * Asistente para preparar (o editar) una escena. Nada se ve en las pantallas de los
 * jugadores hasta que el DM la lanza.
 */
export function openSceneWizard(ctx, editing = null) {
  const { s } = ctx;
  const draft = {
    name: editing?.name || `Escena ${s.scenes.length + 1}`,
    mapId: editing ? editing.mapId : null,
    grid: { ...(editing?.grid || DEFAULT_GRID) },
    crop: editing?.crop || null,
    moveSquares: editing?.moveSquares || 5,
    pcs: new Set(s.characters.map((c) => c.id)),
    monsters: {},
    hideMonsters: true,
    copyCurrent: false,
    natural: null,
  };
  const steps = editing ? STEPS.filter((x) => x !== 'Fichas') : STEPS;
  let step = 0;
  let calibrator = null;

  const stepBar = h('div.wiz-steps');
  const body = h('div.wiz-body');
  const foot = h('div.wiz-foot');
  const dlg = modal(editing ? `Editar escena · ${editing.name}` : 'Preparar escena', h('div.wizard', stepBar, body, foot), { wide: true });
  dlg.el.querySelector('.modal').classList.add('xwide');

  const mapOf = (id) => s.maps.find((m) => m.id === id) || null;

  const keepCalibration = () => {
    if (!calibrator) return;
    const v = calibrator.value();
    draft.grid = v.grid;
    draft.crop = v.crop;
    draft.natural = calibrator.natural() || draft.natural;
  };

  function go(i) {
    keepCalibration();
    step = Math.max(0, Math.min(steps.length - 1, i));
    render();
  }

  // ---------- pasos ----------
  function stepScene() {
    const name = h('input', { value: draft.name, maxlength: 50, required: true, oninput: (e) => { draft.name = e.target.value; } });
    const pick = (id) => {
      if (id !== draft.mapId) Object.assign(draft, { mapId: id, crop: null, natural: null });
      render();
    };
    const missingDemos = DEMO_MAPS.filter((d) => !s.maps.some((m) => m.url === d.url));
    return h('div.col',
      field('Nombre de la escena', name),
      h('div.label-mini', 'Mapa'),
      h('div.map-pick',
        h(`button.map-card${draft.mapId === null ? '.on' : ''}`, { type: 'button', onclick: () => pick(null) }, h('div.map-card-img.none', '∅'), h('span', 'Sin mapa')),
        s.maps.map((m) => h(`button.map-card${m.id === draft.mapId ? '.on' : ''}`, { type: 'button', onclick: () => pick(m.id) },
          h('div.map-card-img', { style: { backgroundImage: `url("${m.url}")` } }), h('span', m.name))),
        h('button.map-card.add', {
          type: 'button',
          onclick: async () => {
            const up = await uploadMapFile();
            if (!up) return;
            const res = await ctx.emit('map:add', { name: up.name || 'Mapa', url: up.url });
            // El servidor ya avisa a todos con la lista nueva: solo se añade si aún no llegó.
            if (res?.id) { s.maps = withMap(s.maps, { id: res.id, name: up.name, url: up.url }); pick(res.id); }
          },
        }, h('div.map-card-img.none', '⬆'), h('span', 'Subir mapa'), h('small', 'hasta 40 MB'))),
      h('p.tiny.muted', `${MAP_SIZE_HINT}, entre ${MAP_SIDE_MIN} y ${MAP_SIDE_MAX} px de lado.`),
      missingDemos.length ? h('button.btn.small.ghost', {
        type: 'button',
        onclick: async () => {
          for (const d of missingDemos) {
            const res = await ctx.emit('map:add', d);
            if (res?.id) s.maps = withMap(s.maps, { id: res.id, ...d });
          }
          render();
        },
      }, '✦ Añadir mapas de ejemplo') : null,
      h('p.tiny.muted', 'Un mapa grande puede servir para varias escenas: en el paso siguiente recortas la zona de cada una.'));
  }

  function stepGrid() {
    const map = mapOf(draft.mapId);
    calibrator = null;
    const moves = h('input.mod-input', { type: 'number', min: 1, max: 40, value: draft.moveSquares, oninput: (e) => { draft.moveSquares = Number(e.target.value) || 5; } });
    const turnRow = h('div.row', h('span', 'En combate, cada ficha se mueve hasta'), moves, h('span', 'casillas por turno'));
    if (!map) {
      const size = h('input.mod-input', { type: 'number', min: 10, max: 400, value: draft.grid.size, oninput: (e) => { draft.grid = { ...draft.grid, size: Number(e.target.value) || 70 }; } });
      return h('div.col', h('p.muted', 'Escena sin mapa: solo se usa la cuadrícula.'), h('div.row', h('span', 'Casilla de'), size, h('span', 'px')), turnRow);
    }
    calibrator = gridCalibrator({ url: map.url, grid: draft.grid, crop: draft.crop });
    return h('div.col', calibrator.el, turnRow);
  }

  function stepTokens() {
    const counter = (b) => {
      const n = draft.monsters[b.name] || 0;
      const set = (v) => { draft.monsters = { ...draft.monsters, [b.name]: Math.max(0, Math.min(MAX_PER_MONSTER, v)) }; render(); };
      return h(`div.lib-item.count${n ? '.on' : ''}`,
        h('img', { src: b.img, alt: '' }), h('span', b.name), h('small', `${b.hp} PG`),
        h('div.row.center', h('button.icon-btn.small', { type: 'button', onclick: () => set(n - 1) }, '−'), h('b', n), h('button.icon-btn.small', { type: 'button', onclick: () => set(n + 1) }, '+')));
    };
    const creatures = s.tokens.filter((t) => !t.characterId).length;
    return h('div.col',
      h('div.label-mini', 'Personajes que empiezan en la escena'),
      s.characters.length ? h('div.token-lib', s.characters.map((ch) => h(`div.lib-item.pick${draft.pcs.has(ch.id) ? '.on' : ''}`, {
        onclick: () => { if (draft.pcs.has(ch.id)) draft.pcs.delete(ch.id); else draft.pcs.add(ch.id); render(); },
      }, h('img', { src: ch.portrait || DEMO_PORTRAITS[0], alt: '' }), h('span', ch.name), h('small', draft.pcs.has(ch.id) ? '✓ entra' : 'no entra')))) : h('p.tiny.muted', 'Aún no hay personajes en la campaña.'),
      h('div.label-mini', 'Criaturas'),
      h('div.token-lib', BESTIARY.map(counter)),
      h('label.check', h('input', { type: 'checkbox', checked: draft.hideMonsters, onchange: (e) => { draft.hideMonsters = e.target.checked; } }), h('span', 'Criaturas ocultas al empezar (las revelas cuando aparezcan)')),
      creatures ? h('label.check', h('input', { type: 'checkbox', checked: draft.copyCurrent, onchange: (e) => { draft.copyCurrent = e.target.checked; } }),
        h('span', `Copiar también las ${creatures} criaturas de «${s.scene.name}»`)) : null,
      h('p.tiny.muted', 'Las fichas aparecen en filas; las colocas a tu gusto en el tablero antes de lanzar la escena.'));
  }

  function stepDone() {
    const map = mapOf(draft.mapId);
    const monsters = Object.values(draft.monsters).reduce((a, b) => a + b, 0);
    return h('div.col',
      h('div.wiz-summary',
        map ? h('div.map-card-img.big', { style: { backgroundImage: `url("${map.url}")` } }) : h('div.map-card-img.big.none', '∅'),
        h('div.col',
          h('h3', draft.name || 'Escena'),
          h('div.muted', map ? map.name : 'Sin mapa', draft.crop ? ' · zona recortada' : ''),
          h('div.muted', `Casilla ${draft.grid.size}px · ${draft.moveSquares} casillas por turno`),
          editing ? null : h('div.muted', `${draft.pcs.size} personajes · ${monsters} criaturas${draft.copyCurrent ? ' + las copiadas' : ''}`))),
      h('p', editing
        ? 'Los cambios se aplican al momento a quien esté en esta escena.'
        : 'La escena se crea en preparación: tu tablero pasa a ella y los jugadores siguen viendo la actual hasta que pulses «Lanzar».'));
  }

  // ---------- acabar ----------
  function frameFor() {
    const nat = draft.natural || DEFAULT_MAP_SIZE;
    return draft.crop || { x: 0, y: 0, w: nat.w, h: nat.h };
  }

  /** Criaturas de la escena que el DM tiene abierta (no personajes), para reutilizarlas. */
  function copiedFromCurrent() {
    if (!draft.copyCurrent) return [];
    return s.tokens.filter((t) => !t.characterId)
      .map((t) => ({ name: t.name.replace(/ \d+$/, ''), img: t.img, hp: t.maxHp, maxHp: t.maxHp, size: t.size, hidden: t.hidden }));
  }

  async function finish() {
    keepCalibration();
    const meta = { name: draft.name, mapId: draft.mapId, grid: draft.grid, crop: draft.crop, moveSquares: draft.moveSquares };
    if (editing) {
      const res = await ctx.emit('scene:update', { id: editing.id, ...meta });
      if (res?.ok) { dlg.close(); toast('Escena actualizada', 'ok'); }
      return;
    }
    const frame = frameFor();
    const pcs = layoutTokens([...draft.pcs].map((characterId) => ({ characterId })), frame, draft.grid, true);
    const monsterList = [
      ...BESTIARY.flatMap((b) => Array.from({ length: draft.monsters[b.name] || 0 }, () => ({ name: b.name, img: b.img, hp: b.hp, maxHp: b.hp, size: b.size, hidden: draft.hideMonsters }))),
      ...copiedFromCurrent(),
    ];
    const monsters = layoutTokens(monsterList, frame, draft.grid, false);
    const res = await ctx.emit('scene:create', { ...meta, tokens: [...pcs, ...monsters] });
    if (res?.ok) {
      dlg.close();
      toast('Escena en preparación: coloca las fichas y pulsa «Lanzar» cuando esté lista', 'ok');
    }
  }

  function render() {
    const name = steps[step];
    clear(stepBar, steps.map((label, i) => h(`button.wiz-step${i === step ? '.on' : ''}${i < step ? '.done' : ''}`, { type: 'button', onclick: () => go(i) },
      h('b', i + 1), h('span', label))));
    clear(body, name === 'Escena' ? stepScene() : name === 'Cuadrícula' ? stepGrid() : name === 'Fichas' ? stepTokens() : stepDone());
    const last = step === steps.length - 1;
    clear(foot,
      h('button.btn.ghost', { type: 'button', disabled: step === 0, onclick: () => go(step - 1) }, '← Atrás'),
      h('span.grow'),
      last
        ? h('button.btn.primary', { type: 'button', onclick: finish }, editing ? 'Guardar cambios' : '✦ Crear y colocar fichas')
        : h('button.btn.primary', { type: 'button', onclick: () => go(step + 1) }, 'Siguiente →'));
  }

  render();
}

/** Diálogo para lanzar una escena: a todo el grupo o solo a algunos (escenas paralelas). */
export function openLaunchDialog(ctx, scene) {
  const { s } = ctx;
  const players = s.users.filter((u) => u.role === 'player');
  const where = (uid) => s.scenes.find((x) => x.players.includes(uid))?.name || '—';
  const picked = new Set(players.map((u) => u.id));
  const dlg = modal(`Lanzar «${scene.name}»`, [
    h('p.muted', 'Los marcados pasan a esta escena con un cartel de presentación. Los demás se quedan donde están: así puedes llevar al grupo separado en escenas paralelas.'),
    players.length ? h('div.col', players.map((u) => h('label.check',
      h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) picked.add(u.id); else picked.delete(u.id); } }),
      h('span', u.displayName, h('small.muted', ` · ahora en «${where(u.id)}»`))))) : h('p.tiny.muted', 'No hay jugadores en la campaña.'),
    h('div.row.end',
      h('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancelar'),
      h('button.btn.primary', {
        onclick: async () => {
          const res = await ctx.emit('scene:launch', { id: scene.id, userIds: [...picked] });
          if (res?.ok) { dlg.close(); toast(`«${scene.name}» en juego`, 'ok'); }
        },
      }, '▶ Lanzar')),
  ]);
}

// ---------------------------------------------------------------- panel lateral del DM
export function scenePanel(ctx) {
  const { s } = ctx;
  const nameOf = (uid) => s.users.find((u) => u.id === uid)?.displayName || '?';
  const mapUrl = (id) => s.maps.find((m) => m.id === id)?.url;

  const card = (sc) => {
    const viewing = sc.id === s.scene.id;
    const live = sc.players.length > 0;
    const thumb = mapUrl(sc.mapId);
    return h(`div.scene-card${viewing ? '.viewing' : ''}${live ? '.live' : ''}`,
      h('div.scene-thumb', { style: thumb ? { backgroundImage: `url("${thumb}")` } : {}, onclick: () => ctx.viewScene(sc.id), title: 'Ver en mi tablero' },
        viewing ? h('span.badge.small.gold', 'en tu tablero') : null),
      h('div.scene-info',
        h('div.row.between', h('b', sc.name), sc.combat ? h('span.badge.small', '⚔ combate') : null),
        h('div.tiny', live
          ? h('span.live-text', `● En juego · ${sc.players.map(nameOf).join(', ')}`)
          : h('span.muted', '◌ En preparación · nadie la ve')),
        h('div.tiny.muted', `${sc.tokens} fichas${sc.active ? ' · principal' : ''}`),
        h('div.row.wrap',
          viewing ? null : h('button.btn.small.ghost', { onclick: () => ctx.viewScene(sc.id) }, '👁 Ver'),
          viewing ? h('button.btn.small.ghost', { onclick: () => openSceneWizard(ctx, s.scene), title: 'Mapa, cuadrícula y movimiento' }, '✎ Editar') : null,
          h('button.btn.small.primary', { onclick: () => openLaunchDialog(ctx, sc) }, '▶ Lanzar'),
          live ? null : h('button.icon-btn.small', {
            title: 'Borrar escena',
            onclick: async () => { if (await confirmDialog(`¿Borrar la escena «${sc.name}» y sus fichas?`)) ctx.emit('scene:delete', { id: sc.id }); },
          }, '🗑'))));
  };

  return h('div.panel',
    h('button.btn.primary', { onclick: () => openSceneWizard(ctx) }, '✦ Preparar escena nueva'),
    h('div.label-mini', 'Escenas de la campaña'),
    h('div.scene-list', s.scenes.map(card)),
    h('p.tiny.muted', 'Las escenas en preparación solo las ves tú. «Lanzar» lleva a todo el grupo, o solo a quien marques, a esa escena.'),
    h('div.label-mini', 'Biblioteca de mapas'),
    s.maps.length ? h('div.map-list', s.maps.map((m) => h('div.map-item',
      h('div.map-thumb', { style: { backgroundImage: `url("${m.url}")` } }),
      h('span', m.name),
      h('button.icon-btn.small', {
        title: 'Editar en el taller de mapas (se abre en otra pestaña)',
        onclick: () => window.open(`#/mapas/nuevo?desde=${encodeURIComponent(m.url)}&nombre=${encodeURIComponent(m.name)}`, '_blank'),
      }, '✎'),
      h('button.icon-btn.small', {
        title: 'Quitar mapa',
        onclick: async () => { if (await confirmDialog(`¿Quitar el mapa "${m.name}"? Las escenas que lo usen se quedan sin mapa.`)) ctx.emit('map:remove', { id: m.id }); },
      }, '✕')))) : h('p.muted.tiny', 'Sin mapas. Súbelos al preparar una escena.'),
    h('button.btn.small.ghost', { onclick: () => window.open('#/mapas', '_blank') }, '🛠 Abrir el taller de mapas'));
}
