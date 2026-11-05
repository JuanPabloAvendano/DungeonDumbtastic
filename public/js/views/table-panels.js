// Paneles de la mesa: escena, fichas, grupo, jugadores, personaje, bandeja de dados e iniciativa.
import { h, clear, field, toast, modal, confirmDialog, pickImage, mod, signed, ABILITIES } from '../ui.js';
import { api } from '../api.js';
import { sheetForm, playSheet, DEMO_PORTRAITS } from '../sheet.js';

const DEMO_MAPS = [
  { name: 'Ruinas del bosque', url: '/assets/demo/map-bosque.svg' },
  { name: 'Cripta olvidada', url: '/assets/demo/map-cripta.svg' },
];
const BESTIARY = [
  { name: 'Goblin', img: '/assets/demo/token-goblin.svg', hp: 7, size: 1 },
  { name: 'Esqueleto', img: '/assets/demo/token-esqueleto.svg', hp: 13, size: 1 },
  { name: 'Lobo', img: '/assets/demo/token-lobo.svg', hp: 11, size: 1 },
  { name: 'Guerrero', img: '/assets/demo/token-guerrero.svg', hp: 20, size: 1 },
  { name: 'Maga', img: '/assets/demo/token-maga.svg', hp: 12, size: 1 },
  { name: 'Pícaro', img: '/assets/demo/token-picaro.svg', hp: 14, size: 1 },
  { name: 'Clériga', img: '/assets/demo/token-clerigo.svg', hp: 16, size: 1 },
];
const DICE = [4, 6, 8, 10, 12, 20, 100];

function draggable(data, el) {
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-da', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'copy';
  });
  return el;
}

// ---------------------------------------------------------------- DM: escena
export function scenePanel(ctx) {
  const { s } = ctx;
  const grid = h('input', { type: 'range', min: 30, max: 160, step: 5, value: s.scene.gridSize });
  const gridOut = h('b', `${s.scene.gridSize}px`);
  grid.addEventListener('input', () => { gridOut.textContent = `${grid.value}px`; });
  grid.addEventListener('change', () => ctx.emit('scene:set', { gridSize: Number(grid.value) }));
  const showGrid = h('input', { type: 'checkbox', checked: s.scene.showGrid, onchange: (e) => ctx.emit('scene:set', { showGrid: e.target.checked }) });

  const missingDemos = DEMO_MAPS.filter((d) => !s.maps.some((m) => m.url === d.url));
  return h('div.panel',
    h('div.label-mini', 'Mapas de la campaña'),
    s.maps.length ? h('div.map-list', s.maps.map((m) => h(`div.map-item${m.id === s.scene.mapId ? '.active' : ''}`,
      { onclick: () => ctx.emit('scene:set', { mapId: m.id }), title: 'Mostrar a todos' },
      h('div.map-thumb', { style: { backgroundImage: `url("${m.url}")` } }),
      h('span', m.name),
      h('button.icon-btn.small', {
        title: 'Quitar mapa',
        onclick: async (e) => {
          e.stopPropagation();
          if (await confirmDialog(`¿Quitar el mapa "${m.name}"?`)) ctx.emit('map:remove', { id: m.id });
        },
      }, '✕')))) : h('p.muted.tiny', 'Sin mapas. Sube uno o usa los de ejemplo.'),
    h('div.col',
      h('button.btn.primary', {
        onclick: async () => {
          const url = await pickImage(api);
          if (!url) return;
          const name = prompt('Nombre del mapa:', 'Nuevo mapa') || 'Mapa';
          ctx.emit('map:add', { name, url });
        },
      }, '⬆ Subir mapa'),
      missingDemos.length ? h('button.btn.ghost', {
        onclick: () => missingDemos.forEach((d) => ctx.emit('map:add', d)),
      }, '✦ Añadir mapas de ejemplo') : null),
    h('div.label-mini', 'Cuadrícula'),
    h('label.check', showGrid, h('span', 'Mostrar cuadrícula')),
    h('div.range-row', grid, gridOut),
    h('p.tiny.muted', 'Ajusta el tamaño de la casilla para que coincida con el dibujo del mapa.'));
}

