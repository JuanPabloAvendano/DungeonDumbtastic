// Barra de acciones del personaje (estilo Baldur's Gate 3): acciones, adicionales, reacciones,
// conjuros con espacios por nivel y rasgos pasivos, listos para usar sin mirar el libro.
import { h, clear, mod, signed, confirmDialog, toast, modal } from './ui.js';
import { spellToAction, entryToFeature, castingAbility, spellNumbers } from './compendium-convert.js';

export const KIND = {
  action: { icon: '⚔', label: 'Acción' },
  bonus: { icon: '⚡', label: 'Acción adicional' },
  reaction: { icon: '↺', label: 'Reacción' },
  free: { icon: '✦', label: 'Gratis' },
  passive: { icon: '◈', label: 'Pasiva' },
};
const KIND_ORDER = ['action', 'bonus', 'reaction', 'free', 'passive'];
const RESET_LABEL = { short: 'descanso corto', long: 'descanso largo', none: 'no se recupera' };
const SPELL_LEVELS = 9;

// Espacios de conjuro del SRD 5.1 (lanzador completo) por nivel de personaje, del 1.º al 9.º nivel de conjuro.
const FULL_CASTER = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const FULL = ['bardo', 'clerigo', 'druida', 'hechicero', 'mago', 'bard', 'cleric', 'druid', 'sorcerer', 'wizard'];
const HALF = ['paladin', 'explorador', 'ranger'];
const PACT = ['brujo', 'warlock'];

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Pacto del brujo: [cuántos espacios, de qué nivel] según su nivel (se recuperan con descanso corto). */
function pactSlots(level) {
  if (level >= 17) return [4, 5];
  if (level >= 11) return [3, 5];
  if (level === 1) return [1, 1];
  return [2, Math.min(5, Math.ceil(level / 2))];
}

/**
 * Espacios de conjuro sugeridos por clase y nivel (SRD 5.1). null si la clase no lanza conjuros
 * o no se reconoce. Multiclase y subclases lanzadoras (caballero arcano…) se ajustan a mano.
 */
export function suggestSlots(cls, level) {
  const c = plain(cls);
  const lvl = Math.max(1, Math.min(20, Number(level) || 1));
  const toSlots = (row) => Object.fromEntries(row.map((max, i) => [i + 1, { max, used: 0 }]));
  if (FULL.some((k) => c.includes(k))) return toSlots(FULL_CASTER[lvl - 1]);
  if (HALF.some((k) => c.includes(k))) return lvl < 2 ? {} : toSlots(FULL_CASTER[Math.ceil(lvl / 2) - 1]);
  if (PACT.some((k) => c.includes(k))) {
    const [n, at] = pactSlots(lvl);
    return { [at]: { max: n, used: 0, pact: true } };
  }
  return null;
}

// Cuántos trucos y conjuros suele conocer cada clase por nivel (SRD 5.1). Es una guía, no un límite.
const CANTRIPS = { bardo: [2, 3, 4], clerigo: [3, 4, 5], druida: [2, 3, 4], hechicero: [4, 5, 6], brujo: [2, 3, 4], mago: [3, 4, 5] };
const KNOWN = {
  bardo: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  hechicero: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  brujo: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  explorador: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};
const PREPARED = { clerigo: 'wis', druida: 'wis', mago: 'int', paladin: 'cha' };
const CLASS_ALIASES = { bard: 'bardo', cleric: 'clerigo', druid: 'druida', sorcerer: 'hechicero', warlock: 'brujo', wizard: 'mago', ranger: 'explorador' };
const ABILITY_ES = { int: 'INT', wis: 'SAB', cha: 'CAR' };

/** Clase en la forma de las tablas (sin tildes, en español). */
function classKey(cls) {
  const c = plain(cls);
  const all = [...Object.keys(CANTRIPS), ...Object.keys(KNOWN), ...Object.keys(PREPARED)];
  return all.find((k) => c.includes(k)) || Object.entries(CLASS_ALIASES).find(([en]) => c.includes(en))?.[1] || null;
}

