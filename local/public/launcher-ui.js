// Página del lanzador local: pregunta el estado cada poco y pinta la mesa y las conexiones.
import { h, clear, toast } from '/js/ui.js';

const POLL_MS = 1500;
const GROUPS = [['lan', 'Misma red'], ['tunel', 'Túneles (enlace público)'], ['p2p', 'P2P (directo entre equipos)']];

// El token llega en el #hash al abrir la página y se guarda para esta pestaña.
const token = (() => {
  const fromHash = location.hash.slice(1);
  try {
    if (fromHash) sessionStorage.setItem('ln.token', fromHash);
    history.replaceState(null, '', location.pathname);
    return fromHash || sessionStorage.getItem('ln.token') || '';
  } catch {
    return fromHash;
  }
})();

const serverBox = document.getElementById('server');
const connBox = document.getElementById('connections');
const portInput = h('input', { type: 'number', min: 1024, max: 65535, value: 3000, 'aria-label': 'Puerto de la mesa' });
// Qué registros dejó abiertos la persona, para no cerrárselos al repintar.
const openLogs = new Set();
let busy = false;

async function call(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method, headers: { 'content-type': 'application/json', 'x-launcher-token': token }, body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function act(fn, okMsg) {
  if (busy) return;
  busy = true;
  try {
    await fn();
    if (okMsg) toast(okMsg, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    busy = false;
    refresh();
  }
}

function copyBtn(text) {
  return h('button.btn.small', { onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copiado', 'ok')) }, 'Copiar');
}

function logBlock(key, lines) {
  if (!lines.length) return null;
  const det = h('details.ln-log', { open: openLogs.has(key) }, h('summary.tiny.muted', 'Registro'), h('pre', lines.join('\n')));
  det.addEventListener('toggle', () => (det.open ? openLogs.add(key) : openLogs.delete(key)));
  return det;
}

function linkBlock(url, withQr = true) {
  return h('div',
    h('div.ln-link', h('code', url), copyBtn(url), url.startsWith('http') ? h('a.btn.small.ghost', { href: url, target: '_blank', rel: 'noopener' }, 'Abrir') : null),
    withQr ? h('img.ln-qr', { src: `/api/qr?t=${encodeURIComponent(token)}&text=${encodeURIComponent(url)}`, alt: `Código QR de ${url}`, onerror: (e) => e.target.remove() }) : null);
}

function renderServer(sv) {
  portInput.disabled = sv.running;
  const local = `http://localhost:${sv.port}`;
  clear(serverBox,
    h('h2.ln-step', h('b', '1'), 'La mesa'),
    h('div.ln-row',
      h(`span.ln-dot${sv.running ? '.on' : ''}`),
      h('span', sv.running ? `Encendida en el puerto ${sv.port}` : 'Apagada'),
      h('label.tiny.muted', 'Puerto ', portInput),
      sv.running
        ? h('button.btn', { onclick: () => act(() => call('POST', '/servidor/parar'), 'Mesa apagada') }, '■ Apagar')
        : h('button.btn.primary', { onclick: () => act(() => call('POST', '/servidor/iniciar', { port: Number(portInput.value) }), 'Mesa encendida') }, '▶ Encender'),
      sv.running ? h('a.btn.ghost', { href: local, target: '_blank', rel: 'noopener' }, 'Abrir la mesa') : null),
    sv.adminPassword ? h('div.ln-secret', '👑 Cuenta de administrador creada: usuario ', h('b', 'admin'), ' · contraseña ', h('code', sv.adminPassword), h('div.tiny.muted', 'Cámbiala en el panel de administración.')) : null,
    logBlock('server', sv.log));
}

function providerCard(p, sv) {
  const status = !p.installed ? ['missing', 'No instalado'] : p.link ? ['ready', 'Listo'] : p.running ? ['wait', 'Conectando…'] : ['', 'Apagado'];
  const canRun = p.installed && sv.running;
  return h(`div.ln-provider${status[0] ? `.${status[0]}` : ''}`,
    h('div.ln-row', h('h4', p.name), h(`span.ln-chip${status[0] ? `.${status[0]}` : ''}`, status[1]),
      p.running
        ? h('button.btn.small', { onclick: () => act(() => call('POST', `/conexion/${p.id}/parar`)) }, 'Cerrar')
        : h('button.btn.small.primary', { disabled: !canRun, title: sv.running ? '' : 'Primero enciende la mesa', onclick: () => act(() => call('POST', `/conexion/${p.id}/iniciar`)) }, 'Abrir')),
    h('p.tiny.muted', p.about),
    !p.installed ? h('p.tiny.ln-install', 'Para instalarlo: ', h('code', p.install)) : null,
    p.link ? (p.friends
      ? h('div', h('p.tiny', 'Pásale a cada amigo este comando (lo corre en su equipo) y que abra http://localhost:8989:'), linkBlock(p.friends, false))
      : linkBlock(p.link)) : null,
    logBlock(p.id, p.log));
}

function lanCard(p, sv) {
  return h('div.ln-provider', { class: sv.lan.length ? 'ready' : '' },
    h('div.ln-row', h('h4', p.name), h(`span.ln-chip${sv.lan.length ? '.ready' : ''}`, sv.lan.length ? 'Listo' : sv.running ? 'Sin red' : 'Apagado')),
    h('p.tiny.muted', p.about),
    sv.lan.map((url) => linkBlock(url)),
    sv.running && sv.ufw ? h('p.tiny.ln-install', '🛡 El cortafuegos (ufw) está activo. Si no entran, ábrelo una vez: ', h('code', `sudo ufw allow ${sv.port}/tcp`)) : null);
}

function renderConnections({ server: sv, providers }) {
  clear(connBox,
    h('h2.ln-step', h('b', '2'), '¿Cómo entran tus amigos?'),
    h('button.btn.primary.ln-auto', {
      disabled: !sv.running,
      onclick: () => act(async () => { const { id } = await call('POST', '/auto'); toast(`Conectado con ${providers.find((p) => p.id === id)?.name}`, 'ok'); }),
    }, '✨ Automático: prueba túneles hasta que uno funcione'),
    GROUPS.map(([kind, title]) => h('div.ln-group', h('h3', title),
      providers.filter((p) => p.kind === kind).map((p) => (kind === 'lan' ? lanCard(p, sv) : providerCard(p, sv))))));
}

async function refresh() {
  try {
    const st = await call('GET', '/estado');
    renderServer(st.server);
    renderConnections(st);
  } catch (err) {
    clear(serverBox, h('p', `No hay conexión con el lanzador (${err.message}). Ábrelo con npm run lanzador y usa el enlace que imprime.`));
    clear(connBox);
  }
}

refresh();
setInterval(() => { if (!busy) refresh(); }, POLL_MS);