// ---------------------------------------------------------------- DM: fichas
export function tokensPanel(ctx) {
  const { s } = ctx;
  const hidden = h('input', { type: 'checkbox', checked: ctx.prefs.placeHidden, onchange: (e) => { ctx.prefs.placeHidden = e.target.checked; } });
  const place = (data) => {
    const p = ctx.board.center();
    ctx.emit('token:add', { ...data, x: p.x, y: p.y, hidden: ctx.prefs.placeHidden });
  };
  const onBoard = new Set(s.tokens.map((t) => t.characterId).filter(Boolean));

  return h('div.panel',
    h('p.tiny.muted', 'Clic para colocar en el centro, o arrastra al mapa.'),
    h('label.check', hidden, h('span', 'Colocar ocultas (solo las ve el DM)')),
    h('div.label-mini', 'Personajes del grupo'),
    s.characters.length ? h('div.token-lib', s.characters.map((ch) => draggable({ characterId: ch.id }, h(`div.lib-item${onBoard.has(ch.id) ? '.placed' : ''}`,
      { onclick: () => place({ characterId: ch.id }), title: onBoard.has(ch.id) ? 'Ya está en el mapa' : 'Colocar' },
      h('img', { src: ch.portrait || DEMO_PORTRAITS[0], alt: '' }), h('span', ch.name))))) : h('p.muted.tiny', 'Los jugadores aún no han traído personajes.'),
    h('div.label-mini', 'Bestiario de ejemplo'),
    h('div.token-lib', BESTIARY.map((b) => draggable({ name: b.name, img: b.img, hp: b.hp, maxHp: b.hp, size: b.size },
      h('div.lib-item', { onclick: () => place({ name: b.name, img: b.img, hp: b.hp, maxHp: b.hp, size: b.size }) },
        h('img', { src: b.img, alt: '' }), h('span', b.name), h('small', `${b.hp} PG`))))),
    h('button.btn.primary', {
      onclick: async () => {
        const url = await pickImage(api);
        if (!url) return;
        const name = prompt('Nombre de la ficha:', 'Criatura') || 'Criatura';
        const hp = Number(prompt('Puntos de golpe:', '10')) || 10;
        place({ name, img: url, hp, maxHp: hp, size: 1 });
      },
    }, '⬆ Subir ficha nueva'));
}

// ---------------------------------------------------------------- grupo
export function partyPanel(ctx) {
  const { s } = ctx;
  if (!s.characters.length) return h('div.panel', h('p.muted', 'Todavía no hay personajes en esta campaña.'));
  return h('div.panel', s.characters.map((ch) => {
    const owner = s.users.find((u) => u.id === ch.ownerId);
    const pct = Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100));
    const token = s.tokens.find((t) => t.characterId === ch.id);
    return h('div.party-row', { onclick: () => token && ctx.board.focusToken(token.id) },
      h('img', { src: ch.portrait || DEMO_PORTRAITS[0], alt: '' }),
      h('div.party-info',
        h('div.row.between', h('b', ch.name), h('span.tiny.muted', `CA ${ch.ac}`)),
        h('div.tiny.muted', `${[ch.race, ch.cls].filter(Boolean).join(' · ')} · ${owner?.displayName || ''}`),
        h('div.hpbar.small', h('i', { style: { width: `${pct}%` } }), h('span', `${ch.hp}/${ch.maxHp}`))),
      ctx.online.includes(ch.ownerId) ? h('span.dot.on', { title: 'Conectado' }) : h('span.dot', { title: 'Desconectado' }));
  }));
}

// ---------------------------------------------------------------- DM: jugadores y pedir tiradas
export function playersPanel(ctx) {
  const { s } = ctx;
  const input = h('input', { placeholder: 'usuario del jugador', required: true });
  const target = h('select', h('option', { value: '' }, 'Todos los jugadores'),
    s.users.filter((u) => u.role === 'player').map((u) => h('option', { value: u.id }, u.displayName)));
  const ability = h('select', ABILITIES.map(([k, , long]) => h('option', { value: k }, long)));
  const label = h('input', { placeholder: 'Ej: Percepción, Salvación…', maxlength: 60 });
  const dc = h('input', { type: 'number', min: 1, max: 40, value: 12 });
  const hidden = h('input', { type: 'checkbox' });

  return h('div.panel',
    h('div.label-mini', 'En la campaña'),
    s.users.map((u) => h('div.list-row',
      h('span.dot', { class: ctx.online.includes(u.id) ? 'on' : '' }),
      h('span.grow', u.displayName, h('small.muted', ` @${u.username}`)),
      u.role === 'dm' ? h('span.badge.gold', 'DM') : h('button.icon-btn.small', {
        title: 'Quitar de la campaña',
        onclick: async () => {
          if (!(await confirmDialog(`¿Quitar a ${u.displayName} de la campaña?`))) return;
          try { await api.del(`/campaigns/${s.id}/players/${u.id}`); } catch (err) { toast(err.message, 'error'); }
        },
      }, '✕'))),
    h('form.row', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api.post(`/campaigns/${s.id}/players`, { username: input.value }); input.value = ''; toast('Jugador añadido', 'ok'); } catch (err) { toast(err.message, 'error'); }
      },
    }, input, h('button.btn.primary', 'Añadir')),
    h('div.label-mini', 'Pedir una tirada'),
    h('form.col', {
      onsubmit: (e) => {
        e.preventDefault();
        const long = ABILITIES.find(([k]) => k === ability.value)[2];
        ctx.emit('roll:request', {
          userId: target.value || null, ability: ability.value, dc: Number(dc.value) || null,
          label: label.value.trim() || `Prueba de ${long}`, hidden: hidden.checked,
        });
        toast('Tirada pedida', 'ok');
      },
    },
    field('A quién', target), field('Característica', ability), field('Nombre de la prueba', label),
    h('div.grid2', field('CD', dc), h('label.check', hidden, h('span', 'Resultado oculto'))),
    h('button.btn.primary', '🎲 Pedir tirada')));
}

