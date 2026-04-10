const { sendJson, handleOptions, readJsonBody, requireAdmin } = require('../lib/common');
const { getUsersDb, saveUsersDb, normalizeUser, makeUserToken, makeRouteKey } = require('../lib/private');

function buildInstallUrl(req, user) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const rk = user.routeKey ? `&rk=${encodeURIComponent(user.routeKey)}` : '';
  return `${proto}://${host}/api/manifest?token=${encodeURIComponent(user.token)}${rk}`;
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const db = await getUsersDb();

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      users: (db.users || []).map(u => ({ ...u, installUrl: buildInstallUrl(req, u) }))
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
      maxIps: body.maxIps,
      ips: [],
      notes: body.notes,
      routeKey: body.routeKey || makeRouteKey(),
    });

    if (!user.token || !user.name) return sendJson(res, 400, { error: 'Faltan campos obligatorios' });
    if ((db.users || []).some(u => String(u.token) === user.token)) return sendJson(res, 409, { error: 'El token ya existe' });

    db.users.push(user);
    await saveUsersDb(db);
    return sendJson(res, 200, { ok: true, user: { ...user, installUrl: buildInstallUrl(req, user) } });
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });
    const idx = db.users.findIndex(u => String(u.token) === String(body.token));
    if (idx === -1) return sendJson(res, 404, { error: 'Usuario no encontrado' });

    const current = db.users[idx];
    const next = normalizeUser({
      ...current,
      ...body,
      token: current.token,
      routeKey: body.regenerateRouteKey ? makeRouteKey() : (body.routeKey || current.routeKey || makeRouteKey()),
      expiresAt: body.extend30days ? (Number(current.expiresAt || Date.now()) + 30*24*60*60*1000) : (body.expiresAt ?? current.expiresAt),
    });

    db.users[idx] = next;
    await saveUsersDb(db);
    return sendJson(res, 200, { ok: true, user: { ...next, installUrl: buildInstallUrl(req, next) } });
  }

  if (req.method === 'DELETE') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body || !body.token) return sendJson(res, 400, { error: 'Token requerido' });
    db.users = (db.users || []).filter(u => String(u.token) !== String(body.token));
    await saveUsersDb(db);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: 'Método no permitido' });
};
