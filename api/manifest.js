
const { sendJson, handleOptions, requireAddonToken } = require('./lib/common');
const { getCatalog } = require('./lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAddonToken(req, res)) return;

  const db = await getCatalog();
  const manifest = {
    id: 'com.moitube.ultra.private.db',
    version: '3.0.0',
    name: db.addonsBrand?.name || 'MoiTube Ultra Private Legal PRO',
    description: db.addonsBrand?.description || 'Addon privado con base de datos',
    logo: db.addonsBrand?.logo || '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'tv'],
    catalogs: [
      { type: 'movie', id: db.catalogIds.movie, name: 'Películas' },
      { type: 'series', id: db.catalogIds.series, name: 'Series' },
      { type: 'tv', id: db.catalogIds.tv, name: 'TV en directo' }
    ],
    behaviorHints: { configurable: false, configurationRequired: false }
  };
  return sendJson(res, 200, manifest);
};
