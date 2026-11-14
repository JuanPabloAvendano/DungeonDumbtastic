// Buscador de los libros (compendio): se usa en su propia página, en un panel de la mesa y dentro de
// la hoja para añadir conjuros a la barra. Busca mientras se escribe, también en español.
import { h, clear, toast } from './ui.js';
import { api } from './api.js';

const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 30;
const TYPES = [['', 'Todo'], ['conjuro', '✦ Conjuros'], ['monstruo', '🐉 Monstruos'], ['objeto', '💎 Objetos'], ['texto', '📜 Reglas']];
const TYPE_LABEL = { conjuro: 'Conjuro', monstruo: 'Monstruo', objeto: 'Objeto', texto: 'Pasaje' };
const ORDINAL = ['Truco', '1.º', '2.º', '3.º', '4.º', '5.º', '6.º', '7.º', '8.º', '9.º'];
const LANG_KEY = 'da.cp.lang';
// Datos cortos de cada resultado en español (el texto largo lo traduce el servidor).
const ES = {
  abjuration: 'abjuración', conjuration: 'conjuración', divination: 'adivinación', enchantment: 'encantamiento', evocation: 'evocación',
  illusion: 'ilusión', necromancy: 'nigromancia', transmutation: 'transmutación',
  common: 'común', uncommon: 'poco común', rare: 'raro', 'very rare': 'muy raro', legendary: 'legendario', artifact: 'artefacto',
  'rarity varies': 'rareza variable', armor: 'armadura', potion: 'poción', ring: 'anillo', rod: 'vara', scroll: 'pergamino',
  staff: 'bastón', wand: 'varita', weapon: 'arma', 'wondrous item': 'objeto maravilloso',
};
const castingEs = (t) => String(t || '').replace(/\bbonus action\b/, 'acción adicional').replace(/\baction\b/, 'acción').replace(/\breaction\b/, 'reacción')
  .replace(/\bminutes?\b/, (m) => (m.endsWith('s') ? 'minutos' : 'minuto')).replace(/\bhours?\b/, (m) => (m.endsWith('s') ? 'horas' : 'hora'));
const loadLang = () => { try { return localStorage.getItem(LANG_KEY) || 'es'; } catch { return 'es'; } };
const saveLang = (v) => { try { localStorage.setItem(LANG_KEY, v); } catch { /* sin almacenamiento */ } };

/** Línea de datos de un resultado según su tipo (en español si está activado). */
function metaLine(r, es) {
  const m = r.meta || {};
  const t = (v) => (es ? ES[v] || v : v);
  if (r.type === 'conjuro') return [m.level === 0 ? 'Truco' : `Nivel ${m.level}`, t(m.school), m.ritual ? 'ritual' : null, es ? castingEs(m.castingTime) : m.castingTime].filter(Boolean).join(' · ');
  if (r.type === 'monstruo') return [m.cr ? `VD ${m.cr}` : null, m.ac ? `CA ${m.ac}` : null, m.hp ? `${m.hp} PG` : null, (es && (m.kindEs || r.es?.kind)) || m.kind].filter(Boolean).join(' · ');
  if (r.type === 'objeto') return [t(m.rarity), t(m.category)].filter(Boolean).join(' · ');
  return 'Pasaje del libro';
}

