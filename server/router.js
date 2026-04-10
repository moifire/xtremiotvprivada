const { sendJson, handleOptions, parseUrl, getCatalog, buildCatalogsFromDb, makeMeta, normalizeCategoryLabel } = require('./common');
const { requirePrivateAccess } = require('./private');
const { handleAdminUsers } = require('./admin-users');

async function handleManifest(req, res) {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateAccess(req, res);
  if (!user) return;
  const db = await getCatalog();
  return sendJson(res, 200, {
    id: 'moitube-ultra-private',
    version: '1.0.0',
    name: db.addonsBrand?.name || 'MoiTube Ultra Private Legal PRO',
    description: db.addonsBrand?.description || 'Catálogo privado con usuarios',
    logo: db.addonsBrand?.logo || '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'tv'],
    catalogs: buildCatalogsFromDb(db),
  });
}

async function handleCatalog(req, res) {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateAccess(req, res);
  if (!user) return;
  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const db = await getCatalog();
  const items = db.items.filter(x => !type || x.type === type);
  return sendJson(res, 200, { metas: items.map(item => makeMeta(item, db)) });
}

async function handleMeta(req, res) {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateAccess(req, res);
  if (!user) return;
  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  const db = await getCatalog();
  const item = db.items.find(x => x.id === id && (!type || x.type === type));
  if (!item) return sendJson(res, 404, { error: 'Meta no encontrada' });
  return sendJson(res, 200, { meta: makeMeta(item, db) });
}

async function handleStream(req, res) {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateAccess(req, res);
  if (!user) return;
  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  const db = await getCatalog();
  const item = db.items.find(x => x.id === id && (!type || x.type === type));
  return sendJson(res, 200, { streams: item?.streams || [] });
}

async function handleNotFound(req, res) {
  return sendJson(res, 404, { error: 'Not found' });
}

module.exports = { handleManifest, handleCatalog, handleMeta, handleStream, handleAdminUsers, handleNotFound };
