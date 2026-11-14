// Inventario en la interfaz: el editor de la hoja (objetos, equipo, monedas) y el panel de juego
// (equipar, atacar con el arma, dar a otro, carga). Las cuentas salen de inventory-rules.js.
import { h, clear, field, modal, signed } from './ui.js';
import {
  COINS, EQUIPMENT_PRESETS, computeAc, encumbrance, weaponAttack, coinsValueGp, formatGp,
} from './inventory-rules.js';

const KIND_LABEL = { objeto: 'Objeto', arma: 'Arma', armadura: 'Armadura', escudo: 'Escudo' };
const ARMOR_TYPES = ['ligera', 'media', 'pesada'];
const LOAD_CLASS = { normal: 'ok', sobrecargado: 'warn', 'muy sobrecargado': 'bad', excedido: 'bad' };
const LOAD_NOTE = { sobrecargado: '−10 pies de velocidad', 'muy sobrecargado': '−20 pies y desventaja en Fue/Des/Con', excedido: 'no puede moverse' };

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Añade al <select> el grupo «Mis objetos» (se carga aparte) y devuelve con qué objeto se queda una
 * opción: «t:<id>» es un objeto propio; un número, el equipo del SRD.
 */
function withMyObjects(select) {
  const group = h('optgroup', { label: 'Mis objetos' });
  let mine = [];
  import('./views/templates.js').then(async ({ loadTemplates, templateToItem }) => {
    mine = (await loadTemplates()).map((t) => [t.id, templateToItem(t)]);
    if (mine.length) select.insertBefore(clear(group, mine.map(([id, it]) => h('option', { value: `t:${id}` }, it.name))), select.children[1] || null);
  }).catch(() => {});
  return (value) => (String(value).startsWith('t:')
    ? structuredClone(mine.find(([id]) => `t:${id}` === value)?.[1] || null)
    : (EQUIPMENT_PRESETS[Number(value)] ? structuredClone({ ...EQUIPMENT_PRESETS[Number(value)], qty: 1 }) : null));
}
const equippable = (it) => it.kind && it.kind !== 'objeto';
export const coinsLine = (coins = {}) => COINS.filter(([k]) => coins[k]).map(([k, label]) => `${coins[k]} ${label}`).join(' · ');

/** Campos propios de armas y armaduras (solo se muestran si el objeto lo es). */
export function gearFields(it, set) {
  if (it.kind === 'armadura') {
    const a = it.armor || { base: 11, type: 'ligera' };
    return h('div.inv-gear',
      field('CA base', h('input.mod-input', { type: 'number', min: 10, max: 30, value: a.base, oninput: (e) => set({ armor: { ...a, base: num(e.target.value, 11) } }) })),
      field('Tipo', h('select', { onchange: (e) => set({ armor: { ...a, type: e.target.value } }) },
        ARMOR_TYPES.map((t) => h('option', { value: t, selected: t === a.type }, t)))));
  }
  if (it.kind === 'arma') {
    const w = it.weapon || { damage: '1d6', dmgType: '', proficient: true };
    const flag = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: key === 'proficient' ? w[key] !== false : Boolean(w[key]), onchange: (e) => set({ weapon: { ...w, [key]: e.target.checked } }) }), h('span', label));
    return h('div.inv-gear',
      field('Daño', h('input.mod-input', { value: w.damage, placeholder: '1d8', pattern: '\\d{1,2}d\\d{1,3}', oninput: (e) => set({ weapon: { ...w, damage: e.target.value.trim() } }) })),
      field('Tipo de daño', h('input', { value: w.dmgType || '', maxlength: 20, placeholder: 'cortante', oninput: (e) => set({ weapon: { ...w, dmgType: e.target.value } }) })),
      flag('finesse', 'Sutil'), flag('ranged', 'A distancia'), flag('proficient', 'Competente'));
  }
  return null;
}

