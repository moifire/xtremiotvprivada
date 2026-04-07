
const { sendJson, handleOptions, requireAddonToken, makeMeta, parseUrl } = require('./lib/common');
const { getCatalog } = require('./lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAddonToken(req, res)) return;

  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const db = await getCatalog();
  const metas = db.items.filter(x => !type || x.type === type).map(makeMeta);
  return sendJson(res, 200, { metas });
};
