// Arranque y enrutado por hash: #/login, #/ (lobby), #/admin, #/mesa/:id
import { h, toast, ROLE_LABEL } from './ui.js';
import { api } from './api.js';
import { loginView } from './views/login.js';
import { lobbyView } from './views/lobby.js';
import { adminView } from './views/admin.js';
import { tableView } from './views/table.js';
import { guideView } from './views/guide.js';

const root = document.getElementById('app');
let me = null;
let cleanup = null;

const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

function header() {
  return h('header.topbar',
    h('a.brand', { href: '#/' }, h('img', { src: '/assets/d20.svg', alt: '' }), h('span', 'Dungeon', h('em', 'Dumbtastic'))),
    h('nav',
      h('a', { href: '#/' }, 'Campañas'),
      h('a', { href: '#/guia' }, 'Guía'),
      me.role === 'superadmin' ? h('a', { href: '#/admin' }, 'Administración') : null),
    h('div.user-chip', h('b', me.displayName), h(`span.badge${me.role !== 'player' ? '.gold' : ''}`, ROLE_LABEL[me.role]),
      h('button.btn.small.ghost', {
        onclick: async () => {
          await api.logout();
          me = null;
          go('#/login');
        },
      }, 'Salir')));
}

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  document.body.className = '';
  const hash = location.hash || '#/';

  if (!me && api.hasToken()) {
    try {
      ({ user: me } = await api.get('/me'));
    } catch {
      await api.logout();
    }
  }
  const guia = hash.match(/^#\/guia(?:\/(\w+))?$/);
  if (guia) return guideView(root, { me, header, which: guia[1] || 'general' });
  if (!me) {
    document.body.classList.add('is-login');
    return loginView(root, { onLogin: (u) => { me = u; go('#/'); } });
  }
  if (hash === '#/login') return go('#/');

  const mesa = hash.match(/^#\/mesa\/([\w-]+)$/);
  if (mesa) {
    document.body.classList.add('is-table');
    cleanup = tableView(root, { me, go, campaignId: mesa[1] });
    return;
  }
  if (hash === '#/admin') {
    if (me.role !== 'superadmin') return go('#/');
    // adminView es asíncrona: su limpieza (parar el monitor) llega al resolverse.
    adminView(root, { me, header }).then((stop) => { cleanup = stop; });
    return;
  }
  return lobbyView(root, { me, go, header });
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Error inesperado', 'error'));
route();