/** Pista de qué suele aprender el personaje a su nivel: guía para elegir, no se impone. */
export function classHints(ch) {
  const k = classKey(ch.cls);
  if (!k) return null;
  const lvl = Math.max(1, Math.min(20, Number(ch.level) || 1));
  const parts = [];
  if (CANTRIPS[k]) parts.push(`${CANTRIPS[k][lvl >= 10 ? 2 : lvl >= 4 ? 1 : 0]} trucos`);
  if (KNOWN[k]?.[lvl - 1]) parts.push(`${KNOWN[k][lvl - 1]} conjuros conocidos`);
  if (PREPARED[k]) {
    const m = mod(ch.stats?.[PREPARED[k]] ?? 10);
    const n = Math.max(1, m + (k === 'paladin' ? Math.floor(lvl / 2) : lvl));
    if (k !== 'paladin' || lvl >= 2) parts.push(`${n} conjuros preparados (${ABILITY_ES[PREPARED[k]]} + nivel${k === 'paladin' ? ' / 2' : ''})`);
  }
  const { attack, dc } = spellNumbers(ch);
  return `${ch.cls} nivel ${lvl}: ${parts.join(' · ') || 'no lanza conjuros a este nivel'} · ataque de conjuro ${signed(attack)}, CD ${dc} (${ABILITY_ES[castingAbility(ch)]})`;
}

/** Elegir conjuros, objetos o rasgos de los libros para la barra del borrador `c`. */
async function openBookPicker(c, onAdd) {
  // Se carga al abrirlo: el buscador habla con el servidor y la hoja no lo necesita para nada más.
  const { compendiumPanel } = await import('./compendium.js');
  const added = h('p.tiny.muted');
  let count = 0;
  const panel = compendiumPanel({
    type: 'conjuro',
    actionsFor: (entry) => {
      const add = (action) => { onAdd(action); count += 1; added.textContent = `Añadidos: ${count}. Sigue buscando o cierra la ventana.`; toast(`«${action.name}» añadido`, 'ok'); };
      if (entry.type === 'conjuro') return [['＋ Añadir a la barra', () => add(spellToAction(entry, c))]];
      if (entry.type === 'objeto') return [['＋ Añadir como objeto', () => add(entryToFeature(entry, 'action'))]];
      return [['＋ Añadir como rasgo pasivo', () => add(entryToFeature(entry, 'passive'))], ['＋ Como acción', () => add(entryToFeature(entry, 'action'))]];
    },
  });
  const hint = classHints(c);
  modal('Desde los libros', h('div.col', hint ? h('p.hint-line', '📖 ', hint) : null, added, panel.el), { wide: true });
}

/** Acciones que cualquiera puede hacer en combate (reglas básicas). */
export function basicActions(ch) {
  const str = mod(ch.stats?.str ?? 10);
  const prof = 2 + Math.floor((Math.max(1, ch.level || 1) - 1) / 4);
  return [
    { name: 'Ataque desarmado', kind: 'action', attack: `1d20${signed(str + prof)}`, damage: `${Math.max(1, 1 + str)}`, damageType: 'contundente', note: 'Puñetazo, patada o cabezazo.' },
    { name: 'Esquivar', kind: 'action', note: 'Hasta tu próximo turno, los ataques contra ti tienen desventaja y tus salvaciones de DES tienen ventaja.' },
    { name: 'Correr', kind: 'action', note: 'Ganas movimiento extra igual a tu velocidad este turno.' },
    { name: 'Destrabarse', kind: 'action', note: 'Tu movimiento no provoca ataques de oportunidad este turno.' },
    { name: 'Ayudar', kind: 'action', note: 'Un aliado tiene ventaja en su próxima prueba o ataque contra una criatura a 5 pies de ti.' },
    { name: 'Esconderse', kind: 'action', note: 'Haz una prueba de Destreza (Sigilo).' },
    { name: 'Ataque de oportunidad', kind: 'reaction', attack: `1d20${signed(str + prof)}`, note: 'Cuando una criatura hostil sale de tu alcance.' },
  ];
}

