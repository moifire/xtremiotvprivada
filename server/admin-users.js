const { sendJson, readJsonBody, requireAdmin } = require('./common');
const { getUsersDb, saveUsersDb, normalizeUser, makeUserToken } = require('./private');

function buildInstallUrl(req, token) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/manifest.json?token=${encodeURIComponent(token)}`;
}

async function handleAdminUsers(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const db = await getUsersDb();

  if (req.method === 'GET') {
    return sendJson(res, 200, { users: (db.users || []).map(u => ({ ...u, installUrl: buildInstallUrl(req, u.token) })) });
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

    if (!user.token || !user.name) return sendJson(res, 400, { error: 'Faltan campos obligatorios' });
    if ((db.users || []).some(u => String(u.token) === user.token)) return sendJson(res, 409, { error: 'El token ya existe' });

    db.users.push(user);
    await saveUsersDb(db);
    return sendJson(res, 200, { ok: true, user: { ...user, installUrl: buildInstallUrl(req, user.token) } });
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });
    const idx = db.users.findIndex(u => String(u.token) === String(body.token));
    if (idx === -1) return sendJson(res, 404, { error: 'Usuario no encontrado' });
    db.users[idx] = normalizeUser({ ...db.users[idx], ...body, token: db.users[idx].token });
    await saveUsersDb(db);
    return sendJson(res, 200, { ok: true, user: { ...db.users[idx], installUrl: buildInstallUrl(req, db.users[idx].token) } });
  }

  if (req.method === 'DELETE') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body || !body.token) return sendJson(res, 400, { error: 'Token requerido' });
    db.users = (db.users || []).filter(u => String(u.token) !== String(body.token));
    await saveUsersDb(db);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: 'Método no permitido' });
}

module.exports = { handleAdminUsers };
