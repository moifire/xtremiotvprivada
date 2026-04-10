const fs = require('fs/promises');
const path = require('path');
const { parseUrl, sendJson, randId } = require('./common');

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json');

async function getUsersDb() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const db = JSON.parse(raw);
    db.users = Array.isArray(db.users) ? db.users : [];
    return db;
  } catch {
    return { users: [] };
  }
}

async function saveUsersDb(db) {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.trim()) return xfwd.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

function normalizeUser(user = {}) {
  return {
    token: String(user.token || '').trim(),
    name: String(user.name || '').trim(),
    enabled: user.enabled !== false,
    expiresAt: Number(user.expiresAt || 0) || 0,
    maxIps: Number(user.maxIps || 0) || 0,
    ips: Array.isArray(user.ips) ? user.ips.filter(Boolean) : [],
    notes: String(user.notes || '').trim(),
    routeKey: String(user.routeKey || '').trim(),
  };
}

function makeUserToken(name = 'cliente') {
  const safe = String(name || 'cliente')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'cliente';
  return `${safe}_${randId('tok').replace(/^tok_/, '')}`;
}

function makeRouteKey() {
  return `ultra-${Math.random().toString(36).slice(2,8)}`;
}

function getRequestedRouteKey(req) {
  const url = parseUrl(req);
  return String(url.searchParams.get('rk') || req.headers['x-addon-rk'] || '').trim();
}

async function requirePrivateAccess(req, res) {
  const url = parseUrl(req);
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) {
    sendJson(res, 401, { error: 'Token requerido' });
    return null;
  }

  const db = await getUsersDb();
  const idx = db.users.findIndex(u => String(u.token).trim() === token);
  if (idx === -1) {
    sendJson(res, 401, { error: 'Token inválido' });
    return null;
  }

  const user = normalizeUser(db.users[idx]);
  if (!user.enabled) {
    sendJson(res, 403, { error: 'Acceso desactivado' });
    return null;
  }
  if (user.expiresAt && Date.now() > user.expiresAt) {
    sendJson(res, 403, { error: 'Acceso caducado' });
    return null;
  }

  const rk = getRequestedRouteKey(req);
  if (user.routeKey && rk && user.routeKey !== rk) {
    sendJson(res, 403, { error: 'Ruta privada inválida' });
    return null;
  }

  const ip = getClientIp(req);
  if (ip && !user.ips.includes(ip)) {
    if (user.maxIps > 0 && user.ips.length >= user.maxIps) {
      sendJson(res, 403, { error: 'Límite de IPs alcanzado' });
      return null;
    }
    user.ips.push(ip);
    db.users[idx] = user;
    await saveUsersDb(db);
  }

  return user;
}

module.exports = {
  getUsersDb,
  saveUsersDb,
  getClientIp,
  normalizeUser,
  makeUserToken,
  makeRouteKey,
  requirePrivateAccess,
};