// ---------------------------------------------------------------- jugador: mi personaje
export function characterPanel(ctx) {
  const { s, me } = ctx;
  const mine = s.characters.filter((ch) => ch.ownerId === me.id);
  const box = h('div.panel');

  const editor = (ch) => {
    const m = modal(ch ? `Editar · ${ch.name}` : 'Nuevo personaje', sheetForm(ch || null, {
      onSave: async (data) => {
        try {
          if (ch) await api.patch(`/characters/${ch.id}`, data);
          else await api.post('/characters', { ...data, campaignId: s.id });
          m.close();
          toast('Personaje guardado', 'ok');
        } catch (err) { toast(err.message, 'error'); }
      },
    }), { wide: true });
  };

  if (!mine.length) {
    api.get('/characters').then(({ characters }) => {
      const free = characters.filter((c) => c.campaignId !== s.id);
      clear(box,
        h('p', 'Aún no tienes personaje en esta campaña.'),
        h('button.btn.primary', { onclick: () => editor(null) }, '+ Crear personaje'),
        free.length ? [h('div.label-mini', 'O trae uno tuyo'), free.map((c) => h('div.list-row',
          h('img.mini', { src: c.portrait || DEMO_PORTRAITS[0], alt: '' }), h('span.grow', c.name),
          h('button.btn.small', {
            onclick: async () => {
              try { await api.patch(`/characters/${c.id}`, { ...c, campaignId: s.id }); } catch (err) { toast(err.message, 'error'); }
            },
          }, 'Traer')))] : null);
    }).catch((err) => toast(err.message, 'error'));
    return box;
  }

  const ch = mine[0];
  const token = s.tokens.find((t) => t.characterId === ch.id);
  clear(box,
    playSheet(ch, {
      onRoll: (r) => ctx.roll(r),
      onHp: (d) => ctx.changeCharacterHp(ch, d),
    }),
    h('div.row',
      token
        ? h('button.btn.ghost', { onclick: () => ctx.board.focusToken(token.id) }, '◎ Ver mi ficha')
        : h('button.btn.primary', {
          onclick: () => { const p = ctx.board.center(); ctx.emit('token:add', { characterId: ch.id, x: p.x, y: p.y }); },
        }, '⬇ Colocar mi ficha'),
      h('button.btn.ghost', { onclick: () => editor(ch) }, '✎ Editar hoja')));
  return box;
}

