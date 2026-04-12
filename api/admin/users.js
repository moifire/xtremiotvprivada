const { sendJson, handleOptions, readJsonBody, requireAdmin } = require('../lib/common');
const { getUsersDb, setUsersDb, normalizeUser, makeUserToken } = require('../lib/users-db');

function buildInstallUrl(req, token) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/manifest.json?token=${encodeURIComponent(token)}`;
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const db = await getUsersDb();

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      users: (db.users || [])
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(u => ({ ...u, installUrl: buildInstallUrl(req, u.token) }))
    });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });

    const user = normalizeUser({
      token: body.token || makeUserToken(body.name),
      name: body.name,
      enabled: body.enabled,
      expiresAt: body.expiresAt,
      maxConnections: body.maxConnections,
      ips: [],
      notes: body.notes,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (!user.token || !user.name) return sendJson(res, 400, { error: 'Nombre requerido' });
    if ((db.users || []).some(u => String(u.token) === user.token)) return sendJson(res, 409, { error: 'El token ya existe' });

    db.users.push(user);
    await setUsersDb(db);
    return sendJson(res, 200, { ok: true, user: { ...user, installUrl: buildInstallUrl(req, user.token) } });
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });

    const idx = db.users.findIndex(u => String(u.token) === String(body.token || ''));
    if (idx === -1) return sendJson(res, 404, { error: 'Usuario no encontrado' });

    const prev = db.users[idx];
    const resetIps = Boolean(body.resetIps);
    const next = normalizeUser({
      ...prev,
      ...body,
      token: prev.token,
      ips: resetIps ? [] : (Array.isArray(body.ips) ? body.ips : prev.ips),
      updatedAt: Date.now(),
    });
    db.users[idx] = next;
    await setUsersDb(db);
    return sendJson(res, 200, { ok: true, user: { ...next, installUrl: buildInstallUrl(req, next.token) } });
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
