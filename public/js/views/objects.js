// Objetos del tablero en la mesa: lo que ve y puede hacer un jugador al seleccionar uno (recoger,
// abrir, leer, activar, sacar lo de dentro) y el editor del DM para configurarlos.
import { h, clear, field, toast, modal, ABILITIES } from '../ui.js';

const USE_LABEL = {
  ninguna: ['👁', 'Solo se mira'], recoger: ['✋', 'Recoger'], abrir: ['🔓', 'Abrir'], leer: ['📖', 'Leer'], activar: ['⚙', 'Activar'],
};
const ROTATIONS = [0, 90, 180, 270];
const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Objetos de ejemplo para colocar con un clic (cada uno ya con su función). */
export const OBJECT_LIBRARY = [
  { name: 'Cofre', img: '/assets/objects/cofre.svg', object: { use: 'abrir', description: 'Un cofre de madera reforzada.', contents: [{ name: 'Monedas de oro', qty: 25 }] } },
  { name: 'Puerta', img: '/assets/objects/puerta.svg', object: { use: 'abrir', description: 'Una puerta pesada.', locked: true, check: { ability: 'str', dc: 13 } } },
  { name: 'Palanca', img: '/assets/objects/palanca.svg', object: { use: 'activar', description: 'Una palanca oxidada en la pared.' } },
  { name: 'Carta', img: '/assets/objects/carta.svg', object: { use: 'leer', description: 'Una carta sellada con lacre.' } },
  { name: 'Llave', img: '/assets/objects/llave.svg', object: { use: 'recoger', description: 'Una llave de hierro.' } },
  { name: 'Poción', img: '/assets/objects/pocion.svg', object: { use: 'recoger', description: 'Un frasco con un líquido rojo.' } },
  { name: 'Bolsa', img: '/assets/objects/bolsa.svg', object: { use: 'abrir', description: 'Una bolsa de cuero.', contents: [] } },
];

const abilityName = (k) => ABILITIES.find(([key]) => key === k)?.[2] || 'característica';

/** Lo que se ve de un objeto en el inspector y los botones para usarlo. */
export function objectInspector(ctx, t) {
  const o = t.object || {};
  const [icon, label] = USE_LABEL[o.use] || USE_LABEL.ninguna;
  const actor = ctx.actingCharacter?.id;
  const interact = async () => {
    const res = await ctx.emit('object:interact', { id: t.id, characterId: actor });
    if (!res || res.error) return;
    if (res.text) modal(res.title || t.name, h('div.object-read', res.result ? h('p.muted', res.result) : null, h('div.letter', res.text)));
    else if (res.result) toast(res.result, 'ok');
  };
  const status = [
    o.locked ? `🔒 Cerrado${o.check ? ` · prueba de ${abilityName(o.check.ability)}` : ''}` : null,
    o.use === 'abrir' && o.open ? 'Abierto' : null,
    o.use === 'activar' && o.used ? 'Activado' : null,
  ].filter(Boolean).join(' · ');
  const hasCharacter = ctx.s.characters.some((c) => c.ownerId === ctx.me.id);
  return h('div.col.object-insp',
    o.description ? h('p.object-desc', o.description) : null,
    status ? h('div.tiny.muted', status) : null,
    ctx.s.isDM && o.secret ? h('p.tiny.object-secret', `🤫 ${o.secret}`) : null,
    o.use !== 'ninguna' && !(o.use === 'abrir' && o.open) && (!ctx.s.isDM || hasCharacter)
      ? h('button.btn.small.primary', { onclick: interact, title: `Hay que estar a ${o.range === 1 ? '1 casilla' : `${o.range} casillas`}` },
        `${icon} ${o.use === 'activar' && o.used ? 'Desactivar' : label}`)
      : null,
    Array.isArray(o.contents) && o.contents.length ? h('div.col',
      h('div.label-mini', 'Dentro'),
      o.contents.map((it) => h('div.list-row', h('span.grow', it.name, it.qty > 1 ? h('small.muted', ` ×${it.qty}`) : null),
        // El DM ve lo que hay dentro aunque esté cerrado; tomarlo solo se puede con el objeto abierto.
        o.open ? h('button.btn.small', { onclick: () => ctx.emit('object:take', { id: t.id, itemId: it.id, characterId: actor }) }, 'Tomar') : null))) : null);
}

