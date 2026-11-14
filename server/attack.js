// Ataque contra CA (SRD 5.1): impacto, crítico y pifia, reacciones del objetivo y daño aplicado.
// Funciones puras: reciben datos y devuelven resultados o copias nuevas.

const DEFAULT_AC = 10;
const SHIELD_BONUS = 5;
/** Tirada de ataque válida: 1d20 con modificador opcional. */
const TO_HIT_RE = /^1?d20([+-]\d{1,2})?$/i;

/** ¿Impacta? 20 natural: siempre y crítico. 1 natural: nunca. Si no, total ≥ CA. */
function resolveHit({ total, natural }, ac) {
  if (natural === 20) return { hit: true, crit: true };
  if (natural === 1) return { hit: false, crit: false };
  return { hit: total >= ac, crit: false };
}

/** Crítico: se doblan los dados, no los modificadores. «1d8+3» → «2d8+3». */
const critExpr = (expr) => String(expr).replace(/(\d*)d(\d+)/gi, (_, n, sides) => `${2 * (Number(n) || 1)}d${sides}`);

/**
 * Qué cambia la reacción del objetivo: Escudo (+5 CA, puede convertir el impacto en fallo salvo
 * crítico) o Esquiva asombrosa (mitad de daño).
 */
function reactionOutcome({ total, ac, crit }, kind) {
  if (kind === 'escudo') return { hit: crit || total >= ac + SHIELD_BONUS, halve: false };
  return { hit: true, halve: kind === 'esquiva' };
}

const targetAc = (token, characters) => {
  const ch = token.characterId && characters.find((c) => c.id === token.characterId);
  return ch ? ch.ac ?? DEFAULT_AC : token.ac ?? DEFAULT_AC;
};

/** Baja los PG de la ficha (y de la hoja, si es un personaje) sin pasar de 0. */
function applyDamage(tokens, characters, tokenId, amount) {
  const token = tokens.find((t) => t.id === tokenId);
  const ch = token?.characterId ? characters.find((c) => c.id === token.characterId) : null;
  const hp = Math.max(0, (ch ? ch.hp : token.hp) - amount);
  return {
    tokens: tokens.map((t) => (t.id === tokenId ? { ...t, hp } : t)),
    character: ch ? { ...ch, hp } : null,
    hp,
  };
}

module.exports = { resolveHit, critExpr, reactionOutcome, applyDamage, targetAc, TO_HIT_RE, SHIELD_BONUS };
