
const { sendJson, handleOptions, readJsonBody, requireAdmin, ensureCatalogShape } = require('../lib/common');
const { getCatalog, setCatalog } = require('../lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    const db = await getCatalog();
    return sendJson(res, 200, db);
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) return sendJson(res, 400, { error: 'JSON inválido' });
    const saved = await setCatalog(ensureCatalogShape(body));
    return sendJson(res, 200, { ok: true, catalog: saved });
  }

  return sendJson(res, 405, { error: 'Método no permitido' });
};