// ---------------------------------------------------------------- editor (dentro de la hoja)
/** Edita en el borrador `c` de la hoja sus acciones y espacios de conjuro. */
export function actionsEditor(c) {
  c.actions = c.actions || [];
  c.slots = c.slots || {};
  const box = h('div.actions-editor');

  const row = (a, i) => {
    const set = (k, v) => { c.actions = c.actions.map((x, j) => (j === i ? { ...x, [k]: v } : x)); };
    const inp = (k, attrs = {}) => h('input', { value: a[k] ?? '', ...attrs, oninput: (e) => set(k, e.target.value) });
    const current = () => c.actions[i];
    return h('div.ae-row',
      h('div.ae-main',
        inp('name', { placeholder: 'Nombre', maxlength: 40 }),
        h('select', { onchange: (e) => set('kind', e.target.value) },
          KIND_ORDER.map((k) => h('option', { value: k, selected: a.kind === k }, `${KIND[k].icon} ${KIND[k].label}`))),
        h('select', { title: '¿Es un conjuro?', onchange: (e) => set('spellLevel', e.target.value === '' ? null : Number(e.target.value)) },
          h('option', { value: '' }, 'No es conjuro'),
          h('option', { value: 0, selected: a.spellLevel === 0 }, 'Truco'),
          Array.from({ length: SPELL_LEVELS }, (_, n) => h('option', { value: n + 1, selected: a.spellLevel === n + 1 }, `Conjuro nv ${n + 1}`))),
        h('button.icon-btn.small', { type: 'button', title: 'Quitar', onclick: () => { c.actions = c.actions.filter((_, j) => j !== i); render(); } }, '✕')),
      h('div.ae-dice',
        inp('attack', { placeholder: 'Ataque: 1d20+5', maxlength: 30 }),
        inp('damage', { placeholder: 'Daño: 1d8+3', maxlength: 30 }),
        inp('damageType', { placeholder: 'Tipo: cortante…', maxlength: 20 }),
        h('input', {
          type: 'number', min: 0, max: 99, value: a.uses?.max || '', placeholder: 'Usos ∞', title: 'Usos (vacío = sin límite)',
          oninput: (e) => {
            const max = Number(e.target.value) || 0;
            set('uses', max ? { max, used: Math.min(current().uses?.used || 0, max), reset: current().uses?.reset || 'long' } : null);
          },
        }),
        h('select', { title: 'Los usos se recuperan con…', onchange: (e) => current().uses && set('uses', { ...current().uses, reset: e.target.value }) },
          Object.entries(RESET_LABEL).map(([k, l]) => h('option', { value: k, selected: (a.uses?.reset || 'long') === k }, l)))),
      h('textarea', { rows: 1, maxlength: 400, placeholder: 'Qué hace: alcance, salvación, efecto…', oninput: (e) => set('note', e.target.value) }, a.note || ''));
  };

  const slotsRow = () => h('div.ae-slots', Array.from({ length: SPELL_LEVELS }, (_, n) => {
    const lvl = n + 1;
    return h('label', h('small', `Nv ${lvl}`), h('input', {
      type: 'number', min: 0, max: 9, value: c.slots[lvl]?.max || 0,
      oninput: (e) => {
        const max = Number(e.target.value) || 0;
        const { [lvl]: prev, ...rest } = c.slots;
        c.slots = max ? { ...rest, [lvl]: { ...(prev || {}), max, used: Math.min(prev?.used || 0, max) } } : rest;
      },
    }));
  }));

  function render() {
    const basics = basicActions(c).filter((b) => !c.actions.some((a) => a.name === b.name));
    const hint = classHints(c);
    clear(box,
      h('div.label-mini', 'Acciones, conjuros y rasgos (barra de acciones)'),
      hint ? h('p.hint-line', '📖 ', hint) : null,
      c.actions.length ? c.actions.map(row) : h('p.tiny.muted', 'Todavía no hay acciones. Añade ataques, conjuros y rasgos de clase para usarlos con un clic en la mesa.'),
      h('div.row.wrap',
        h('button.btn.small', { type: 'button', onclick: () => { c.actions = [...c.actions, { id: newId(), name: '', kind: 'action', spellLevel: null }]; render(); } }, '+ Acción o conjuro'),
        h('button.btn.small.primary', {
          type: 'button', title: 'Busca conjuros, trucos, rasgos de clase u objetos en los libros y añádelos con un clic',
          onclick: () => openBookPicker(c, (action) => { c.actions = [...c.actions, action]; render(); }),
        }, '📖 Desde los libros'),
        basics.length ? h('button.btn.small.ghost', {
          type: 'button', title: 'Esquivar, Correr, Destrabarse, Ayudar, Esconderse, ataque desarmado y de oportunidad',
          onclick: () => { c.actions = [...c.actions, ...basics.map((b) => ({ ...b, id: newId(), spellLevel: null }))]; render(); },
        }, '+ Acciones básicas') : null),
      h('div.label-mini', 'Espacios de conjuro'),
      slotsRow(),
      h('button.btn.small.ghost', {
        type: 'button',
        onclick: () => {
          const s = suggestSlots(c.cls, c.level);
          if (!s) return toast('Esa clase no lanza conjuros (o no la reconozco): pon los espacios a mano.', 'info');
          c.slots = s;
          render();
        },
      }, '✦ Sugerir espacios por clase y nivel (SRD)'));
  }
  render();
  return box;
}