/** Editor del DM: función, descripción, nota secreta, texto, contenido, cerradura y alcance. */
export function openObjectEditor(ctx, t) {
  const o = { use: 'ninguna', description: '', secret: '', text: '', contents: [], range: 1, check: null, locked: false, ...(t.object || {}) };
  let contents = (o.contents || []).map((x) => ({ ...x }));
  const use = h('select', Object.entries(USE_LABEL).map(([k, [icon, label]]) => h('option', { value: k, selected: o.use === k }, `${icon} ${label}`)));
  const desc = h('textarea', { rows: 2, maxlength: 600, placeholder: 'Lo que ven los jugadores al mirarlo' }, o.description);
  const secret = h('textarea', { rows: 2, maxlength: 600, placeholder: 'Solo tú lo ves (qué hace la palanca, quién escribió la carta…)' }, o.secret);
  const text = h('textarea', { rows: 5, maxlength: 3000, placeholder: 'Texto de la carta o inscripción: le sale solo a quien la lee' }, o.text);
  const range = h('input', { type: 'number', min: 1, max: 20, value: o.range });
  const locked = h('input', { type: 'checkbox', checked: o.locked });
  const ability = h('select', h('option', { value: '' }, 'Sin prueba (solo lo abres tú)'),
    ABILITIES.map(([k, , long]) => h('option', { value: k, selected: o.check?.ability === k }, long)));
  const dc = h('input', { type: 'number', min: 1, max: 40, value: o.check?.dc || 12 });
  const list = h('div.col');
  const setItem = (i, patch) => { contents = contents.map((x, j) => (j === i ? { ...x, ...patch } : x)); };
  const renderContents = () => clear(list,
    contents.map((it, i) => h('div.row',
      h('input.grow', { value: it.name, maxlength: 40, placeholder: 'Qué hay dentro', oninput: (e) => setItem(i, { name: e.target.value }) }),
      h('input.mod-input', { type: 'number', min: 1, value: it.qty || 1, title: 'Cantidad', oninput: (e) => setItem(i, { qty: Number(e.target.value) || 1 }) }),
      h('button.icon-btn.small', { type: 'button', onclick: () => { contents = contents.filter((_, j) => j !== i); renderContents(); } }, '✕'))),
    h('button.btn.small.ghost', { type: 'button', onclick: () => { contents = [...contents, { id: newId(), name: '', qty: 1 }]; renderContents(); } }, '+ Algo dentro'));
  renderContents();
  const dlg = modal(`Objeto · ${t.name}`, h('form.col', {
    onsubmit: (e) => {
      e.preventDefault();
      ctx.emit('token:update', {
        id: t.id,
        object: {
          use: use.value, description: desc.value, secret: secret.value, text: text.value, range: Number(range.value) || 1,
          locked: locked.checked, check: ability.value ? { ability: ability.value, dc: Number(dc.value) || 12 } : null,
          contents: contents.filter((x) => x.name.trim()),
        },
      });
      dlg.close();
    },
  },
  field('Qué se hace con él', use),
  field('Descripción', desc),
  field('Nota secreta del DM', secret),
  field('Texto (si se lee)', text),
  h('div.label-mini', 'Contenido (si se abre)'), list,
  h('div.grid2', field('Alcance (casillas)', range), h('label.check', locked, h('span', 'Cerrado con llave'))),
  h('div.grid2', field('Prueba para abrirlo', ability), field('CD', dc)),
  h('p.tiny.muted', 'Recoger lo lleva al inventario del personaje; Abrir muestra su contenido (con prueba si está cerrado); Leer enseña el texto solo a quien lo lee; Activar te avisa a ti con tu nota secreta.'),
  h('button.btn.primary', 'Guardar objeto')), { wide: true });
}

/** Botones del DM para un objeto: configurarlo, girarlo y volverlo criatura. */
export function objectDmControls(ctx, t) {
  const rot = t.object?.rot || 0;
  return [
    h('button.btn.small.ghost', { onclick: () => openObjectEditor(ctx, t) }, '⚙ Configurar'),
    h('button.btn.small.ghost', { title: 'Girar 90°', onclick: () => ctx.emit('token:update', { id: t.id, object: { rot: ROTATIONS[(ROTATIONS.indexOf(rot) + 1) % ROTATIONS.length] } }) }, `↻ ${rot}°`),
    h('button.btn.small.ghost', { title: 'Tratarlo como criatura (con PG e iniciativa)', onclick: () => ctx.emit('token:update', { id: t.id, kind: 'criatura' }) }, '🐾 Criatura'),
  ];
}
