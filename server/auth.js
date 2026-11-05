// Cuentas, contraseñas (scrypt) y sesiones por token.
const crypto = require('crypto');
const { db, save } = require('./db');

const ROLES = ['player', 'dm', 'superadmin'];
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const USERNAME_RE = /^[a-z0-9_.-]{2,24}$/;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}

/** Valida y crea un usuario. Lanza Error con mensaje para la UI si algo no cuadra. */
function createUser({ username, password, displayName, role = 'player' }) {
  const name = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(name)) throw new Error('Usuario: 2-24 caracteres (a-z, 0-9, _ . -)');
  if (String(password || '').length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
  if (!ROLES.includes(role)) throw new Error('Rol inválido');
  if (db().users.some((u) => u.username === name)) throw new Error('Ese usuario ya existe');

  const user = {
    id: crypto.randomUUID(),
    username: name,
    displayName: String(displayName || name).trim().slice(0, 40) || name,
    role,
    ...hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  };
  db().users.push(user);
  save();
  return user;
}

function login(username, password) {
  const user = db().users.find((u) => u.username === String(username || '').trim().toLowerCase());
  if (!user || !checkPassword(user, String(password || ''))) throw new Error('Usuario o contraseña incorrectos');
  const token = crypto.randomBytes(32).toString('hex');
  db().sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  save();
  return { token, user };
}

function userFromToken(token) {
  if (!token) return null;
  const session = db().sessions.find((s) => s.token === token);
  if (!session) return null;
  if (Date.now() - Date.parse(session.createdAt) > SESSION_TTL_MS) return null;
  return db().users.find((u) => u.id === session.userId) || null;
}

function logout(token) {
  db().sessions = db().sessions.filter((s) => s.token !== token);
  save();
}

function tokenFromReq(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Middleware: exige sesión y, opcionalmente, uno de los roles dados. */
function requireAuth(...roles) {
  return (req, res, next) => {
    const user = userFromToken(tokenFromReq(req));
    if (!user) return res.status(401).json({ error: 'Sesión no válida' });
    if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'No tienes permiso' });
    req.user = user;
    next();
  };
}

/** Crea el super admin la primera vez y devuelve la contraseña generada (o null). */
function ensureSuperAdmin() {
  if (db().users.some((u) => u.role === 'superadmin')) return null;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  createUser({ username: 'admin', password, displayName: 'Super Admin', role: 'superadmin' });
  return password;
}

module.exports = {
  ROLES, createUser, login, logout, userFromToken, tokenFromReq, requireAuth,
  publicUser, hashPassword, checkPassword, ensureSuperAdmin,
};