/** Editor del inventario en la hoja: objetos con peso/valor, equipo del SRD y monedas. */
export function inventoryEditor(c) {
  c.inventory = c.inventory || [];
  c.coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...(c.coins || {}) };
  const box = h('div.col');
  const set = (i, patch, redraw = false) => {
    c.inventory = c.inventory.map((x, j) => (j === i ? { ...x, ...patch } : x));
    if (redraw) render();
  };
  const presetPicker = h('select', {
    onchange: (e) => {
      const it = pick(e.target.value);
      if (it) { c.inventory = [...c.inventory, { note: '', ...it }]; render(); }
      e.target.value = '';
    },
  }, h('option', { value: '' }, '+ Mis objetos o equipo del SRD…'),
  ['armadura', 'escudo', 'arma'].map((kind) => h('optgroup', { label: KIND_LABEL[kind] },
    EQUIPMENT_PRESETS.map((p, i) => (p.kind === kind ? h('option', { value: i }, p.name) : null)))));
  const pick = withMyObjects(presetPicker);

  function itemCard(it, i) {
    return h('div.inv-card',
      h('div.inv-edit',
        h('input', { value: it.name, maxlength: 40, placeholder: 'Objeto', 'aria-label': 'Nombre', oninput: (e) => set(i, { name: e.target.value }) }),
        h('input.mod-input', { type: 'number', min: 1, max: 999, value: it.qty || 1, title: 'Cantidad', 'aria-label': 'Cantidad', oninput: (e) => set(i, { qty: num(e.target.value, 1) || 1 }) }),
        h('select', { 'aria-label': 'Tipo', onchange: (e) => set(i, { kind: e.target.value, equipped: false }, true) },
          Object.entries(KIND_LABEL).map(([k, label]) => h('option', { value: k, selected: k === (it.kind || 'objeto') }, label))),
        h('input.mod-input', { type: 'number', min: 0, step: 0.1, value: it.weight || 0, title: 'Peso (lb)', 'aria-label': 'Peso en libras', oninput: (e) => set(i, { weight: num(e.target.value) }) }),
        h('input.mod-input', { type: 'number', min: 0, step: 0.01, value: it.value || 0, title: 'Valor (po)', 'aria-label': 'Valor en monedas de oro', oninput: (e) => set(i, { value: num(e.target.value) }) }),
        h('button.icon-btn.small', { type: 'button', title: 'Quitar', onclick: () => { c.inventory = c.inventory.filter((_, j) => j !== i); render(); } }, '✕')),
      gearFields(it, (patch) => set(i, patch, true)),
      equippable(it) ? h('label.check', h('input', { type: 'checkbox', checked: Boolean(it.equipped), onchange: (e) => set(i, { equipped: e.target.checked }) }), h('span', 'Equipado')) : null,
      h('input', { value: it.note || '', maxlength: 400, placeholder: 'Qué es / qué hace', 'aria-label': 'Nota', oninput: (e) => set(i, { note: e.target.value }) }));
  }

  const render = () => clear(box,
    h('div.label-mini', 'Inventario · peso en lb, valor en po'),
    h('div.inv-head.tiny.muted', h('span', 'Nombre'), h('span', 'Cant.'), h('span', 'Tipo'), h('span', 'Peso'), h('span', 'Valor')),
    c.inventory.map(itemCard),
    h('div.row', h('button.btn.small.ghost', { type: 'button', onclick: () => { c.inventory = [...c.inventory, { name: '', qty: 1, note: '', kind: 'objeto' }]; render(); } }, '+ Objeto'), presetPicker),
    h('div.label-mini', 'Monedas'),
    h('div.coins-edit', COINS.map(([k, label]) => field(label, h('input.mod-input', {
      type: 'number', min: 0, max: 999999, value: c.coins[k] || 0, oninput: (e) => { c.coins = { ...c.coins, [k]: Math.max(0, Math.floor(num(e.target.value))) }; },
    })))));
  render();
  return box;
}

