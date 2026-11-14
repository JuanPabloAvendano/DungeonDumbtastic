// Buscar con qué personaje se habla en el chat: por cualquier parte del nombre, y con el atajo
// «@nombre mensaje». Sin DOM, para poder probarlo en Node. Cada opción es [valor, etiqueta].

/** Minúsculas, sin tildes ni espacios: «Élara Luna» → «elaraluna». */
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

/** Quita la coletilla de rol de la etiqueta: «Thorin (NPC)» → «Thorin». */
const bareName = (label) => String(label).replace(/\s*\((PJ|NPC|DM)\)$/, '');

/** Opciones cuyo nombre contiene lo buscado; primero las que empiezan por ello. */
export function findSpeakers(opts, query) {
  const q = norm(query);
  if (!q) return opts;
  const hits = opts.filter(([, label]) => norm(bareName(label)).includes(q));
  const starts = (label) => norm(bareName(label)).startsWith(q);
  return [...hits.filter(([, l]) => starts(l)), ...hits.filter(([, l]) => !starts(l))];
}

/**
 * «@thorin ¡A las armas!» → { value: 'c:1', text: '¡A las armas!' }. Null si no empieza por @, si
 * nadie encaja o si encajan varios y ninguno exactamente (así un @ dudoso no habla por quien no es).
 */
export function splitMention(opts, text) {
  const m = /^@(\S+)\s+([\s\S]+)$/.exec(String(text).trim());
  if (!m) return null;
  const q = norm(m[1]);
  const exact = opts.filter(([, label]) => norm(bareName(label)) === q);
  const hits = exact.length ? exact : findSpeakers(opts, m[1]);
  return hits.length === 1 ? { value: hits[0][0], text: m[2].trim() } : null;
}

/** Numera las etiquetas repetidas («Goblin», «Goblin 2»…) para que la lista y el @ las distingan. */
export function uniqueLabels(opts) {
  const seen = new Map();
  return opts.map(([value, label]) => {
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    return [value, n > 1 ? `${label} ${n}` : label];
  });
}
