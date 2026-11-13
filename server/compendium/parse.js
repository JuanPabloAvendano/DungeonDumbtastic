// Trocea el texto de un libro (ya reparado) en entradas consultables: conjuros, monstruos con su
// bloque de estadísticas, objetos mágicos y, para todo lo demás, pasajes por página con su título.
const SCHOOLS = 'abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation';
const LEVEL_RE = new RegExp(`^(\\d)(?:st|nd|rd|th)-level (${SCHOOLS})( \\(ritual\\))?$`, 'i');
const CANTRIP_RE = new RegExp(`^(${SCHOOLS}) cantrip$`, 'i');
const SIZE_RE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b[^,]{2,60},\s*\S/;
const ITEM_RE = /^(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous item)\b[^,]{0,60},\s*(common|uncommon|rare|very rare|legendary|artifact|rarity varies)/i;
const ABILITY_RE = /(\d{1,2})\s*\(\s*([+\-−–])\s*(\d+)\s*\)/g;
const CHUNK_CHARS = 900;
const MIN_CHUNK_CHARS = 120;
const TITLE_MAX = 60;
const LOOKBACK_LINES = 4;

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** El OCR a veces separa el número del ordinal: «8 th-level» → «8th-level». */
const normalizeLevel = (line) => line.replace(/(\d)\s+(st|nd|rd|th)\b/gi, '$1$2').replace(/\s+/g, ' ').trim();

/** Línea que parece un nombre propio de entrada: corta, sin punto final, empieza en mayúscula. */
function looksLikeName(line) {
  const t = line.trim();
  return t.length >= 2 && t.length <= 48 && /^[A-Z]/.test(t) && !/[.:;]$/.test(t) && !/\d{2,}/.test(t);
}

/** Línea anterior no vacía, mirando como mucho unas pocas líneas atrás. */
function previousLine(lines, i) {
  for (let k = i - 1; k >= Math.max(0, i - LOOKBACK_LINES); k--) if (lines[k].trim()) return k;
  return -1;
}