/** Diálogo para dar un objeto (o monedas) a otro personaje de la mesa. */
export function giveDialog({ title, others, maxQty = 0, coins = null, onGive }) {
  if (!others.length) return null;
  const to = h('select', others.map((o) => h('option', { value: o.id }, o.name)));
  const qty = maxQty > 1 ? h('input.mod-input', { type: 'number', min: 1, max: maxQty, value: 1 }) : null;
  const coinInputs = coins ? COINS.map(([k, label]) => [k, h('input.mod-input', { type: 'number', min: 0, max: coins[k] || 0, value: 0, disabled: !coins[k], 'aria-label': label })]) : [];
  const m = modal(title, [
    field('Para', to),
    qty ? field(`Cantidad (tienes ${maxQty})`, qty) : null,
    coins ? h('div.coins-edit', coinInputs.map(([k, input]) => field(`${COINS.find(([c]) => c === k)[1]} (${coins[k] || 0})`, input))) : null,
    h('div.row.end', h('button.btn.ghost', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.primary', {
        onclick: () => {
          onGive({ toId: to.value, qty: qty ? num(qty.value, 1) : 1, coins: Object.fromEntries(coinInputs.map(([k, input]) => [k, num(input.value)])) });
          m.close();
        },
      }, 'Dar')),
  ]);
  return m;
}

/** Armas equipadas con su botón de ataque y de daño. */
function weaponButtons(ch, onRoll, items) {
  const weapons = (ch.inventory || []).filter((it) => it.kind === 'arma' && it.equipped);
  if (!weapons.length) return null;
  return [h('div.label-mini', 'Armas equipadas'), h('div.inv-list', weapons.map((it) => {
    const a = weaponAttack(ch, it);
    return h('div.inv-row.weapon-row',
      h('div.grow', h('b', it.name), h('div.tiny.muted', `${a.damage} ${a.dmgType}`.trim())),
      h('button.btn.small.primary', {
        title: 'Atacar a un objetivo (o solo tirar)',
        onclick: () => (items?.attack ? items.attack(it, a) : onRoll({ expr: `1d20${signed(a.toHit)}`, label: `Ataque con ${it.name}` })),
      }, `Ataque ${signed(a.toHit) || '+0'}`),
      h('button.btn.small', { title: 'Tirada de daño', onclick: () => onRoll({ expr: a.damage, label: `Daño (${it.name}${a.dmgType ? `, ${a.dmgType}` : ''})` }) }, 'Daño'));
  }))];
}

function loadBar(ch) {
  const e = encumbrance(ch);
  const pct = Math.min(100, (e.weight / e.capacity) * 100);
  return h(`div.load-bar.${LOAD_CLASS[e.level]}`, { title: LOAD_NOTE[e.level] || 'Carga normal' },
    h('i', { style: { width: `${pct}%` } }),
    h('span', `Carga ${e.weight} / ${e.capacity} lb${e.level === 'normal' ? '' : ` · ${e.level}`}`));
}

/**
 * Inventario en la hoja de juego. `items` (opcional) da las acciones: usar, gastar, soltar, pasar a la
 * barra, equipar, dar a otro y dar monedas.
 */
export function inventoryPanel(ch, items, onRoll) {
  const inv = ch.inventory || [];
  const coins = ch.coins || {};
  const hasCoins = Object.values(coins).some(Boolean);
  return [
    weaponButtons(ch, onRoll, items),
    inv.length || hasCoins ? h('div.label-mini', 'Inventario') : null,
    inv.length ? h('div.inv-list', inv.map((it) => h(`div.inv-row${it.equipped ? '.equipped' : ''}`, { title: it.note || '' },
      it.img ? h('img', { src: it.img, alt: '' }) : h('span.inv-dot', it.equipped ? '⛨' : '◆'),
      h('div.grow',
        h('b', it.name), it.qty > 1 ? h('small.muted', ` ×${it.qty}`) : null,
        it.equipped ? h('small.inv-tag', 'equipado') : null,
        h('div.tiny.muted', [it.weight ? `${it.weight * (it.qty || 1)} lb` : '', it.value ? formatGp(it.value) : '', it.note || ''].filter(Boolean).join(' · '))),
      items ? h('div.row',
        equippable(it) ? h('button.btn.small', { title: it.equipped ? 'Quitárselo' : 'Ponérselo', onclick: () => items.equip(it) }, it.equipped ? 'Quitar' : 'Equipar') : null,
        h('button.btn.small', { title: 'Usar (lo anuncia en el chat)', onclick: () => items.use(it) }, 'Usar'),
        h('button.btn.small.ghost', { title: 'Gastar uno', onclick: () => items.spend(it) }, '−1'),
        items.others.length ? h('button.btn.small.ghost', { title: 'Dárselo a otro personaje', onclick: () => items.give(it) }, '🤝') : null,
        h('button.btn.small.ghost', { title: 'Soltarlo en el mapa, junto a tu ficha', onclick: () => items.drop(it) }, '⬇'),
        h('button.btn.small.ghost', { title: 'Ponerlo en la barra de acciones', onclick: () => items.toBar(it) }, '⚔')) : null))) : null,
    hasCoins ? h('div.coins-row', h('span', `💰 ${coinsLine(coins)}`), h('small.muted', ` ≈ ${formatGp(coinsValueGp(coins))}`),
      items?.others.length ? h('button.btn.small.ghost', { onclick: () => items.giveCoins() }, '🤝 Dar') : null) : null,
    inv.length || hasCoins ? loadBar(ch) : null,
  ];
}

