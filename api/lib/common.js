
const crypto = require('crypto');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function parseUrl(req) {
  return new URL(req.url, 'http://localhost');
}

function randId(prefix='id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function slug(s) {
  return String(s || 'item')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
}

function signSession(payload) {
  const secret = process.env.SESSION_SECRET || '';
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

function verifySession(token) {
  const secret = process.env.SESSION_SECRET || '';
  if (!secret || !token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getBearer(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function getAddonToken(req) {
  const url = parseUrl(req);
  const qs = String(url.searchParams.get('token') || '').trim();
  return qs || getBearer(req);
}

function requireAddonToken(req, res) {
  const expected = String(process.env.ADDON_TOKEN || '').trim();
  const given = getAddonToken(req);
  if (!expected) {
    sendJson(res, 500, { error: 'Falta ADDON_TOKEN' });
    return false;
  }
  if (!given || given !== expected) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  const token = getBearer(req);
  const payload = verifySession(token);
  if (!payload || payload.role !== 'admin') {
    sendJson(res, 401, { error: 'Admin unauthorized' });
    return null;
  }
  return payload;
}

function ensureCatalogShape(db) {
  db = db || {};
  db.addonsBrand = db.addonsBrand || {
    name: 'MoiTube Ultra Private Legal PRO',
    description: 'Catálogo privado con base de datos',
    logo: ''
  };
  db.catalogIds = db.catalogIds || {
    movie: 'm_' + Math.random().toString(36).slice(2, 8),
    series: 's_' + Math.random().toString(36).slice(2, 8),
    tv: 't_' + Math.random().toString(36).slice(2, 8)
  };
  db.items = Array.isArray(db.items) ? db.items : [];
  return db;
}


function slugCategoryName(name) {
  return String(name || 'general')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'general';
}

function buildCatalogsFromDb(db) {
  const catalogs = [
    { type: 'movie', id: db.catalogIds.movie, name: 'Películas' },
    { type: 'series', id: db.catalogIds.series, name: 'Series' },
    { type: 'tv', id: db.catalogIds.tv, name: 'TV' }
  ];

  const categories = Array.from(new Set(
    (db.items || [])
      .filter(x => x.type === 'tv')
      .map(x => String(x.category || x.description || (x.genres && x.genres[0]) || 'General').trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'es'));

  for (const cat of categories) {
    catalogs.push({
      type: 'tv',
      id: 'tvcat_' + slugCategoryName(cat),
      name: 'TV · ' + cat,
      extra: [{ name: 'search' }]
    });
  }

  return catalogs;
}

function makeMeta(item) {
  const meta = {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description || '',
    poster: item.poster || '',
    background: item.background || '',
    genres: item.genres || [],
    year: item.year || undefined
  };
  if (item.type === 'series' && Array.isArray(item.videos)) {
    meta.videos = item.videos.map(v => ({
      id: v.id,
      title: v.title,
      season: v.season,
      episode: v.episode
    }));
  }
  return meta;
}

function parseM3U(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  const attrRegex = /(\w[\w-]*)="([^"]*)"/g;

  function parseAttrs(line) {
    const attrs = {};
    let m;
    while ((m = attrRegex.exec(line)) !== null) attrs[m[1]] = m[2];
    return attrs;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF:')) continue;
    const attrs = parseAttrs(line);
    const comma = line.indexOf(',');
    const displayName = comma >= 0 ? line.slice(comma + 1).trim() : (attrs['tvg-name'] || 'Canal');
    let url = '';
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next || next.startsWith('#')) continue;
      url = next;
      i = j;
      break;
    }
    if (!url) continue;
    const group = attrs['group-title'] || 'General';
    const logo = attrs['tvg-logo'] || 'https://placehold.co/600x900/png?text=TV';
    const normalizedGroup = String(group).trim() || 'General';
    items.push({
      id: 'tv-' + slug(displayName),
      type: 'tv',
      category: normalizedGroup,
      name: displayName,
      description: normalizedGroup,
      poster: logo,
      background: 'https://placehold.co/1280x720/png?text=' + encodeURIComponent(displayName),
      genres: [normalizedGroup],
      year: new Date().getFullYear(),
      streams: [{ title: 'Live', url }]
    });
  }
  return items;
}

module.exports = {
  sendJson,
  handleOptions,
  readJsonBody,
  parseUrl,
  randId,
  slug,
  signSession,
  verifySession,
  requireAddonToken,
  requireAdmin,
  ensureCatalogShape,
  makeMeta,
  parseM3U,
  buildCatalogsFromDb
};
