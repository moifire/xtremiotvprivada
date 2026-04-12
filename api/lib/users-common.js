
function normalizeUser(user = {}) {
  return {
    token: String(user.token || '').trim(),
    name: String(user.name || '').trim(),
    enabled: user.enabled !== false,
    expiresAt: Number(user.expiresAt || 0) || 0,
    maxIps: Number(user.maxIps || 0) || 0,
    ips: Array.isArray(user.ips) ? user.ips.filter(Boolean) : [],
    notes: String(user.notes || '').trim(),
  };
}

function ensureUsersShape(db) {
  db = db || {};
  db.users = Array.isArray(db.users) ? db.users.map(normalizeUser) : [];
  return db;
}

function makeUserToken(name = 'cliente') {
  const safe = String(name || 'cliente')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'cliente';
  return `${safe}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { normalizeUser, ensureUsersShape, makeUserToken };
