
const { sendJson, handleOptions, readJsonBody, signSession } = require('../lib/common');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });

  const body = await readJsonBody(req).catch(() => null);
  if (!body) return sendJson(res, 400, { error: 'JSON inválido' });

  const user = String(body.username || '').trim();
  const pass = String(body.password || '').trim();
  const expectedUser = String(process.env.ADMIN_USER || '').trim();
  const expectedPass = String(process.env.ADMIN_PASS || '').trim();

  if (!expectedUser || !expectedPass) {
    return sendJson(res, 500, { error: 'Faltan ADMIN_USER o ADMIN_PASS' });
  }

  if (user !== expectedUser || pass !== expectedPass) {
    return sendJson(res, 401, { error: 'Credenciales incorrectas' });
  }

  const token = signSession({
    role: 'admin',
    sub: user,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  });

  return sendJson(res, 200, { ok: true, token, username: user });
};
