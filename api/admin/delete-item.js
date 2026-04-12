
const { sendJson, handleOptions, readJsonBody, requireAdmin } = require('../lib/common');
const { getCatalog, setCatalog } = require('../lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });

  const body = await readJsonBody(req).catch(() => null);
  const id = String(body?.id || '').trim();
  if (!id) return sendJson(res, 400, { error: 'Falta id' });

  const db = await getCatalog();
  db.items = db.items.filter(x => x.id !== id);
  await setCatalog(db);
  return sendJson(res, 200, { ok: true, total: db.items.length });
};
