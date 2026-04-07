
const { sendJson, handleOptions, requireAddonToken, makeMeta, parseUrl } = require('./lib/common');
const { getCatalog } = require('./lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAddonToken(req, res)) return;

  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const catalogId = url.searchParams.get('id');
  const db = await getCatalog();
  let items = db.items.filter(x => !type || x.type === type);
  const hidden = new Set((db.settings?.hiddenCategories || []).map(x => String(x).trim().toLowerCase()).filter(Boolean));

  if (type === 'tv' && catalogId && String(catalogId).startsWith('tvcat_')) {
    const categorySlug = String(catalogId).slice(6);
    items = items.filter(x => {
      const cat = String(x.category || x.description || (x.genres && x.genres[0]) || 'General').trim();
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
      const cat = String(x.category || x.description || (x.genres && x.genres[0]) || 'General').trim();
      return !hidden.has(String(cat).toLowerCase());
    });
  }

  const metas = items.map(item => makeMeta(item, db));
  return sendJson(res, 200, { metas });
};