// ---------------------------------------------------------------- bandeja de dados
export function diceTray(ctx) {
  let pool = {};
  let mode = 'normal';
  const poolEl = h('div.pool');
  const modInput = h('input.mod-input', { type: 'number', value: 0, title: 'Modificador' });
  const labelInput = h('input.label-input', { placeholder: 'Etiqueta (opcional)', maxlength: 60 });
  const dcInput = h('input.mod-input', { type: 'number', min: 1, max: 40, placeholder: 'CD', title: 'Clase de dificultad' });
  const hiddenInput = h('input', { type: 'checkbox' });
  const modeBtns = h('div.seg');

  const expr = () => {
    const parts = Object.entries(pool).filter(([, n]) => n > 0).map(([d, n]) => `${n}d${d}`);
    const m = Number(modInput.value) || 0;
    return parts.length ? parts.join('+') + (m ? signed(m) : '') : '';
  };
  const renderPool = () => {
    const e = expr();
    clear(poolEl, e ? h('span', e.replace(/\+/g, ' + ')) : h('span.muted', 'Elige dados…'));
  };
  const renderMode = () => clear(modeBtns, [['dis', 'Desv.'], ['normal', 'Normal'], ['adv', 'Ventaja']].map(([k, l]) => h(`button${mode === k ? '.on' : ''}`, {
    onclick: () => { mode = k; renderMode(); }, title: 'Ventaja/desventaja aplica al d20',
  }, l)));

  const roll = (e) => {
    const value = e || expr();
    if (!value) return toast('Elige al menos un dado', 'info');
    ctx.roll({ expr: value, label: labelInput.value.trim(), mode, dc: dcInput.value || null, hidden: hiddenInput.checked });
    pool = {};
    renderPool();
  };

  modInput.addEventListener('input', renderPool);
  renderPool();
  renderMode();

  return h('div.dice-tray',
    h('div.tray-dice', DICE.map((d) => h('button.die-btn', {
      onclick: () => { pool = { ...pool, [d]: (pool[d] || 0) + 1 }; renderPool(); },
      oncontextmenu: (e) => { e.preventDefault(); pool = { ...pool, [d]: Math.max(0, (pool[d] || 0) - 1) }; renderPool(); },
      title: `d${d} (clic: añadir · clic derecho: quitar)`,
    }, h('img', { src: `/assets/dice/d${d === 100 ? 10 : d}.svg`, alt: '' }), h('span', `d${d}`)))),
    h('div.tray-mid', poolEl, h('div.row', h('span.tiny.muted', 'Mod.'), modInput, labelInput)),
    h('div.tray-opts', modeBtns,
      ctx.s.isDM ? h('div.row', dcInput, h('label.check.tiny', hiddenInput, h('span', 'Oculta'))) : null),
    h('div.tray-go',
      h('button.btn.roll', { onclick: () => roll() }, 'TIRAR'),
      h('button.btn.small.ghost', { onclick: () => roll(`1d20${signed(Number(modInput.value) || 0)}`) }, 'd20 rápido')));
}

// ---------------------------------------------------------------- iniciativa
export function initiativeBar(ctx) {
  const { s } = ctx;
  const ini = s.initiative;
  const set = (patch) => ctx.emit('initiative:set', { ...ini, ...patch });
  const dexOf = (t) => {
    const ch = t.characterId && s.characters.find((c) => c.id === t.characterId);
    return ch ? mod(ch.stats.dex) : 0;
  };
  const rollAll = () => {
    // Las fichas ocultas no entran: delatarían la emboscada.
    const entries = s.tokens.filter((t) => !t.hidden).map((t) => {
      const ch = t.characterId && s.characters.find((c) => c.id === t.characterId);
      return { id: t.id, tokenId: t.id, name: ch ? ch.name : t.name, img: t.img, value: 1 + Math.floor(Math.random() * 20) + dexOf(t) };
    }).sort((a, b) => b.value - a.value);
    set({ entries, turn: 0, round: 1 });
  };

  if (!ini.entries.length) {
    return s.isDM ? h('div.initiative.empty',
      h('button.btn.small.ghost', { onclick: rollAll }, '⚔ Iniciar combate (tirar iniciativa)')) : h('div.initiative.empty.hidden');
  }

  return h('div.initiative',
    h('div.round', h('small', 'Ronda'), h('b', ini.round)),
    h('div.ini-list', ini.entries.map((e, i) => h(`div.ini-item${i === ini.turn ? '.current' : ''}`, {
      onclick: () => e.tokenId && ctx.board.focusToken(e.tokenId), title: `${e.name} (${e.value})`,
    }, h('img', { src: e.img || DEMO_PORTRAITS[4], alt: '' }), h('span.ini-val', e.value), h('span.ini-name', e.name)))),
    s.isDM ? h('div.ini-ctrl',
      h('button.btn.small', {
        onclick: () => {
          const next = ini.turn + 1;
          set(next >= ini.entries.length ? { turn: 0, round: ini.round + 1 } : { turn: next });
        },
      }, 'Siguiente ▶'),
      h('button.btn.small.ghost', { onclick: rollAll, title: 'Volver a tirar' }, '↻'),
      h('button.btn.small.ghost', { onclick: () => set({ entries: [], turn: 0, round: 1 }), title: 'Terminar combate' }, '✕')) : null);
}

// ---------------------------------------------------------------- DM: música y sonido
const DEMO_TRACKS = [
  { name: 'Taberna alegre', url: '/assets/audio/musica-taberna.mp3', kind: 'musica' },
  { name: 'Tambores de combate', url: '/assets/audio/musica-combate.mp3', kind: 'musica' },
  { name: 'Cripta (viento y goteo)', url: '/assets/audio/ambiente-cripta.mp3', kind: 'ambiente' },
  { name: 'Fogata nocturna', url: '/assets/audio/ambiente-fogata.mp3', kind: 'ambiente' },
  { name: 'Golpe seco', url: '/assets/audio/efecto-golpe.mp3', kind: 'efecto' },
  { name: 'Puerta que cruje', url: '/assets/audio/efecto-puerta.mp3', kind: 'efecto' },
];
const KIND_LABEL = { musica: '🎼 Música', ambiente: '🌫 Ambiente', efecto: '💥 Efectos (suenan una vez)' };

