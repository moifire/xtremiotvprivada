const { sendJson, handleOptions, buildCatalogsFromDb } = require('./lib/common');
const { requirePrivateAccess } = require('./lib/private');
const { getCatalog } = require('./lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;

  const user = await requirePrivateAccess(req, res);
  if (!user) return;

  const db = await getCatalog();
  return sendJson(res, 200, {
    id: 'moitube-ultra-private',
    version: '3.2.0',
    name: db.addonsBrand?.name || 'MoiTube Ultra Private Legal PRO',
    description: db.addonsBrand?.description || 'Catálogo privado PRO MAX',
    logo: db.addonsBrand?.logo || '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'tv'],
    catalogs: buildCatalogsFromDb(db),
    idPrefixes: ['tv-', 'movie-', 'series-']
  });
};
