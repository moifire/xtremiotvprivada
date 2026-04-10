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
    version: '3.2.0',
    name: db.addonsBrand?.name || 'MoiTube Ultra Private Legal PRO',
    description: db.addonsBrand?.description || 'Catálogo privado PRO MAX FIXED',
    logo: db.addonsBrand?.logo || '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series', 'tv'],
    catalogs: buildCatalogsFromDb(db),
    idPrefixes: ['tv-', 'movie-', 'series-']
  });
}

async function handleCatalog(req, res) {
  if (handleOptions(req, res)) return;
  const user = await requirePrivateAccess(req, res);
  if (!user) return;

  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const catalogId = url.searchParams.get('id');
  const db = await getCatalog();
  let items = db.items.filter(x => !type || x.type === type);

  const hidden = new Set((db.settings?.hiddenCategories || []).map(x => String(x).trim().toLowerCase()).filter(Boolean));

  if (type === 'tv' && catalogId && String(catalogId).startsWith('tvcat_')) {
    const categorySlug = String(catalogId).slice(6);
    items = items.filter(x => {
      const cat = normalizeCategoryLabel(x.category || x.description || (x.genres && x.genres[0]) || 'General', db);
      const hiddenCat = hidden.has(String(cat).toLowerCase());
      const slug = String(cat)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'general';
      return !hiddenCat && slug === categorySlug;
    });
  } else if (type === 'tv') {
    items = items.filter(x => {
      const cat = normalizeCategoryLabel(x.category || x.description || (x.genres && x.genres[0]) || 'General', db);
      return !hidden.has(String(cat).toLowerCase());
    });
  }

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
  if (!item) return sendJson(res, 404, { streams: [] });

  return sendJson(res, 200, { streams: item.streams || [] });
}

async function handleNotFound(req, res) {
  return sendJson(res, 404, { error: 'Not found' });
}

module.exports = {
  handleManifest,
  handleCatalog,
  handleMeta,
  handleStream,
  handleAdminUsers,
  handleNotFound,
};
