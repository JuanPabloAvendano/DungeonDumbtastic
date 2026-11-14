// Página de lectura de una entrada del compendio en inglés (public/leer.html), para traducir con el
// navegador. Lo que no es texto del libro va con translate="no" para que el traductor no lo toque.
import { h, clear } from './ui.js';
import { api } from './api.js';
import { reflow } from './compendium.js';

const root = document.getElementById('reader');
const id = new URLSearchParams(location.search).get('id');

function note(text) {
  return h('p.tiny.muted', { translate: 'no', lang: 'es' }, text);
}

async function main() {
  if (!id) return clear(root, note('Falta qué entrada abrir.'));
  if (!api.hasToken()) return clear(root, note('Inicia sesión en la mesa y vuelve a abrir esta página desde el libro.'));
  try {
    const { entry } = await api.get(`/compendio/entrada/${encodeURIComponent(id)}`);
    document.title = `${entry.title} · ${entry.short}`;
    clear(root,
      note('Original en inglés. Para leerlo en español: clic derecho → «Traducir al español» (Chrome/Edge), o el icono de traducción en la barra de direcciones (Firefox, sin internet).'),
      h('h1.reader-title', entry.title),
      h('div.tiny.muted', { translate: 'no' }, `${entry.short} · p. ${entry.page}`),
      h('div.reader-text', reflow(entry.text)));
  } catch (err) {
    clear(root, note(`No se pudo abrir: ${err.message}`));
  }
}

main();
