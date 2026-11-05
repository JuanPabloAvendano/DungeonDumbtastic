// Cliente de la API REST y del socket. Guarda la sesión en localStorage.
import { io } from '/socket.io/socket.io.esm.min.js';

const TOKEN_KEY = 'da.token';

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
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
