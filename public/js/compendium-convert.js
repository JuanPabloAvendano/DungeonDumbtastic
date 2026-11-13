// De una entrada de los libros a algo usable en la mesa: un conjuro u objeto a la barra de acciones,
// un monstruo a un NPC con su hoja y sus ataques, un pasaje a un rasgo pasivo.
import { mod, signed } from './ui.js';

const NOTE_MAX = 400;
// Característica con la que lanza conjuros cada clase (en español y en inglés).
const CASTING = [
  [['mago', 'wizard', 'artifice'], 'int'],
  [['clerigo', 'cleric', 'druida', 'druid', 'explorador', 'ranger', 'monje', 'monk'], 'wis'],
  [['bardo', 'bard', 'hechicero', 'sorcerer', 'brujo', 'warlock', 'paladin'], 'cha'],
];
const SAVE_ES = { strength: 'FUE', dexterity: 'DES', constitution: 'CON', intelligence: 'INT', wisdom: 'SAB', charisma: 'CAR' };
const DAMAGE_TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const proficiency = (level) => 2 + Math.floor((Math.max(1, level || 1) - 1) / 4);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Característica de lanzamiento del personaje según su clase (si no se reconoce, su mejor mental). */
export function castingAbility(ch) {
  const c = plain(ch?.cls);
  const found = CASTING.find(([names]) => names.some((n) => c.includes(n)));
  if (found) return found[1];
  const s = ch?.stats || {};
  return ['int', 'wis', 'cha'].sort((a, b) => (s[b] || 10) - (s[a] || 10))[0];
}

/** Bono de ataque con conjuros y CD de salvación del personaje. */
export function spellNumbers(ch) {
  const m = mod(ch?.stats?.[castingAbility(ch)] ?? 10);
  const p = proficiency(ch?.level);
  return { attack: m + p, dc: 8 + m + p };
}

/** El primer «8d6 fire» / «1d10 force» del texto: dados y tipo de daño. */
function firstDamage(text) {
  const m = text.match(new RegExp(`(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+(${DAMAGE_TYPES})?`, 'i'));
  return m ? { damage: m[1].replace(/\s+/g, ''), damageType: (m[2] || '').toLowerCase() } : { damage: '', damageType: '' };
}

/** Descripción sin las líneas de cabecera (nivel, tiempo, alcance…), recortada; vale para el original y la traducción. */
function description(text) {
  const header = /^(\d\w{2}-level|\w+ cantrip|casting tim|range:|com\s*ponents:|duration:|tiempo de lanzamiento:|alcance:|componentes:|duración:|truco de|\S+ de nivel \d)/i;
  const body = text.split('\n').filter((l) => !header.test(l.trim()));
  return oneLine(body.join(' ')).slice(0, NOTE_MAX);
}

/** Conjuro → acción de la barra: tipo según el tiempo de lanzamiento, ataque o salvación con sus números. */
export function spellToAction(entry, ch) {
  const m = entry.meta || {};
  const ct = plain(m.castingTime);
  const kind = ct.includes('bonus') ? 'bonus' : ct.includes('reaction') ? 'reaction' : 'action';
  const { attack, dc } = spellNumbers(ch);
  const isAttack = /(ranged|melee) spell attack/i.test(entry.text);
  const save = entry.text.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i);
  const head = [m.castingTime, m.range, m.duration].filter(Boolean).join(' · ');
  const saveNote = save ? `Salvación de ${SAVE_ES[save[1].toLowerCase()]} CD ${dc}. ` : '';
  return {
    id: newId(),
    name: (entry.es?.title || entry.title).slice(0, 40),
    kind,
    spellLevel: Number.isInteger(m.level) ? m.level : null,
    attack: isAttack ? `1d20${signed(attack)}` : '',
    ...firstDamage(entry.text),
    uses: null,
    note: `${head ? `${head}. ` : ''}${saveNote}${description(entry.es?.text || entry.text)}`.slice(0, NOTE_MAX),
  };
}

/** Objeto mágico o pasaje → rasgo (pasivo por defecto) con su texto como nota. */
export function entryToFeature(entry, kind = 'passive') {
  return { id: newId(), name: (entry.es?.title || entry.title).slice(0, 40), kind, spellLevel: null, attack: '', damage: '', damageType: '', uses: null, note: description(entry.es?.text || entry.text) };
}

/** Monstruo → hoja de NPC: CA, PG, velocidad, características y sus ataques en la barra. */
export function monsterToCharacter(entry) {
  const m = entry.meta || {};
  const speed = Number((m.speed || '').match(/\d+/)?.[0]) || 30;
  return {
    name: (entry.es?.title || entry.title).slice(0, 40),
    race: oneLine(entry.es?.kind || m.kind).slice(0, 30),
    cls: m.cr ? `VD ${m.cr}` : '',
    level: 1,
    ac: m.ac || 10,
    hp: m.hp || 10,
    maxHp: m.hp || 10,
    speed,
    stats: m.stats || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    notes: `${entry.short} · p. ${entry.page}\n${oneLine(entry.es?.text || entry.text).slice(0, 3500)}`,
    actions: (m.actions || []).map((a) => ({ id: newId(), kind: 'action', spellLevel: null, uses: null, note: '', ...a })),
  };
}