/** «Calculada: Cota de malla + Escudo» para el título de la casilla de CA. */
export function acSource(ch) {
  const r = computeAc(ch);
  return r ? `Calculada: ${r.source}` : 'CA escrita en la hoja';
}

/** Botín del DM: monedas repartidas entre los elegidos, o un objeto para uno solo. */
export function lootDialog({ characters, onGive }) {
  const picks = characters.map((ch) => [ch.id, h('input', { type: 'checkbox', checked: !ch.npc })]);
  const coinInputs = COINS.map(([k]) => [k, h('input.mod-input', { type: 'number', min: 0, max: 999999, value: 0 })]);
  const item = { name: h('input', { maxlength: 40, placeholder: 'Gema de fuego' }), qty: h('input.mod-input', { type: 'number', min: 1, max: 999, value: 1 }),
    weight: h('input.mod-input', { type: 'number', min: 0, step: 0.1, value: 0 }), value: h('input.mod-input', { type: 'number', min: 0, step: 0.01, value: 0 }),
    note: h('input', { maxlength: 400, placeholder: 'Qué es / qué hace' }) };
  let picked = null;
  const preset = h('select', {
    onchange: (e) => {
      picked = pickPreset(e.target.value);
      if (picked) { item.name.value = picked.name; item.weight.value = picked.weight || 0; item.value.value = picked.value || 0; item.note.value = picked.note || ''; }
    },
  }, h('option', { value: '' }, 'o elige de mis objetos / SRD…'), EQUIPMENT_PRESETS.map((p, i) => h('option', { value: i }, p.name)));
  const pickPreset = withMyObjects(preset);
  const chosen = () => picks.filter(([, box]) => box.checked).map(([id]) => id);
  const m = modal('🎁 Botín', [
    h('div.label-mini', 'Para'),
    h('div.loot-picks', characters.map((ch, i) => h('label.check', picks[i][1], h('span', ch.name)))),
    h('div.label-mini', 'Monedas (se reparten a partes iguales)'),
    h('div.coins-edit', coinInputs.map(([k, input]) => field(COINS.find(([c]) => c === k)[1], input))),
    h('div.row.end', h('button.btn.primary', {
      onclick: () => onGive({ toIds: chosen(), coins: Object.fromEntries(coinInputs.map(([k, input]) => [k, num(input.value)])) }, m),
    }, 'Repartir monedas')),
    h('div.label-mini', 'O un objeto (para un solo personaje)'),
    h('div.grid2', field('Nombre', item.name), field('Equipo', preset), field('Cantidad', item.qty), field('Peso (lb)', item.weight), field('Valor (po)', item.value), field('Nota', item.note)),
    h('div.row.end', h('button.btn.primary', {
      onclick: () => {
        const base = picked && picked.name === item.name.value ? picked : {};
        onGive({ toIds: chosen(), item: { ...base, name: item.name.value, qty: num(item.qty.value, 1), weight: num(item.weight.value), value: num(item.value.value), note: item.note.value } }, m);
      },
    }, 'Dar objeto')),
  ], { wide: true });
  return m;
}