export function musicPanel(ctx) {
  const { s, music } = ctx;
  const m = s.music || {};
  const tracks = s.tracks || [];
  const current = tracks.find((t) => t.id === m.trackId);
  const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round((m.volume ?? 0.7) * 100) });
  vol.addEventListener('change', () => ctx.emit('music:set', { volume: Number(vol.value) / 100 }));
  const missing = DEMO_TRACKS.filter((d) => !tracks.some((t) => t.url === d.url));

  const upload = async () => {
    const input = h('input', { type: 'file', accept: 'audio/*' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const name = h('input', { value: file.name.replace(/\.[^.]+$/, '').slice(0, 50), maxlength: 50 });
      const kind = h('select', Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k }, l)));
      const dlg = modal('Nueva pista', h('form.col', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            toast('Subiendo audio…');
            const form = new FormData();
            form.append('audio', file);
            const { url } = await api.post('/upload/audio', form);
            await ctx.emit('track:add', { name: name.value, url, kind: kind.value });
            dlg.close();
            toast('Pista añadida', 'ok');
          } catch (err) { toast(err.message, 'error'); }
        },
      }, field('Nombre', name), field('Tipo', kind),
      h('p.tiny.muted', `${file.name} · ${(file.size / 1048576).toFixed(1)} MB (máx. 40 MB)`),
      h('button.btn.primary', 'Subir pista')));
    });
    input.click();
  };

  const group = (kind) => {
    const list = tracks.filter((t) => t.kind === kind);
    if (!list.length) return null;
    return [h('div.label-mini', KIND_LABEL[kind]), h('div.track-list', list.map((t) => h(`div.track${t.id === m.trackId ? '.active' : ''}`,
      h('button.icon-btn', {
        title: kind === 'efecto' ? 'Hacer sonar para todos' : 'Reproducir para todos',
        onclick: () => (kind === 'efecto' ? ctx.emit('sfx', { id: t.id }) : ctx.emit('music:set', { action: 'play', trackId: t.id })),
      }, kind === 'efecto' ? '🔊' : (t.id === m.trackId && m.playing ? '♪' : '▶')),
      h('span.grow', t.name),
      h('button.icon-btn.small', {
        title: 'Quitar de la biblioteca',
        onclick: async () => { if (await confirmDialog(`¿Quitar "${t.name}"?`)) ctx.emit('track:remove', { id: t.id }); },
      }, '✕'))))];
  };

  return h('div.panel',
    h('div.now-playing',
      h('div.np-title', h('small', m.playing ? 'Sonando para todos' : current ? 'En pausa' : 'Silencio'), h('b', current?.name || '—')),
      h('div.row',
        m.playing
          ? h('button.btn.small', { onclick: () => ctx.emit('music:set', { action: 'pause' }) }, '⏸ Pausa')
          : h('button.btn.small', { disabled: !current, onclick: () => ctx.emit('music:set', { action: 'play' }) }, '▶ Seguir'),
        h('button.btn.small.ghost', { disabled: !current, onclick: () => ctx.emit('music:set', { action: 'stop' }) }, '⏹ Parar'),
        h('label.check.tiny', h('input', { type: 'checkbox', checked: m.loop !== false, onchange: (e) => ctx.emit('music:set', { loop: e.target.checked }) }), h('span', 'Bucle'))),
      h('div.range-row', h('span.tiny.muted', 'Vol. general'), vol),
      music?.blocked ? h('button.btn.small.primary', { onclick: () => music.unlock() }, '🔈 Activar sonido en este navegador') : null),
    group('musica'), group('ambiente'), group('efecto'),
    !tracks.length ? h('p.muted.tiny', 'La biblioteca está vacía. Sube tus pistas o añade las de ejemplo.') : null,
    h('div.col',
      h('button.btn.primary', { onclick: upload }, '⬆ Subir pista (MP3, OGG, WAV…)'),
      missing.length ? h('button.btn.ghost', { onclick: () => missing.forEach((d) => ctx.emit('track:add', d)) }, '✦ Añadir pistas de ejemplo') : null),
    h('p.tiny.muted', 'Música y ambiente suenan en bucle para todos a la vez. Cada jugador ajusta su propio volumen arriba a la derecha.'));
}