/** Junta las líneas cortadas del PDF dentro de un párrafo (si la siguiente sigue la frase). */
/** Une las líneas que el PDF partió a mitad de frase. */
export const reflow = (text) => text.replace(/([^\n.:])\n(?=[a-z0-9(,])/g, '$1 ').replace(/-\n(?=[a-z])/g, '');

/** Marca en el texto las palabras buscadas, sin innerHTML (todo con nodos de texto). */
function highlighted(text, query) {
  const words = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || [];
  if (!words.length) return [text];
  const re = new RegExp(`(${words.map((w) => w.replace(/[^a-z0-9]/g, '')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? h('mark', part) : part));
}

/**
 * @param {{ type?:string, level?:number|null, actionsFor?:(entry:object)=>Array<[string, ()=>void]>, compact?:boolean }} opts
 *   actionsFor: botones que ofrece quien lo usa para una entrada abierta (añadir a la barra, crear NPC…).
 */
export function compendiumPanel({ type = '', level = null, actionsFor = () => [], compact = false } = {}) {
  let state = { q: '', type, level, book: '', lang: loadLang() };
  let books = [];
  let timer = null;
  let seq = 0;
  const input = h('input.cp-search', { type: 'search', placeholder: 'Busca un conjuro, monstruo, objeto o regla (también en español: «bola de fuego»)', autocomplete: 'off' });
  const chips = h('div.cp-chips');
  const filters = h('div.cp-filters');
  const results = h('div.cp-results');
  const detail = h('div.cp-detail.hidden');
  const root = h(`div.compendium${compact ? '.compact' : ''}`, h('div.cp-bar', input, chips, filters), results, detail);

  const renderFilters = () => {
    const es = state.lang === 'es';
    clear(chips, h(`button.chip.lang${es ? '.on' : ''}`, {
      type: 'button', title: es ? 'Traducción automática al español activada (clic para ver el original en inglés)' : 'Ver en español (traducción automática)',
      onclick: () => { state = { ...state, lang: es ? 'en' : 'es' }; saveLang(state.lang); renderFilters(); run(); },
    }, es ? '🇪🇸 Español' : '🇬🇧 Original'), TYPES.map(([k, label]) => h(`button.chip${state.type === k ? '.on' : ''}`, { type: 'button', onclick: () => { state = { ...state, type: k, level: k === 'conjuro' ? state.level : null }; renderFilters(); run(); } }, label)));
    clear(filters,
      state.type === 'conjuro' ? h('select.small', { onchange: (e) => { state = { ...state, level: e.target.value === '' ? null : Number(e.target.value) }; run(); } },
        h('option', { value: '' }, 'Todos los niveles'),
        ORDINAL.map((label, n) => h('option', { value: n, selected: state.level === n }, n ? `Nivel ${label}` : label))) : null,
      books.length > 1 ? h('select.small', { onchange: (e) => { state = { ...state, book: e.target.value }; run(); } },
        h('option', { value: '' }, 'Todos los libros'),
        books.map((b) => h('option', { value: b.id, selected: state.book === b.id }, b.short))) : null);
  };

  async function run() {
    clearTimeout(timer);
    state = { ...state, q: input.value.trim() };
    if (!state.q) return clear(results, h('p.tiny.muted', books.length ? `Libros: ${books.map((b) => b.short).join(', ')}. Escribe para buscar.` : ''));
    const mine = ++seq;
    const params = new URLSearchParams({ q: state.q, tipo: state.type, libro: state.book, limite: RESULT_LIMIT, lang: state.lang });
    if (state.level !== null) params.set('nivel', state.level);
    try {
      const res = await api.get(`/compendio/buscar?${params}`);
      // Si llegó tarde (ya se escribió otra cosa), se descarta.
      if (mine === seq) renderResults(res);
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderResults({ total, results: list }) {
    clear(results,
      list.length ? h('p.tiny.muted', `${total} resultado${total === 1 ? '' : 's'}${total > list.length ? ` · se muestran ${list.length}` : ''}`) : h('p.muted', 'Nada con eso. Prueba otra palabra o quita filtros.'),
      list.map((r) => h('button.cp-item', { type: 'button', onclick: () => openEntry(r.id) },
        h('div.row.between', h('b', r.titleEs || r.title), h('span.tiny.muted', `${r.short} · p. ${r.page}`)),
        r.titleEs && r.titleEs !== r.title ? h('div.tiny.muted', r.title) : null,
        h('div.tiny', h(`span.cp-type.t-${r.type}`, TYPE_LABEL[r.type]), ' ', metaLine(r, state.lang === 'es')),
        h('p.cp-snippet', highlighted(r.snippet, state.q)))));
  }

  async function openEntry(id) {
    const es = state.lang === 'es';
    results.classList.add('hidden');
    detail.classList.remove('hidden');
    clear(detail, h('button.btn.small.ghost', { type: 'button', onclick: closeEntry }, '← Resultados'),
      h('p.muted', es ? '⏳ Traduciendo al español… (la primera vez tarda unos segundos)' : 'Cargando…'));
    try {
      const { entry } = await api.get(`/compendio/entrada/${encodeURIComponent(id)}?lang=${state.lang}`);
      renderEntry(entry, Boolean(entry.es));
    } catch (err) {
      closeEntry();
      toast(err.message, 'error');
    }
  }

  /** Muestra una entrada; con traducción, se puede alternar con el original. */
  function renderEntry(entry, showEs) {
    const es = showEs && entry.es;
    const buttons = actionsFor(es ? entry : { ...entry, es: null });
    clear(detail,
      h('div.row.between', h('button.btn.small.ghost', { type: 'button', onclick: closeEntry }, '← Resultados'), h('span.tiny.muted', `${entry.short} · página ${entry.page}`)),
      h('h3.cp-title', es ? entry.es.title : entry.title),
      es && entry.es.title !== entry.title ? h('div.tiny.muted', entry.title) : null,
      h('div.tiny', h(`span.cp-type.t-${entry.type}`, TYPE_LABEL[entry.type]), ' ', metaLine(entry, Boolean(es))),
      entry.es ? h('div.row.cp-lang-note', h('span.tiny.muted', es ? '🇪🇸 Traducción automática (puede tener errores)' : '🇬🇧 Texto original'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => renderEntry(entry, !showEs) }, es ? 'Ver original' : 'Ver en español')) : null,
      entry.esError ? h('p.tiny.muted', entry.esError) : null,
      buttons.length ? h('div.row.wrap', buttons.map(([label, fn]) => h('button.btn.small.primary', { type: 'button', onclick: fn }, label))) : null,
      // Página aparte marcada en inglés: el navegador ofrece «Traducir página» (Firefox lo hace sin internet).
      h('button.btn.small.ghost', { type: 'button', title: 'Abre el original en una pestaña aparte para que el navegador lo traduzca', onclick: () => window.open(`/leer.html?id=${encodeURIComponent(entry.id)}`, '_blank') }, '🌐 Traducir con el navegador'),
      h('div.cp-text', highlighted(es ? entry.es.text : reflow(entry.text), state.q)));
    detail.scrollTop = 0;
  }

  function closeEntry() {
    detail.classList.add('hidden');
    results.classList.remove('hidden');
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  renderFilters();
  api.get('/compendio/estado').then((res) => {
    books = res.books;
    renderFilters();
    if (!books.length) {
      clear(results, h('div.cp-empty',
        h('p', 'Todavía no hay libros importados.'),
        h('p.tiny.muted', 'Quien lleva el servidor los importa una vez desde sus PDF: ', h('code', 'npm run compendio -- "Player\'s Handbook.pdf" …'), '. Se guardan solo en la carpeta de datos, no se publican.')));
    } else run();
  }).catch((err) => toast(err.message, 'error'));
  setTimeout(() => input.focus(), 0);
  return { el: root, focus: () => input.focus(), search: (q) => { input.value = q; run(); } };
}
