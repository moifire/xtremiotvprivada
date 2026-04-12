const crypto = require('crypto');

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USERS_KEY = process.env.USERS_KEY || 'moitube:users';

async function redisCommand(args) {
  if (!REST_URL || !REST_TOKEN) throw new Error('Faltan variables de Upstash');
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `Error Redis ${res.status}`);
  }
  return json.result;
}

function normalizeUser(user = {}) {
  const maxConnections = Number(user.maxConnections ?? user.maxIps ?? 1) || 0;
  return {
    token: String(user.token || '').trim(),
    name: String(user.name || '').trim(),
    enabled: user.enabled !== false,
    expiresAt: Number(user.expiresAt || 0) || 0,
    maxConnections,
    ips: Array.isArray(user.ips) ? user.ips.filter(Boolean).map(x => String(x).trim()) : [],
    notes: String(user.notes || '').trim(),
    createdAt: Number(user.createdAt || Date.now()) || Date.now(),
    updatedAt: Number(user.updatedAt || Date.now()) || Date.now(),
    lastSeenAt: Number(user.lastSeenAt || 0) || 0,
  };
}

function ensureUsersShape(db) {
  db = db || {};
  db.users = Array.isArray(db.users) ? db.users.map(normalizeUser) : [];
  return db;
}

async function getUsersDb() {
  try {
    const result = await redisCommand(['GET', USERS_KEY]);
    if (!result) return ensureUsersShape({ users: [] });
    return ensureUsersShape(JSON.parse(result));
  } catch (e) {
    return ensureUsersShape({ users: [] });
  }
}

async function setUsersDb(db) {
  db = ensureUsersShape(db);
  await redisCommand(['SET', USERS_KEY, JSON.stringify(db)]);
  return db;
}

function makeUserToken(name = 'cliente') {
  const safe = String(name || 'cliente')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'cliente';
  return `${safe}_${crypto.randomBytes(4).toString('hex')}`;
}

function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.trim()) return xfwd.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

async function requirePrivateUserAccess(req, res, sendJson, parseUrl) {
  const url = parseUrl(req);
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) {
    sendJson(res, 401, { error: 'Token requerido' });
    return null;
  }

  const db = await getUsersDb();
  const idx = db.users.findIndex(u => String(u.token) === token);
  if (idx === -1) {
    sendJson(res, 401, { error: 'Token inválido' });
    return null;
  }

  const user = normalizeUser(db.users[idx]);
  if (!user.enabled) {
    sendJson(res, 403, { error: 'Usuario desactivado' });
    return null;
  }
  if (user.expiresAt && Date.now() > user.expiresAt) {
    sendJson(res, 403, { error: 'Usuario caducado' });
    return null;
  }

  const ip = getClientIp(req);
  if (ip && !user.ips.includes(ip)) {
    if (user.maxConnections > 0 && user.ips.length >= user.maxConnections) {
      sendJson(res, 403, { error: 'Máximo de conexiones/IPs alcanzado' });
      return null;
    }
    user.ips.push(ip);
  }

  user.lastSeenAt = Date.now();
  user.updatedAt = Date.now();
  db.users[idx] = user;
  await setUsersDb(db);
  return user;
}

module.exports = {
  getUsersDb,
  setUsersDb,
  normalizeUser,
  ensureUsersShape,
  makeUserToken,
  getClientIp,
  requirePrivateUserAccess,
};
