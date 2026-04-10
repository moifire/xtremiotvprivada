const { sendJson, handleOptions, parseUrl } = require('./lib/common');
const { requirePrivateAccess } = require('./lib/private');
const { getCatalog } = require('./lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const user = await requirePrivateAccess(req, res);
  if (!user) return;

  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  const db = await getCatalog();
  const item = db.items.find(x => x.id === id && (!type || x.type === type));
  if (!item) return sendJson(res, 404, { streams: [] });

  return sendJson(res, 200, { streams: item.streams || [] });
};
