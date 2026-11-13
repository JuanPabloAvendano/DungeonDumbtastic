// Los libros van a dos columnas: pdftotext a secas a veces mezcla una línea de cada una (y separa el
// nombre de un conjuro de su nivel). Con -layout se conserva la posición, y aquí se corta cada página
// por el canal en blanco entre columnas para leer primero la izquierda y luego la derecha.
const MIN_WIDTH = 60;
const GUTTER_FROM = 0.35;
const GUTTER_TO = 0.65;
// Un canal válido atraviesa la mayoría de las líneas con texto de la página.
const GUTTER_COVERAGE = 0.6;
const SHORT_LINE_WEIGHT = 0.5;

/** Columna del canal, o -1 si la página no va a dos columnas. */
function findGutter(lines) {
  const width = Math.max(0, ...lines.map((l) => l.length));
  if (width < MIN_WIDTH) return -1;
  const filled = lines.filter((l) => l.trim()).length;
  let best = -1;
  let bestScore = 0;
  for (let x = Math.floor(width * GUTTER_FROM); x <= Math.floor(width * GUTTER_TO); x++) {
    let score = 0;
    for (const l of lines) {
      if (l.length > x + 2 && l.slice(x - 1, x + 2) === '   ') score += 1;
      else if (l.trim() && l.length <= x) score += SHORT_LINE_WEIGHT;
    }
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return bestScore >= filled * GUTTER_COVERAGE ? best : -1;
}

/** Texto de una página (salida de pdftotext -layout) en orden de lectura. */
function splitColumns(page) {
  const lines = page.split('\n');
  const x = findGutter(lines);
  const tidy = (l) => l.trim().replace(/\s{2,}/g, ' ');
  if (x < 0) return lines.map(tidy).join('\n');
  return [...lines.map((l) => tidy(l.slice(0, x))), '', ...lines.map((l) => tidy(l.slice(x)))].join('\n');
}

module.exports = { splitColumns, findGutter };