/** «AMULET OF HEALTH» / «GoBLIN Boss» (versalitas del OCR) → «Amulet of Health» / «Goblin Boss». */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'or', 'a', 'an', 'in', 'on', 'to', 'from', 'with', 'for']);
function titleCase(s, raw = s) {
  const letters = raw.replace(/[^A-Za-z]/g, '');
  const shouting = letters.length && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.5;
  return s.split(' ').map((w, i) => {
    // Palabra en mayúsculas sueltas (versalitas) o todo el título gritado: se normaliza.
    if (!shouting && !/[A-Z]/.test(w.slice(1))) return w;
    const low = w.toLowerCase();
    return i > 0 && SMALL_WORDS.has(low) ? low : low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ');
}

// Encabezados de sección de los bloques y de los capítulos: no son nombres de criatura.
const SECTION_TITLES = /^(actions|reactions|legendary actions|lair actions|regional effects|variant|traits|dungeon survival|senses|languages|str|dex|con|int|wis|cha|a [a-z' ]+lair)\b/i;
/** Título que no sirve como nombre: sección del bloque o basura del OCR («B,u Leti:e»). */
const isSectionTitle = (t) => SECTION_TITLES.test(t.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[^a-z ]/g, '')) || /[,:;!~^]/.test(t);

/** Encabezado de la página (el nombre del monstruo suele estar arriba, en versalitas). */
function pageHeading(lines, from) {
  for (let k = from; k >= 0 && k > from - 200; k--) {
    const t = lines[k].trim();
    if (t === '\f') break;
    if (t.length >= 3 && t.length <= 30 && /^[A-Z][A-Za-z' -]+$/.test(t) && t.replace(/[^A-Z]/g, '').length >= t.length * 0.5 && !isSectionTitle(t)) return t;
  }
  return null;
}

// ---------------------------------------------------------------- detección de cabeceras
function spellHeader(lines, i) {
  const lvl = normalizeLevel(lines[i]);
  const m = lvl.match(LEVEL_RE);
  const c = !m && lvl.match(CANTRIP_RE);
  if (!m && !c) return null;
  const next = lines.slice(i + 1, i + 4).find((l) => l.trim());
  if (!next || !/^Casting Tim\s*e/i.test(next.trim())) return null;
  const n = previousLine(lines, i);
  if (n < 0 || !looksLikeName(lines[n])) return null;
  return {
    start: n, type: 'conjuro', title: clean(lines[n]),
    meta: { level: m ? Number(m[1]) : 0, school: (m ? m[2] : c[1]).toLowerCase(), ritual: Boolean(m && m[3]) },
  };
}

function monsterHeader(lines, i) {
  if (!SIZE_RE.test(lines[i].trim())) return null;
  const ahead = lines.slice(i + 1, i + 5).join(' ');
  if (!/Armor Class/i.test(ahead)) return null;
  const n = previousLine(lines, i);
  const named = n >= 0 && looksLikeName(lines[n]) && !/^\d/.test(lines[n].trim()) && !isSectionTitle(lines[n]);
  // Con dos columnas el nombre puede quedar lejos del bloque: se usa el encabezado de la página.
  const title = named ? clean(lines[n]) : pageHeading(lines, i);
  if (!title) return null;
  return { start: named ? n : i, type: 'monstruo', title, meta: { kind: clean(lines[i]) } };
}

function itemHeader(lines, i) {
  const m = lines[i].trim().match(ITEM_RE);
  if (!m) return null;
  const n = previousLine(lines, i);
  if (n < 0 || !looksLikeName(lines[n])) return null;
  return { start: n, type: 'objeto', title: clean(lines[n]), meta: { category: m[1].toLowerCase(), rarity: m[2].toLowerCase() } };
}

// ---------------------------------------------------------------- datos de cada tipo
function spellFields(text) {
  const field = (label) => (text.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i')) || [])[1]?.trim() || '';
  return { castingTime: field('Casting Tim\\s*e'), range: field('Range'), components: field('Com\\s*ponents'), duration: field('Duration') };
}

/** Ataques del bloque «Actions»: nombre, bono al ataque y daño, listos para la barra de acciones. */
function monsterActions(text) {
  const out = [];
  const re = /(?:^|\n)([A-Z][A-Za-z' ,()/-]{1,40})\.\s+(Melee|Ranged|Melee or Ranged) (?:Weapon|Spell) Attack:\s*\+\s*(\d+) to hit[\s\S]*?Hit:\s*\d+\s*\(([^)]+)\)\s*([a-z]+) damage/g;
  for (const m of text.matchAll(re)) {
    out.push({ name: clean(m[1]), attack: `1d20+${m[3]}`, damage: m[4].replace(/\s+/g, '').replace(/[−–]/g, '-'), damageType: m[5] });
  }
  return out;
}

function monsterFields(text) {
  const num = (re) => Number((text.match(re) || [])[1]) || null;
  const hp = text.match(/Hit Points\s+(\d+)\s*\(([^)]+)\)/i);
  const scores = [...text.slice(0, 1500).matchAll(ABILITY_RE)].slice(0, 6).map((m) => Number(m[1]));
  const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  return {
    ac: num(/Armor Class\s+(\d+)/i),
    hp: hp ? Number(hp[1]) : null,
    hitDice: hp ? hp[2].replace(/\s+/g, '') : '',
    speed: (text.match(/Speed\s+([^\n]+)/i) || [])[1]?.trim() || '',
    cr: (text.match(/Challenge\s+([\d/]+)/i) || [])[1] || '',
    stats: scores.length === 6 ? Object.fromEntries(keys.map((k, i) => [k, scores[i]])) : null,
    actions: monsterActions(text),
  };
}

// ---------------------------------------------------------------- pasajes generales
/** Título de un pasaje: la última línea con pinta de encabezado antes de él en la página. */
function headingBefore(lines, idx) {
  for (let k = idx; k >= 0; k--) {
    const t = lines[k].trim();
    if (t && t.length <= TITLE_MAX && /^[A-Z]/.test(t) && !/[.,;:]$/.test(t) && t.split(' ').length <= 7) return clean(t);
  }
  return null;
}

/** Dados partidos por el OCR: «8 d 6» / «1d 8» → «8d6» / «1d8». */
const fixDice = (text) => text.replace(/\b(\d+)\s?d\s?(\d+)\b/g, '$1d$2');

function pageChunks(pageText, page) {
  const lines = pageText.split('\n');
  const out = [];
  let buf = [];
  let size = 0;
  let startLine = 0;
  const flush = (end) => {
    const text = clean(buf.join('\n'));
    if (text.length >= MIN_CHUNK_CHARS) out.push({ type: 'texto', page, title: headingBefore(lines, startLine) || `Página ${page}`, text: buf.join('\n').trim() });
    buf = [];
    size = 0;
    startLine = end;
  };
  lines.forEach((l, i) => {
    buf.push(l);
    size += l.length;
    // Corta en un párrafo (línea en blanco) cuando ya hay bastante texto.
    if (size >= CHUNK_CHARS && !l.trim()) flush(i + 1);
  });
  flush(lines.length);
  return out;
}

/**
 * @param {string[]} pages texto de cada página (índice 0 = página 1 del PDF)
 * @param {{ id:string, title:string }} book
 * @returns {Array<{ id:string, type:string, title:string, page:number, text:string, meta:object }>}
 */
function parseBook(pages, book, { fixTitle = (t) => t } = {}) {
  const flat = [];
  pages.forEach((p, pi) => fixDice(p).split('\n').forEach((line) => flat.push({ line, page: pi + 1 })));
  const lines = flat.map((x) => x.line);
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const hd = spellHeader(lines, i) || monsterHeader(lines, i) || itemHeader(lines, i);
    if (hd && (!headers.length || hd.start > headers[headers.length - 1].start)) headers.push(hd);
  }
  const used = new Set();
  // Título final reparado; los que resultan ser encabezados de sección («ACTlONS») se descartan.
  const named = headers.map((hd) => ({ ...hd, title: titleCase(fixTitle(hd.title), hd.title) }))
    .filter((hd) => !isSectionTitle(hd.title) && !/^(actions?|act ions)$/i.test(hd.title.replace(/l/g, 'i')));
  const entries = named.map((hd, k, list) => {
    const end = k + 1 < list.length ? list[k + 1].start : Math.min(lines.length, hd.start + 200);
    const text = lines.slice(hd.start + 1, end).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const { title } = hd;
    let id = `${book.id}:${slug(title)}`;
    for (let n = 2; used.has(id); n++) id = `${book.id}:${slug(title)}-${n}`;
    used.add(id);
    const extra = hd.type === 'conjuro' ? spellFields(text) : hd.type === 'monstruo' ? monsterFields(text) : {};
    return { id, type: hd.type, title, page: flat[hd.start].page, text, meta: { ...hd.meta, ...extra } };
  });
  const chunks = pages.flatMap((p, pi) => pageChunks(fixDice(p), pi + 1)).map((c, i) => ({ ...c, id: `${book.id}:p${c.page}-${i}`, meta: {} }));
  return [...entries, ...chunks];
}

module.exports = { parseBook, monsterActions, spellHeader, monsterHeader, itemHeader, slug };
