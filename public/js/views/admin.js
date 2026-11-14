// Panel de administración: cuentas, roles, registro abierto y vista de campañas.
import { h, clear, field, toast, confirmDialog, ROLE_LABEL } from '../ui.js';
import { api } from '../api.js';

const MONITOR_REFRESH_MS = 5000;

export async function adminView(root, { me, header }) {
  const usersBox = h('div');
  const campsBox = h('div');
  const regToggle = h('input', { type: 'checkbox' });
  const monitorBox = h('div.monitor');
  let level = 'info';
  let timer = null;

  const fmtUptime = (sec) => `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
  const stat = (label, value, kind = '') => h(`div.m-stat${kind ? `.${kind}` : ''}`, h('small', label), h('b', value));

  async function loadMonitor() {
    if (!monitorBox.isConnected) return stopMonitor();
    try {
      const m = await api.get(`/admin/monitor?level=${level}`);
      const levelSel = h('select.small', { onchange: (e) => { level = e.target.value; loadMonitor(); } },
        [['debug', 'Todo'], ['info', 'Info+'], ['warn', 'Avisos+'], ['error', 'Solo errores']].map(([v, l]) => h('option', { value: v, selected: v === level }, l)));
      clear(monitorBox,
        h('div.m-grid',
          stat('Activo', fmtUptime(m.uptimeSec)),
          stat('Conexiones', m.sockets),
          stat('Memoria', `${m.system.rssMb} MB`),
          stat('Carga CPU', m.system.load.join(' · ')),
          stat('Peticiones API', m.counters.requests),
          stat('Tiradas', m.counters.rolls),
          stat('Mensajes', m.counters.chats),
          stat('Subidas', m.counters.uploads),
          stat('Errores 4xx', m.counters.http4xx, m.counters.http4xx ? 'warn' : ''),
          stat('Errores 5xx / internos', m.counters.http5xx + m.counters.errors, m.counters.http5xx + m.counters.errors ? 'bad' : 'ok')),
        h('div.m-cols',
          h('div',
            h('div.label-mini', 'En línea ahora'),
            m.presence.length ? m.presence.map((p) => h('div.list-row', h('span.dot.on'), h('b', p.campaign), h('span.muted.tiny', p.users.join(', ')))) : h('p.muted.tiny', 'Nadie en una mesa.'),
            h('div.label-mini', 'Direcciones en la red local / hotspot'),
            m.lan.length ? m.lan.map((u) => h('div.list-row', h('code', u))) : h('p.muted.tiny', 'Sin red local detectada.'),
            h('div.label-mini', 'Sistema'),
            h('p.tiny.muted', `${m.system.platform} · Node ${m.system.node} · PID ${m.system.pid} · libre ${m.system.freeMemMb} MB · ${m.db.users} cuentas, ${m.db.campaigns} campañas, ${m.db.characters} personajes`),
            h('p.tiny.muted', 'Log de hoy: ', h('code', m.logFile || '—'))),
          h('div',
            h('div.row.between', h('div.label-mini', 'Eventos recientes'), levelSel),
            h('div.m-log', m.recent.length ? m.recent.map((e) => h(`div.m-line.${e.level}`,
              h('span.t', e.t.slice(11, 19)), h('span.l', e.level), h('span.m-msg', e.msg),
              h('span.d', Object.entries(e).filter(([k]) => !['t', 'level', 'msg'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')))) : h('p.muted.tiny', 'Sin eventos.')))));
    } catch (err) {
      clear(monitorBox, h('p.muted', `No se pudo leer el monitor: ${err.message}`));
    }
  }
  function stopMonitor() {
    clearInterval(timer);
    timer = null;
  }

  async function load() {
    try {
      const [{ users }, { campaigns }, { settings }] = await Promise.all([
        api.get('/admin/users'), api.get('/admin/campaigns'), api.get('/me'),
      ]);
      regToggle.checked = settings.openRegistration;
      renderUsers(users);
      clear(campsBox, campaigns.length
        ? h('table.table', h('thead', h('tr', h('th', 'Campaña'), h('th', 'DM'), h('th', 'Jugadores'))),
          h('tbody', campaigns.map((c) => h('tr', h('td', c.name), h('td', c.dm), h('td', c.players)))))
        : h('p.muted', 'No hay campañas todavía.'));
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderUsers(users) {
    clear(usersBox, h('table.table',
      h('thead', h('tr', h('th', 'Usuario'), h('th', 'Nombre'), h('th', 'Rol'), h('th', 'Alta'), h('th', ''))),
      h('tbody', users.map((u) => {
        const role = h('select', {
          onchange: async (e) => {
            try { await api.patch(`/admin/users/${u.id}`, { role: e.target.value }); toast('Rol actualizado', 'ok'); } catch (err) { toast(err.message, 'error'); load(); }
          },
        }, Object.entries(ROLE_LABEL).map(([k, v]) => h('option', { value: k, selected: k === u.role }, v)));
        return h('tr',
          h('td', h('code', u.username)),
          h('td', u.displayName),
          h('td', role),
          h('td.tiny', new Date(u.createdAt).toLocaleDateString()),
          h('td.row',
            h('button.btn.small.ghost', {
              onclick: async () => {
                const pw = prompt(`Nueva contraseña para ${u.username} (mín. 6):`);
                if (!pw) return;
                try { await api.patch(`/admin/users/${u.id}`, { password: pw }); toast('Contraseña cambiada', 'ok'); } catch (err) { toast(err.message, 'error'); }
              },
            }, 'Contraseña'),
            u.id !== me.id ? h('button.btn.small.danger', {
              onclick: async () => {
                if (!(await confirmDialog(`¿Borrar la cuenta ${u.username}?`))) return;
                try { await api.del(`/admin/users/${u.id}`); load(); } catch (err) { toast(err.message, 'error'); }
              },
            }, 'Borrar') : null));
      }))));
  }

  const nu = { username: h('input', { required: true, placeholder: 'usuario' }), displayName: h('input', { placeholder: 'Nombre visible' }),
    password: h('input', { required: true, type: 'text', placeholder: 'contraseña (mín. 6)' }),
    role: h('select', Object.entries(ROLE_LABEL).map(([k, v]) => h('option', { value: k }, v))) };

  regToggle.addEventListener('change', async () => {
    try { await api.patch('/admin/settings', { openRegistration: regToggle.checked }); toast('Ajuste guardado', 'ok'); } catch (err) { toast(err.message, 'error'); }
  });

  clear(root, h('div.page', header(),
    h('main.lobby',
      h('section.hero', h('div', h('h2', 'Panel de administración'), h('p.muted', 'Crea cuentas para tus amigos y decide quién es DM.'))),
      h('section.panel-card',
        h('h2.section-title', 'Crear cuenta'),
        h('form.grid4', {
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await api.post('/admin/users', Object.fromEntries(Object.entries(nu).map(([k, el]) => [k, el.value])));
              toast(`Cuenta ${nu.username.value} creada`, 'ok');
              nu.username.value = ''; nu.password.value = ''; nu.displayName.value = '';
              load();
            } catch (err) { toast(err.message, 'error'); }
          },
        }, field('Usuario', nu.username), field('Nombre visible', nu.displayName), field('Contraseña', nu.password), field('Rol', nu.role),
        h('button.btn.primary', 'Crear')),
        h('label.check', regToggle, h('span', 'Permitir que cualquiera cree su cuenta de jugador desde la pantalla de acceso'))),
      h('section.panel-card', h('h2.section-title', 'Respaldo'),
        h('p.muted', 'Baja todo (cuentas, campañas, mapas, subidas y compendio) en un .tar.gz. En la nube lo que no se respalde se pierde al reiniciar.'),
        h('button.btn.primary', {
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await api.download('/admin/backup', 'dungeondumbtastic-respaldo.tar.gz'); toast('Respaldo descargado', 'ok'); } catch (err) { toast(err.message, 'error'); }
            btn.disabled = false;
          },
        }, 'Descargar respaldo')),
      h('section.panel-card', h('h2.section-title', 'Monitor del servidor'), monitorBox),
      h('section.panel-card', h('h2.section-title', 'Cuentas'), usersBox),
      h('section.panel-card', h('h2.section-title', 'Campañas'), campsBox))));
  load();
  loadMonitor();
  timer = setInterval(loadMonitor, MONITOR_REFRESH_MS);
  return stopMonitor;
}
