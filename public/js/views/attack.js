// Atacar desde la mesa: elegir objetivo y modo, y responder a la ventana de reacción cuando te atacan.
import { h, clear, field, modal, signed } from '../ui.js';

/**
 * Diálogo de ataque: objetivo (fichas a la vista, sin la propia), normal/ventaja/desventaja.
 * `onAttack({ targetId, mode })` lo envía; «Tirar sin objetivo» solo tira el dado.
 */
export function openAttackDialog({ weapon, toHit, damage, targets, onAttack, onPlainRoll }) {
  if (!targets.length) return onPlainRoll();
  const target = h('select', targets.map((t) => h('option', { value: t.id }, t.name)));
  const pick = (mode) => { onAttack({ targetId: target.value, mode }); m.close(); };
  const m = modal(`⚔ Atacar con ${weapon}`, [
    h('p.muted.tiny', `Ataque ${signed(toHit) || '+0'} · daño ${damage}. Si impacta, el daño se aplica solo al objetivo.`),
    field('Objetivo', target),
    h('div.row.end',
      h('button.btn.ghost', { onclick: () => { onPlainRoll(); m.close(); } }, 'Tirar sin objetivo'),
      h('button.btn.ghost', { onclick: () => pick('dis') }, 'Desventaja'),
      h('button.btn.primary', { onclick: () => pick('normal') }, 'Atacar'),
      h('button.btn.ghost', { onclick: () => pick('adv') }, 'Ventaja')),
  ]);
  return m;
}

/** Te atacan: unos segundos para usar tu reacción (Escudo +5 CA o Esquiva asombrosa: mitad de daño). */
export function openReactionPrompt(attack, onReact) {
  let left = Math.round(attack.seconds);
  let done = false;
  const clock = h('b.reaction-clock', String(left));
  const answer = (kind) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    onReact(kind);
    m.close();
  };
  const m = modal('⚠ ¡Te atacan!', [
    h('p', `${attack.attacker} ataca a ${attack.target}: `, h('b', attack.crit ? '¡crítico!' : `${attack.total} contra tu CA ${attack.ac}`), '. Impacta.'),
    h('p.muted.tiny', '¿Usas tu reacción? Solo una por ronda. Quedan ', clock, ' s; si no eliges, recibes el daño completo.'),
    h('div.row.end',
      h('button.btn.ghost', { onclick: () => answer('ninguna') }, 'No reaccionar'),
      h('button.btn', { title: 'Mitad de daño (pícaro, nivel 5+)', onclick: () => answer('esquiva') }, '💨 Esquiva asombrosa'),
      h('button.btn.primary', { title: '+5 CA contra este ataque (conjuro de nivel 1)', disabled: attack.crit, onclick: () => answer('escudo') }, '✨ Escudo (+5 CA)')),
  ], { onClose: () => { if (!done) { done = true; clearInterval(timer); } } });
  const timer = setInterval(() => {
    left -= 1;
    clear(clock, String(Math.max(0, left)));
    if (left <= 0) { clearInterval(timer); done = true; m.close(); }
  }, 1000);
  return m;
}
