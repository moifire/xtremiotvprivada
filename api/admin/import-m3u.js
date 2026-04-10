
const { sendJson, handleOptions, readJsonBody, requireAdmin, parseM3U } = require('../lib/common');
const { getCatalog, setCatalog } = require('../lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });

  const body = await readJsonBody(req).catch(() => null);
  if (!body) return sendJson(res, 400, { error: 'JSON inválido' });

  const text = String(body.text || '');
  const mode = String(body.mode || 'merge');
  if (!text.trim()) return sendJson(res, 400, { error: 'M3U vacía' });

  const imported = parseM3U(text);
  const db = await getCatalog();

  if (mode === 'replace') {
    db.items = imported;
  } else {
    const map = new Map(db.items.map(x => [x.id, x]));
    imported.forEach(item => map.set(item.id, item));
    db.items = Array.from(map.values());
  }

  await setCatalog(db);
  return sendJson(res, 200, { ok: true, imported: imported.length, total: db.items.length });
};
