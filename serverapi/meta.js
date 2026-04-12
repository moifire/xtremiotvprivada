const { sendJson, handleOptions, makeMeta, parseUrl } = require('./lib/common');
const { getCatalog } = require('./lib/db');
const { requirePrivateUserAccess } = require('./lib/users-db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateUserAccess(req, res, sendJson, parseUrl);
  if (!user) return;

  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  const db = await getCatalog();
  const item = db.items.find(x => x.id === id && (!type || x.type === type));
  if (!item) return sendJson(res, 404, { error: 'Meta no encontrada' });
  return sendJson(res, 200, { meta: makeMeta(item, db) });
};
