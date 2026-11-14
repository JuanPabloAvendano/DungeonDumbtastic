// Utilidades de interfaz sin framework. Todo el texto entra con textContent (sin XSS).

/**
 * Crea un elemento: h('div.card#id', { onclick, title }, 'texto', otroNodo)
 * @returns {HTMLElement}
 */
export function h(spec, attrs = {}, ...children) {
  const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs instanceof Node || typeof attrs === 'string' || typeof attrs === 'number' || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function toast(text, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) box = document.body.appendChild(h('div#toasts'));
  const t = h(`div.toast.${kind}`, text);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/** Modal sencillo. Devuelve { close, el }. */
export function modal(title, body, { wide = false, onClose } = {}) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    onClose?.();
  };
  const back = h('div.modal-back', { onmousedown: (e) => e.target === back && close() },
    h(`div.modal${wide ? '.wide' : ''}`,
      h('div.modal-head', h('h3', title), h('button.icon-btn', { onclick: close, title: 'Cerrar' }, '✕')),
      h('div.modal-body', body)));
  document.body.append(back);
  back.querySelector('input,textarea,select')?.focus();
  return { close, el: back };
}

export function confirmDialog(text) {
  return new Promise((resolve) => {
    const m = modal('Confirmar', [
      h('p', text),
      h('div.row.end',
        h('button.btn.ghost', { onclick: () => { resolve(false); m.close(); } }, 'Cancelar'),
        h('button.btn.danger', { onclick: () => { resolve(true); m.close(); } }, 'Sí, hacerlo')),
    ], { onClose: () => resolve(false) });
  });
}

export function field(label, input) {
  return h('label.field', h('span', label), input);
}

/** Selector de imagen que la sube al servidor y devuelve la URL. */
export function pickImage(api) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        toast('Subiendo imagen…');
        resolve(await api.upload(file));
      } catch (err) {
        toast(err.message, 'error');
        resolve(null);
      }
    });
    input.click();
  });
}

export const ROLE_LABEL = { player: 'Jugador', dm: 'Dungeon Master', superadmin: 'Administrador' };

export const ABILITIES = [
  ['str', 'FUE', 'Fuerza'], ['dex', 'DES', 'Destreza'], ['con', 'CON', 'Constitución'],
  ['int', 'INT', 'Inteligencia'], ['wis', 'SAB', 'Sabiduría'], ['cha', 'CAR', 'Carisma'],
];

export const SKILLS = [
  ['Acrobacias', 'dex'], ['Atletismo', 'str'], ['Arcanos', 'int'], ['Engaño', 'cha'],
  ['Historia', 'int'], ['Interpretación', 'cha'], ['Intimidación', 'cha'], ['Investigación', 'int'],
  ['Juego de manos', 'dex'], ['Medicina', 'wis'], ['Naturaleza', 'int'], ['Percepción', 'wis'],
  ['Perspicacia', 'wis'], ['Persuasión', 'cha'], ['Religión', 'int'], ['Sigilo', 'dex'],
  ['Supervivencia', 'wis'], ['Trato con animales', 'wis'],
];

export function mod(score) {
  return Math.floor((Number(score) - 10) / 2);
}

export function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
