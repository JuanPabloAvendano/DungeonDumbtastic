// Cliente de la API REST y del socket.
// Cada pestaña tiene su propia sesión (sessionStorage): iniciar sesión con otra cuenta en otra
// pestaña no cambia la identidad de esta. localStorage solo recuerda el último inicio de sesión
// para que una pestaña nueva arranque ya dentro.
import { io } from '/socket.io/socket.io.esm.min.js';

const TOKEN_KEY = 'da.token';
let memoryToken = null;

function getToken() {
  try {
    const own = sessionStorage.getItem(TOKEN_KEY);
    if (own) return own;
    const last = localStorage.getItem(TOKEN_KEY);
    if (last) sessionStorage.setItem(TOKEN_KEY, last);
    return last;
  } catch {
    return memoryToken;
  }
}

function setToken(token) {
  memoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_KEY, token);
      return;
    }
    // Cerrar sesión: solo olvida la "última sesión" si era la de esta pestaña.
    if (localStorage.getItem(TOKEN_KEY) === sessionStorage.getItem(TOKEN_KEY)) localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* modo privado: la sesión dura lo que la pestaña */ }
}

async function request(method, url, body) {
  const headers = { Authorization: `Bearer ${getToken() || ''}` };
  const isForm = body instanceof FormData;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: isForm ? body : body && JSON.stringify(body) });
  } catch {
    throw new Error('No hay conexión con el servidor');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),
  patch: (url, body) => request('PATCH', url, body || {}),
  del: (url) => request('DELETE', url),
  async login(username, password) {
    const data = await request('POST', '/auth/login', { username, password });
    setToken(data.token);
    return data.user;
  },
  async register(username, password, displayName) {
    const data = await request('POST', '/auth/register', { username, password, displayName });
    setToken(data.token);
    return data.user;
  },
  /** Descarga un archivo de la API (con la sesión) y lo guarda con el nombre que manda el servidor. */
  async download(url, fallbackName) {
    let res;
    try {
      res = await fetch(`/api${url}`, { headers: { Authorization: `Bearer ${getToken() || ''}` } });
    } catch {
      throw new Error('No hay conexión con el servidor');
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
    const href = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  },
  async logout() {
    await request('POST', '/auth/logout').catch(() => {});
    setToken(null);
  },
  async upload(file) {
    const form = new FormData();
    form.append('image', file);
    return (await request('POST', '/upload', form)).url;
  },
  hasToken: () => Boolean(getToken()),
  socket() {
    return io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
  },
};
