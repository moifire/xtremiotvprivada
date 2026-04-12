const { sendJson, handleOptions, buildCatalogsFromDb, parseUrl } = require('./lib/common');
const { getCatalog } = require('./lib/db');
const { requirePrivateUserAccess } = require('./lib/users-db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateUserAccess(req, res, sendJson, parseUrl);
  if (!user) return;

  const db = await getCatalog();
  const manifest = {
    id: 'com.moitube.ultra.private.db',
    version: '3.1.0',
    name: db.addonsBrand?.name || 'MoiTube Ultra Private Legal PRO',
    description: db.addonsBrand?.description || 'Addon privado con base de datos',
    logo: db.addonsBrand?.logo || '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'tv'],
    catalogs: buildCatalogsFromDb(db),
    behaviorHints: { configurable: false, configurationRequired: false }
  };
  return sendJson(res, 200, manifest);
};