// ---------------------------------------------------------------- barra en la mesa
/**
 * @param {object} ch personaje que actúa
 * @param {{ onUse:(a:object, slotLevel:number|null)=>void, onDamage:(a:object)=>void, onSlots:(slots:object)=>void,
 *           onRest:(kind:'short'|'long')=>void, spent:{action?:boolean|string, bonus?:boolean|string, reaction?:boolean|string}|null }} hooks
 *   `spent`: economía del turno en combate (null fuera de combate). Un texto explica por qué no se puede.
 */
export function actionBar(ch, hooks) {
  const actions = ch.actions || [];
  const slots = ch.slots || {};
  const card = h('div.hb-card.hidden');
  const hideCard = () => card.classList.add('hidden');
  const left = (a) => (a.uses ? a.uses.max - a.uses.used : Infinity);
  const freeSlots = (min) => Object.entries(slots).filter(([lvl, s]) => Number(lvl) >= min && s.used < s.max).map(([lvl]) => Number(lvl));
  const blocked = (a) => {
    if (a.kind === 'passive') return 'Es pasiva: siempre está activa';
    if (left(a) <= 0) return `Sin usos: se recupera con ${RESET_LABEL[a.uses.reset]}`;
    if (a.spellLevel > 0 && !freeSlots(a.spellLevel).length) return `No te quedan espacios de nivel ${a.spellLevel} o superior`;
    const spent = hooks.spent?.[a.kind];
    if (spent) return typeof spent === 'string' ? spent : `Ya gastaste tu ${KIND[a.kind].label.toLowerCase()} este turno`;
    return null;
  };

  const showCard = (a) => {
    const why = blocked(a);
    const levels = a.spellLevel > 0 ? freeSlots(a.spellLevel) : [];
    const use = (lvl) => { hideCard(); hooks.onUse(a, lvl); };
    const mainLabel = a.attack ? '🎯 Atacar' : a.spellLevel !== null ? '✦ Lanzar' : 'Usar';
    clear(card,
      h('div.row.between', h('b', a.name), h('button.icon-btn.small', { onclick: hideCard }, '✕')),
      h('div.tiny.muted', [KIND[a.kind].label,
        a.spellLevel === 0 ? 'Truco' : a.spellLevel ? `Conjuro de nivel ${a.spellLevel}` : null,
        a.uses ? `${left(a)}/${a.uses.max} usos (${RESET_LABEL[a.uses.reset]})` : null].filter(Boolean).join(' · ')),
      a.note ? h('p.hb-note', a.note) : null,
      a.attack || a.damage ? h('div.row.wrap',
        a.attack ? h('code', `🎯 ${a.attack}`) : null,
        a.damage ? h('code', `💥 ${a.damage}${a.damageType ? ` ${a.damageType}` : ''}`) : null) : null,
      why ? h('p.tiny.hb-why', why) : null,
      a.kind === 'passive' ? null : h('div.row.wrap',
        levels.length > 1
          ? levels.map((lvl) => h('button.btn.small.primary', { disabled: Boolean(why), onclick: () => use(lvl) }, `Lanzar a nivel ${lvl}`))
          : h('button.btn.small.primary', { disabled: Boolean(why), onclick: () => use(levels[0] ?? null) }, mainLabel),
        a.damage && a.attack ? h('button.btn.small', { onclick: () => { hideCard(); hooks.onDamage(a); } }, '💥 Daño') : null));
    card.classList.remove('hidden');
  };

  const button = (a) => {
    const why = blocked(a);
    const badge = a.spellLevel > 0 ? String(a.spellLevel) : a.spellLevel === 0 ? '✧' : KIND[a.kind].icon;
    return h(`button.hb-btn.k-${a.kind}${why && a.kind !== 'passive' ? '.off' : ''}`, { title: `${a.name}${why ? ` · ${why}` : ''}`, onclick: () => showCard(a) },
      h('i', badge), h('span', a.name), a.uses ? h('small', `${left(a)}/${a.uses.max}`) : null);
  };

  const slotPips = Object.entries(slots).map(([lvl, s]) => h('div.hb-slot', {
    title: `Espacios de nivel ${lvl}${s.pact ? ' (pacto: vuelven con descanso corto)' : ''} · clic para gastar o recuperar`,
  },
  h('small', `Nv ${lvl}`),
  Array.from({ length: s.max }, (_, i) => {
    const available = i < s.max - s.used;
    return h(`button.pip${available ? '.on' : ''}`, {
      onclick: () => hooks.onSlots({ ...slots, [lvl]: { ...s, used: available ? s.used + 1 : Math.max(0, s.used - 1) } }),
    });
  })));

  const groups = KIND_ORDER.map((k) => actions.filter((a) => a.kind === k)).filter((g) => g.length);
  const restBtn = (kind, label, text) => h('button.btn.small.ghost', {
    title: text, onclick: async () => { if (await confirmDialog(`¿${ch.name} hace un ${RESET_LABEL[kind]}?`)) hooks.onRest(kind); },
  }, label);

  return h('div.hotbar',
    card,
    h('div.hb-groups', groups.length
      ? groups.map((g) => h(`div.hb-group.k-${g[0].kind}`, h('div.hb-label', KIND[g[0].kind].label), h('div.hb-row', g.map(button))))
      : h('p.tiny.muted', `${ch.name} aún no tiene acciones: añádelas en «✎ Editar hoja».`)),
    h('div.hb-side',
      slotPips.length ? h('div.hb-slots', slotPips) : null,
      h('div.row',
        restBtn('short', '☾ Corto', 'Descanso corto: recupera lo que vuelve con descanso corto y los espacios de pacto'),
        restBtn('long', '☀ Largo', 'Descanso largo: todos los usos, espacios de conjuro y PG al máximo'))));
}

