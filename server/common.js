const fs = require('fs/promises');
const path = require('path');

const CATALOG_FILE = path.join(process.cwd(), 'data', 'catalog.json');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(body));
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end();
    return true;
  }
  return false;
}

function parseUrl(req) {
  return new URL(req.url, 'http://localhost');
}

function getBearer(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function requireAdmin(req, res) {
  const token = getBearer(req);
  if (token !== 'moifire123456') {
    sendJson(res, 401, { error: 'Admin unauthorized' });
    return null;
  }
  return { role: 'admin' };
}

function ensureCatalogShape(db) {
  db = db || {};
  db.addonsBrand = db.addonsBrand || {
    name: 'MoiTube Ultra Private Legal PRO',
    description: 'Catálogo privado con base de datos',
    logo: ''
  };
  db.catalogIds = db.catalogIds || { movie: 'movie', series: 'series', tv: 'tv' };
  db.items = Array.isArray(db.items) ? db.items : [];
  db.settings = db.settings || { hiddenCategories: [], categoryOrder: [], categoryAliases: {}, defaultPoster: '', defaultBackground: '' };
  db.settings.categoryAliases = db.settings.categoryAliases || {};
  return db;
}

async function getCatalog() {
  try {
    const raw = await fs.readFile(CATALOG_FILE, 'utf8');
    return ensureCatalogShape(JSON.parse(raw));
  } catch {
    return ensureCatalogShape({});
  }
}

function normalizeCategoryLabel(name, db) {
  const raw = String(name || 'General').trim();
  const normalized = raw
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const aliases = db?.settings?.categoryAliases || {};
  if (aliases[normalized]) return aliases[normalized];

  const rules = [
    [/sport|deporte|futbol|football|soccer|basket|nba|tennis|ufc|boxing|formula 1|motogp|golf/, 'Deportes'],
    [/show|entretenimiento|variety|reality|talent/, 'Shows'],
    [/news|noticia|informacion|informativo|actualidad/, 'Noticias'],
    [/movie|cine|pelicula|film/, 'Películas'],
    [/series|serie|drama|thriller/, 'Series'],
  ];
  for (const [regex, label] of rules) if (regex.test(normalized)) return label;
  return raw || 'General';
}

function makeMeta(item, db) {
  const defaultPoster = db?.settings?.defaultPoster || '';
  const defaultBackground = db?.settings?.defaultBackground || '';

  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description || '',
    poster: item.poster || item.logo || defaultPoster,
    background: item.posterLandscape || item.background || item.poster || defaultBackground,
    genres: item.genres || [],
    year: item.year || undefined
  };
}

function buildCatalogsFromDb(db) {
  const catalogs = [
    { type: 'movie', id: db.catalogIds.movie, name: 'Películas' },
    { type: 'series', id: db.catalogIds.series, name: 'Series' },
    { type: 'tv', id: db.catalogIds.tv, name: 'TV' }
  ];
  return catalogs;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

module.exports = {
  sendJson,
  handleOptions,
  parseUrl,
  getBearer,
  requireAdmin,
  getCatalog,
  normalizeCategoryLabel,
  makeMeta,
  buildCatalogsFromDb,
  readJsonBody,
};
