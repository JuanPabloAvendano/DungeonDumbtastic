// Cómo se pinta cada entrada del chat y del historial de tiradas.
import { h, signed, clock } from '../ui.js';

export function chatEntry(e, myId) {
  return h(`div.msg${e.userId === myId ? '.mine' : ''}${e.dialog ? '.dialog' : ''}`,
    h('div.msg-head', e.img ? h('img.msg-img', { src: e.img, alt: '' }) : null, h('b', e.name),
      e.as && e.by ? h('span.tiny.muted', `· ${e.by}`) : null, h('span.tiny.muted', clock(e.at))),
    h('p', e.text));
}

export function rollEntry(e) {
  const r = e.result;
  const chips = r.groups.flatMap((g) => g.values.map((v, i) => h(`span.die-chip${g.kept[i] ? '' : '.dropped'}${g.sides === 20 && v === 20 ? '.crit' : ''}${g.sides === 20 && v === 1 ? '.fumble' : ''}`,
    { title: `d${g.sides}` }, v)));
  return h(`div.roll-card${e.success === true ? '.success' : ''}${e.success === false ? '.fail' : ''}${e.hidden ? '.secret' : ''}`,
    h('div.roll-total', r.total),
    h('div.roll-main',
      h('div.msg-head', h('b', e.name), e.as && e.by ? h('span.tiny.muted', `· ${e.by}`) : null, e.hidden ? h('span.badge.small', 'oculta') : null, h('span.tiny.muted', clock(e.at))),
      h('div.roll-label', e.label || 'Tirada', e.mode ? h('small', e.mode === 'adv' ? ' · ventaja' : ' · desventaja') : null),
      h('div.roll-detail', h('code', r.expr), chips, r.modifier ? h('span.mod', signed(r.modifier)) : null),
      e.dc ? h('div.roll-verdict', `CD ${e.dc} · ${e.natural === 20 ? '¡Crítico!' : e.natural === 1 ? 'Pifia' : e.success ? 'Éxito' : 'Fallo'}`) : null));
}
