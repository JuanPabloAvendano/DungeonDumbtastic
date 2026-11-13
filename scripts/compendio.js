// Importa libros en PDF propios al compendio consultable de la mesa (conjuros, monstruos, objetos y
// reglas). Lo importado se guarda en DATA_DIR/compendio/, NUNCA en el repo: es contenido con derechos.
// Uso: npm run compendio -- "~/Downloads/Player's Handbook.pdf" "~/Downloads/Monster Manual.pdf" …
// Requiere pdftotext (paquete poppler). Con el servidor encendido, reinícialo para que cargue lo nuevo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DATA_DIR } = require('../server/db');
const ocr = require('../server/compendium/ocrfix');
const { parseBook, slug } = require('../server/compendium/parse');
const { splitColumns } = require('../server/compendium/columns');

const OUT_DIR = path.join(DATA_DIR, 'compendio');
const MAX_BUFFER = 256 * 1024 * 1024;
const BROKEN_RATIO = 0.06;
// Siglas habituales para citar («PHB · p. 241»); el resto usa el nombre del archivo.
const SHORT = { 'players-handbook': 'PHB', 'dungeon-masters-guide': 'DMG', 'monster-manual': 'MM' };

/** Texto del PDF página a página (separadas por \f), con las dos columnas ya en orden. */
function readPdf(file) {
  const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: MAX_BUFFER }).toString('utf8');
  return raw.split('\f').map(splitColumns).join('\f');
}

function main(files) {
  if (!files.length) {
    console.error('Uso: npm run compendio -- <libro.pdf> [<otro.pdf> …]');
    process.exit(1);
  }
  const books = files.map((file) => {
    const base = path.basename(file, path.extname(file));
    const id = slug(base).replace(/-s-/g, 's-');
    console.log(`Leyendo ${base}…`);
    return { file, id, title: base, short: SHORT[id] || base, raw: readPdf(file) };
  });
  // El vocabulario se aprende de todos a la vez: los libros limpios ayudan a reparar los rotos.
  const vocab = ocr.buildVocabulary(books.map((b) => b.raw));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const b of books) {
    const broken = ocr.brokenRatio(b.raw);
    const pages = ocr.fixText(b.raw, vocab).split('\f');
    // Los títulos en versalitas también salen partidos («HEA LTH»): se reparan con el mismo vocabulario.
    // En un libro ya reparado entero no se vuelve a tocar; solo se juntan trozos, nunca se parte una palabra.
    const fixTitle = broken > BROKEN_RATIO ? (t) => t : (t) => ocr.fixLine(t.toLowerCase(), vocab, { singles: false }).replace(/\s+/g, ' ').trim();
    const entries = parseBook(pages, b, { fixTitle });
    const count = (t) => entries.filter((e) => e.type === t).length;
    const out = { id: b.id, title: b.title, short: b.short, importedAt: new Date().toISOString(), pages: pages.length, entries };
    fs.writeFileSync(path.join(OUT_DIR, `${b.id}.json`), JSON.stringify(out));
    const ocrNote = broken > BROKEN_RATIO ? `reparado (${Math.round(broken * 100)} % de fragmentos)` : 'limpio';
    console.log(`  ${b.short}: ${pages.length} páginas · OCR ${ocrNote} · ${count('conjuro')} conjuros · `
      + `${count('monstruo')} monstruos · ${count('objeto')} objetos · ${count('texto')} pasajes`);
  }
  console.log(`Guardado en ${OUT_DIR}`);
}

main(process.argv.slice(2).map((f) => f.replace(/^~(?=\/)/, process.env.HOME)));
