// Hoja de personaje: se usa en el lobby (editar) y en la mesa (tirar con un clic).
import { h, clear, field, mod, signed, ABILITIES, SKILLS, pickImage } from './ui.js';
import { api } from './api.js';
import { actionsEditor } from './actions.js';
import { inventoryEditor, inventoryPanel, acSource } from './inventory-ui.js';
import { voiceEditor } from './voice-ui.js';

export const DEMO_PORTRAITS = ['guerrero', 'maga', 'picaro', 'clerigo', 'goblin', 'esqueleto', 'lobo']
  .map((n) => `/assets/demo/token-${n}.svg`);

export function proficiency(level) {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/** Formulario editable. onSave recibe el objeto listo para la API. */
export function sheetForm(character, { campaigns = [], onSave }) {
  const c = structuredClone(character || {
    name: '', race: '', cls: '', level: 1, ac: 12, hp: 10, maxHp: 10, speed: 30, vision: 6,
    portrait: DEMO_PORTRAITS[0], notes: '', stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, campaignId: null,
  });
  c.baseAc = c.baseAc ?? c.ac;
  const portrait = h('img.sheet-portrait', { src: c.portrait || DEMO_PORTRAITS[0], alt: '' });
  const input = (key, type = 'text', attrs = {}) => h('input', {
    type, value: c[key] ?? '', ...attrs,
    oninput: (e) => { c[key] = type === 'number' ? Number(e.target.value) : e.target.value; },
  });

  const statInputs = ABILITIES.map(([k, short]) => {
    const out = h('small', signed(mod(c.stats[k])));
    return h('label.stat-edit', h('span', short),
      h('input', {
        type: 'number', min: 1, max: 30, value: c.stats[k],
        oninput: (e) => { c.stats[k] = Number(e.target.value); out.textContent = signed(mod(c.stats[k])); },
      }), out);
  });

  const choices = h('div.portrait-choices', DEMO_PORTRAITS.map((src) => h('img', {
    src, alt: '', onclick: () => { c.portrait = src; portrait.src = src; },
  })));

  return h('form.sheet-form', {
    onsubmit: (e) => { e.preventDefault(); onSave(c); },
  },
  h('div.sheet-top',
    h('div.portrait-pick', portrait,
      h('button.btn.small', {
        type: 'button',
        onclick: async () => {
          const url = await pickImage(api);
          if (url) { c.portrait = url; portrait.src = url; }
        },
      }, 'Subir retrato')),
    h('div.grid2',
      field('Nombre', input('name', 'text', { required: true, maxlength: 40, placeholder: 'Thorin Barbapiedra' })),
      field('Raza', input('race', 'text', { maxlength: 30, placeholder: 'Enano' })),
      field('Clase', input('cls', 'text', { maxlength: 30, placeholder: 'Guerrero' })),
      field('Nivel', input('level', 'number', { min: 1, max: 20 })),
      field('CA sin armadura', input('baseAc', 'number', { min: 0, max: 40, title: 'Si equipa armadura o escudo, la CA se calcula sola' })),
      field('Velocidad', input('speed', 'number', { min: 0, max: 200 })),
      field('Visión (casillas · la ajusta el DM)', input('vision', 'number', { min: 0, max: 60, title: 'Hasta dónde ve con niebla de guerra: 6 casillas = 30 pies' })),
      field('PG actuales', input('hp', 'number', { min: -99, max: 999 })),
      field('PG máximos', input('maxHp', 'number', { min: 1, max: 999 })))),
  h('div.label-mini', 'O elige un retrato de ejemplo'), choices,
  h('div.stats-edit', statInputs),
  campaigns.length ? field('Campaña', h('select', {
    onchange: (e) => { c.campaignId = e.target.value || null; },
  }, h('option', { value: '' }, '— Sin campaña —'),
  campaigns.map((cp) => h('option', { value: cp.id, selected: cp.id === c.campaignId }, cp.name)))) : null,
  actionsEditor(c),
  inventoryEditor(c),
  voiceEditor(c),
  field('Notas / rasgos', h('textarea', { rows: 4, maxlength: 4000, oninput: (e) => { c.notes = e.target.value; } }, c.notes || '')),
  h('div.row.end', h('button.btn.primary', { type: 'submit' }, 'Guardar personaje')));
}

/** Hoja de juego: cada atributo/habilidad es un botón que tira 1d20 + modificador. */
export function playSheet(ch, { onRoll, onHp, items }) {
  const prof = proficiency(ch.level);
  const pct = Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100));
  return h('div.play-sheet',
    h('div.ps-head',
      h('img', { src: ch.portrait || DEMO_PORTRAITS[0], alt: '' }),
      h('div',
        h('h3', ch.name),
        h('p.muted', [ch.race, ch.cls].filter(Boolean).join(' · ') || 'Aventurero', ` · Nivel ${ch.level}`))),
    h('div.ps-vitals',
      h('div.vital', { title: acSource(ch) }, h('small', 'CA'), h('b', ch.ac)),
      h('div.vital', h('small', 'Vel.'), h('b', `${ch.speed}`)),
      h('div.vital', h('small', 'Comp.'), h('b', signed(prof))),
      h('button.vital.btn-like', { onclick: () => onRoll({ expr: `1d20${signed(mod(ch.stats.dex))}`, label: 'Iniciativa' }) },
        h('small', 'Inic.'), h('b', signed(mod(ch.stats.dex))))),
    h('div.ps-hp',
      h('div.hpbar', h('i', { style: { width: `${pct}%` } }), h('span', `${ch.hp} / ${ch.maxHp} PG`)),
      h('div.row',
        h('button.btn.small.danger', { onclick: () => onHp(-1) }, '−1'),
        h('button.btn.small.danger', { onclick: () => onHp(-5) }, '−5'),
        h('button.btn.small.ok', { onclick: () => onHp(1) }, '+1'),
        h('button.btn.small.ok', { onclick: () => onHp(5) }, '+5'))),
    h('div.label-mini', 'Pruebas de característica (clic para tirar)'),
    h('div.ps-stats', ABILITIES.map(([k, short, long]) => {
      const m = mod(ch.stats[k]);
      return h('button.ps-stat', {
        title: `Prueba de ${long}`,
        onclick: () => onRoll({ expr: `1d20${signed(m)}`, label: `Prueba de ${long}` }),
        oncontextmenu: (e) => { e.preventDefault(); onRoll({ expr: `1d20${signed(m + prof)}`, label: `Salvación de ${long}` }); },
      }, h('small', short), h('b', signed(m)), h('i', ch.stats[k]));
    })),
    h('p.tiny.muted', 'Clic derecho en una característica: tirada de salvación (con competencia).'),
    h('div.label-mini', 'Habilidades'),
    h('div.ps-skills', SKILLS.map(([name, k]) => {
      const m = mod(ch.stats[k]);
      return h('button.ps-skill', { onclick: () => onRoll({ expr: `1d20${signed(m)}`, label: name }) },
        h('span', name), h('b', signed(m)));
    })),
    inventoryPanel(ch, items, onRoll),
    ch.notes ? [h('div.label-mini', 'Notas'), h('p.ps-notes', ch.notes)] : null);
}