/** Personaje tras gastar una acción: un uso y, si es conjuro, un espacio del nivel elegido. */
export function spend(ch, a, slotLevel) {
  const actions = (ch.actions || []).map((x) => (x.id === a.id && x.uses ? { ...x, uses: { ...x.uses, used: Math.min(x.uses.max, x.uses.used + 1) } } : x));
  const slots = { ...(ch.slots || {}) };
  if (slotLevel && slots[slotLevel]) slots[slotLevel] = { ...slots[slotLevel], used: Math.min(slots[slotLevel].max, slots[slotLevel].used + 1) };
  return { ...ch, actions, slots };
}

/** Personaje tras un descanso. El corto recupera lo «de descanso corto» y los espacios de pacto. */
export function rest(ch, kind) {
  const resets = kind === 'long' ? ['short', 'long'] : ['short'];
  const actions = (ch.actions || []).map((a) => (a.uses && resets.includes(a.uses.reset) ? { ...a, uses: { ...a.uses, used: 0 } } : a));
  const slots = Object.fromEntries(Object.entries(ch.slots || {}).map(([lvl, s]) => [lvl, kind === 'long' || s.pact ? { ...s, used: 0 } : s]));
  return { ...ch, actions, slots, hp: kind === 'long' ? ch.maxHp : ch.hp };
}
