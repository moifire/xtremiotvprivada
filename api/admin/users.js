
const { sendJson, handleOptions, readJsonBody, requireAdmin } = require('../lib/common');
const { getUsersDb, setUsersDb } = require('../lib/users-db');
const { normalizeUser, makeUserToken } = require('../lib/users-common');

function buildInstallUrl(req, token) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/manifest.json?token=${encodeURIComponent(token)}`;
}

function withInstallUrl(req, user) {
  return { ...user, installUrl: buildInstallUrl(req, user.token) };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const db = await getUsersDb();

  if (req.method === 'GET') {
    return sendJson(res, 200, { users: (db.users || []).map(u => withInstallUrl(req, u)) });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });
    const user = normalizeUser({
      token: body.token || makeUserToken(body.name),
      name: body.name,
      enabled: body.enabled,
      expiresAt: body.expiresAt,
      maxIps: body.maxIps,
      ips: [],
      notes: body.notes,
    });
    if (!user.name) return sendJson(res, 400, { error: 'Falta el nombre' });
    if (!user.token) return sendJson(res, 400, { error: 'Falta el token' });
    if ((db.users || []).some(u => String(u.token) === user.token)) return sendJson(res, 409, { error: 'El token ya existe' });
    db.users.unshift(user);
    await setUsersDb(db);
    return sendJson(res, 200, { ok: true, user: withInstallUrl(req, user) });
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });
    const idx = db.users.findIndex(u => String(u.token) === String(body.token));
    if (idx === -1) return sendJson(res, 404, { error: 'Usuario no encontrado' });
    const current = db.users[idx];
    db.users[idx] = normalizeUser({ ...current, ...body, token: current.token });
    await setUsersDb(db);
    return sendJson(res, 200, { ok: true, user: withInstallUrl(req, db.users[idx]) });
  }

  if (req.method === 'DELETE') {
    const body = await readJsonBody(req).catch(() => null);
    const token = String(body?.token || '').trim();
    if (!token) return sendJson(res, 400, { error: 'Token requerido' });
    db.users = (db.users || []).filter(u => String(u.token) !== token);
    await setUsersDb(db);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: 'Método no permitido' });
};
