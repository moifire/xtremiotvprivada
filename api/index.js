import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ADMIN_USER = String(process.env.ADMIN_USER || 'admin');
const ADMIN_PASS = String(process.env.ADMIN_PASS || 'admin123');
const SESSION_SECRET = String(process.env.SESSION_SECRET || 'change_me');
const UPSTASH_URL = String(process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
const UPSTASH_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

const CATALOG_KEY = String(process.env.CATALOG_KEY || 'xtremio:catalog');
const USERS_KEY = String(process.env.USERS_KEY || 'xtremio:users');
const CACHE_INFO_KEY = String(process.env.CACHE_INFO_KEY || 'xtremio:cache-info');

const FALLBACK_DIR = path.join(process.cwd(), 'data');
const FALLBACK_CATALOG = path.join(FALLBACK_DIR, 'catalog.sample.json');
const FALLBACK_USERS = path.join(FALLBACK_DIR, 'users.sample.json');
const FALLBACK_CACHE_INFO = path.join(FALLBACK_DIR, 'cache-info.sample.json');

export default async function handler(req, res) {
  try {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const url = getRequestUrl(req);
    const pathname = getOriginalPath(req, url);

    if (pathname.startsWith('/api/admin/')) {
      return await handleAdmin(req, res, url, pathname);
    }

    const userMatch = pathname.match(/^\/u\/([^/]+)\/(.+)$/);
    if (userMatch) {
      const token = decodeURIComponent(userMatch[1]);
      const endpoint = userMatch[2];

      const user = await getUserByToken(token);
      if (!user) return sendJson(res, 401, { error: 'Token no válido' });

      if (endpoint === 'configure') {
        return serveConfigurePage(res, user, token);
      }

      if (endpoint === 'refresh-cache' && req.method === 'POST') {
        const info = await bumpCacheVersion();
        return sendJson(res, 200, { ok: true, ...info });
      }

      if (!isUserActive(user)) return sendJson(res, 401, { error: 'Usuario caducado o desactivado' });

      const ip = getClientIp(req);
      const tracked = await trackUserConnection(user.id, ip);
      if (!tracked.ok) return sendJson(res, 401, { error: tracked.error });

      if (endpoint === 'manifest.json') return await serveManifest(req, res, token);
      if (endpoint.startsWith('catalog/')) return await serveCatalog(req, res, endpoint);
      if (endpoint.startsWith('meta/')) return await serveMeta(req, res, endpoint);
      if (endpoint.startsWith('stream/')) return await serveStream(req, res, endpoint);

      return sendJson(res, 404, { error: 'Ruta no encontrada' });
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    return sendJson(res, 500, { error: error?.message || 'Error interno' });
  }
}

async function handleAdmin(req, res, url, pathname) {
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await readJsonBody(req);

    if (String(body.username || '') !== ADMIN_USER || String(body.password || '') !== ADMIN_PASS) {
      return sendJson(res, 401, { error: 'Credenciales incorrectas' });
    }

    const token = createSessionToken({
      username: ADMIN_USER,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    setAdminCookie(req, res, token, false);
    return sendJson(res, 200, { ok: true, username: ADMIN_USER });
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    setAdminCookie(req, res, '', true);
    return sendJson(res, 200, { ok: true });
  }

  const session = getAdminSession(req);
  if (!session) return sendJson(res, 401, { error: 'Sesión no válida' });

  if (pathname === '/api/admin/session' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, username: session.username });
  }

  if (pathname === '/api/admin/cache-info' && req.method === 'GET') {
    const info = await getCacheInfo();
    return sendJson(res, 200, info);
  }

  if (pathname === '/api/admin/refresh-cache' && req.method === 'POST') {
    const info = await bumpCacheVersion();
    return sendJson(res, 200, { ok: true, ...info });
  }

  if (pathname === '/api/admin/health' && req.method === 'GET') {
    const test = await testRedisConnection();
    const users = await getUsers();
    const catalog = await getCatalog();
    const cacheInfo = await getCacheInfo();

    const expiringSoon = users.filter((u) => {
      if (!u?.expiresAt || u?.enabled === false) return false;
      const ms = Date.parse(u.expiresAt) - Date.now();
      return ms > 0 && ms <= 7 * 24 * 60 * 60 * 1000;
    }).length;

    const expiredUsers = users.filter((u) => !isUserActive(u)).length;

    return sendJson(res, 200, {
      ok: true,
      storage: hasRedis() ? 'upstash' : 'archivo-local',
      redis: test,
      env: {
        hasAdminUser: Boolean(ADMIN_USER),
        hasAdminPass: Boolean(ADMIN_PASS),
        hasSessionSecret: Boolean(SESSION_SECRET && SESSION_SECRET !== 'change_me'),
        hasUpstashUrl: Boolean(UPSTASH_URL),
        hasUpstashToken: Boolean(UPSTASH_TOKEN)
      },
      users: users.length,
      items: catalog.items.length,
      expiringSoon,
      expiredUsers,
      cacheInfo
    });
  }

  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const users = await getUsers();
    users.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return sendJson(res, 200, { users });
  }

  if (pathname === '/api/admin/users' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const users = await getUsers();

    const id = String(body.id || crypto.randomUUID());
    const existingIndex = users.findIndex((u) => u.id === id);
    const token = String(body.token || '').trim() || makeUserToken(body.name || 'cliente');

    if (!String(body.name || '').trim()) {
      return sendJson(res, 400, { error: 'El nombre es obligatorio' });
    }

    if (users.some((u) => u.token === token && u.id !== id)) {
      return sendJson(res, 400, { error: 'Ese token ya existe' });
    }

    const current = existingIndex >= 0 ? users[existingIndex] : null;
    const next = {
      id,
      name: String(body.name || '').trim(),
      token,
      enabled: body.enabled !== false,
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      maxConnections: Math.max(1, Number(body.maxConnections || 1)),
      plan: normalizePlan(body.plan),
      notes: String(body.notes || '').trim(),
      ips: Array.isArray(current?.ips) ? current.ips : [],
      lastAccessAt: current?.lastAccessAt || null,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) users[existingIndex] = next;
    else users.push(next);

    await saveUsers(users);

    return sendJson(res, 200, {
      ok: true,
      user: next,
      installUrl: `${siteBase(req)}/u/${encodeURIComponent(next.token)}/manifest.json`
    });
  }

  if (pathname === '/api/admin/users/renew' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === String(body.id || ''));

    if (idx < 0) return sendJson(res, 404, { error: 'Usuario no encontrado' });

    const plan = normalizePlan(body.plan || users[idx].plan);
    const days = Number(body.days || planDays(plan));

    if (!days || days < 1) {
      return sendJson(res, 400, { error: 'Renovación no válida' });
    }

    const baseTs =
      users[idx].expiresAt && Date.parse(users[idx].expiresAt) > Date.now()
        ? Date.parse(users[idx].expiresAt)
        : Date.now();

    users[idx].expiresAt = new Date(baseTs + days * 24 * 60 * 60 * 1000).toISOString();
    users[idx].plan = plan;
    users[idx].updatedAt = new Date().toISOString();

    await saveUsers(users);
    return sendJson(res, 200, { ok: true, user: users[idx] });
  }

  if (pathname === '/api/admin/users/delete' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const users = await getUsers();
    const next = users.filter((u) => u.id !== String(body.id || ''));
    await saveUsers(next);
    return sendJson(res, 200, { ok: true, count: next.length });
  }

  if (pathname === '/api/admin/users/reset-ips' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const users = await getUsers();
    const idx = users.findIndex((u) => u.id === String(body.id || ''));

    if (idx < 0) return sendJson(res, 404, { error: 'Usuario no encontrado' });

    users[idx].ips = [];
    users[idx].updatedAt = new Date().toISOString();

    await saveUsers(users);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/catalog' && req.method === 'GET') {
    return sendJson(res, 200, await getCatalog());
  }

  if (pathname === '/api/admin/catalog' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const items = normalizeCatalog(Array.isArray(body.items) ? body.items : []);
    await saveCatalog({ items });
    const cacheInfo = await bumpCacheVersion();
    return sendJson(res, 200, { ok: true, count: items.length, cacheInfo });
  }

  if (pathname === '/api/admin/catalog/import-m3u' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const text = String(body.text || '');

    if (!text.trim()) {
      return sendJson(res, 400, { error: 'Archivo M3U vacío' });
    }

    const parsed = parseM3U(text);
    await saveCatalog({ items: parsed });
    const cacheInfo = await bumpCacheVersion();

    return sendJson(res, 200, {
      ok: true,
      count: parsed.length,
      cacheInfo
    });
  }

  if (pathname === '/api/admin/clear-db' && req.method === 'POST') {
    await saveCatalog({ items: [] });
    const cacheInfo = await bumpCacheVersion();
    return sendJson(res, 200, { ok: true, cacheInfo });
  }

  return sendJson(res, 404, { error: 'Ruta admin no encontrada' });
}

function normalizePlan(value) {
  const plan = String(value || 'mensual').trim().toLowerCase();
  if (plan === 'mensual' || plan === 'trimestral' || plan === 'anual' || plan === 'personalizado') {
    return plan;
  }
  return 'mensual';
}

function planDays(plan) {
  if (plan === 'trimestral') return 90;
  if (plan === 'anual') return 365;
  if (plan === 'personalizado') return 30;
  return 30;
}

async function serveManifest(req, res, token) {
  const catalog = await getCatalog();
  const cacheInfo = await getCacheInfo();

  const categories = unique(
    catalog.items
      .filter((item) => (item.type || 'tv') === 'tv')
      .map((item) => item.category || 'General')
  );

  const tvCatalogs = categories.length
    ? categories.map((category) => ({
        type: 'tv',
        id: `${slug(category)}-v${cacheInfo.version}`,
        name: `TV · ${category}`,
        extra: [{ name: 'search' }]
      }))
    : [{ type: 'tv', id: `all-v${cacheInfo.version}`, name: 'TV', extra: [{ name: 'search' }] }];

  return sendJson(res, 200, {
    id: 'com.moistremiotv.private.v5',
    version: `5.1.${Number(cacheInfo?.version || 1)}`,
    name: 'MoiStremioTV Private Legal PRO v5',
    description: 'Catálogo privado con usuarios, caducidad, conexiones, QR y panel admin.',
    logo: '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv', 'movie', 'series'],
    catalogs: [
      ...tvCatalogs,
      { type: 'movie', id: `movies-v${cacheInfo.version}`, name: 'Películas', extra: [{ name: 'search' }] },
      { type: 'series', id: `series-v${cacheInfo.version}`, name: 'Series', extra: [{ name: 'search' }] }
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    },
    config: [
      {
        key: 'panel',
        type: 'text',
        title: 'Abrir panel MoiStremioTV',
        required: false
      }
    ],
    transportUrl: `${siteBase(req)}/u/${encodeURIComponent(token)}`
  });
}

async function serveCatalog(req, res, endpoint) {
  const match = endpoint.match(/^catalog\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return sendJson(res, 404, { error: 'Ruta de catálogo no válida' });

  const [, type, catalogId] = match;
  const cleanCatalogId = String(catalogId).replace(/-v\d+$/, '');
  const url = getRequestUrl(req);
  const search = String(url.searchParams.get('search') || '').toLowerCase().trim();

  const catalog = await getCatalog();
  let items = catalog.items.filter((item) => (item.type || 'tv') === type);

  if (type === 'tv' && cleanCatalogId !== 'all') {
    items = items.filter((item) => slug(item.category || 'General') === cleanCatalogId);
  }

  if (type === 'movie' && cleanCatalogId !== 'movies') items = [];
  if (type === 'series' && cleanCatalogId !== 'series') items = [];
  if (search) {
    items = items.filter((item) =>
      `${item.name} ${item.description || ''} ${item.category || ''}`.toLowerCase().includes(search)
    );
  }

  return sendJson(res, 200, { metas: items.map(toMetaPreview) });
}

async function serveMeta(req, res, endpoint) {
  const match = endpoint.match(/^meta\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return sendJson(res, 404, { error: 'Ruta meta no válida' });

  const [, type, id] = match;
  const item = (await getCatalog()).items.find(
    (entry) => entry.id === id && (entry.type || 'tv') === type
  );

  if (!item) return sendJson(res, 404, { error: 'Item no encontrado' });
  return sendJson(res, 200, { meta: toMetaFull(item) });
}

async function serveStream(req, res, endpoint) {
  const match = endpoint.match(/^stream\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return sendJson(res, 404, { error: 'Ruta stream no válida' });

  const [, type, id] = match;
  const item = (await getCatalog()).items.find(
    (entry) => entry.id === id && (entry.type || 'tv') === type
  );

  if (!item) return sendJson(res, 404, { error: 'Item no encontrado' });

  const streams = [];
  if (item.streamUrl) {
    streams.push({
      title: item.streamTitle || item.name,
      url: item.streamUrl,
      behaviorHints: { notWebReady: false }
    });
  }
  if (item.ytId) {
    streams.push({
      title: item.name,
      ytId: item.ytId
    });
  }

  return sendJson(res, 200, { streams });
}

function toMetaPreview(item) {
  return {
    id: item.id,
    type: item.type || 'tv',
    name: item.name,
    poster: item.poster || item.background || '',
    posterShape: item.posterShape || 'regular',
    background: item.background || item.poster || '',
    description: item.description || '',
    genres: item.genres || (item.category ? [item.category] : [])
  };
}

function toMetaFull(item) {
  return {
    ...toMetaPreview(item),
    releaseInfo: item.releaseInfo || '',
    runtime: item.runtime || '',
    videos: item.videos || undefined,
    links: item.links || undefined
  };
}

function normalizeCatalog(items) {
  return items.map((item, index) => ({
    id: String(item.id || `xtv_${index + 1}`),
    type: String(item.type || 'tv'),
    name: String(item.name || `Canal ${index + 1}`),
    poster: String(item.poster || ''),
    posterShape: String(item.posterShape || 'regular'),
    background: String(item.background || ''),
    description: String(item.description || ''),
    genres: Array.isArray(item.genres)
      ? item.genres.map(String)
      : [String(item.category || 'General')],
    category: String(
      item.category || (Array.isArray(item.genres) && item.genres[0]) || 'General'
    ),
    streamUrl: String(item.streamUrl || item.url || ''),
    streamTitle: String(item.streamTitle || ''),
    ytId: String(item.ytId || ''),
    releaseInfo: String(item.releaseInfo || ''),
    runtime: String(item.runtime || '')
  }));
}

function parseM3U(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const name = line.includes(',')
        ? line.slice(line.indexOf(',') + 1).trim()
        : `Canal ${items.length + 1}`;
      const category = extractM3UAttr(line, 'group-title') || 'General';

      current = {
        id: `xtv_${items.length + 1}`,
        type: 'tv',
        name,
        poster: extractM3UAttr(line, 'tvg-logo') || '',
        background: '',
        description: category,
        genres: [category],
        category,
        streamUrl: '',
        streamTitle: ''
      };
      continue;
    }

    if (!line.startsWith('#') && current) {
      current.streamUrl = line;
      items.push(current);
      current = null;
    }
  }

  return normalizeCatalog(items);
}

function extractM3UAttr(line, attr) {
  const match = String(line).match(new RegExp(`${attr}="([^"]*)"`));
  return match ? match[1] : '';
}

function makeUserToken(name) {
  const base = slug(name || 'cliente') || 'cliente';
  return `${base}_${crypto.randomBytes(4).toString('hex')}`;
}

function isUserActive(user) {
  if (!user?.enabled) return false;
  if (!user.expiresAt) return true;
  const time = new Date(user.expiresAt).getTime();
  return Number.isFinite(time) && time > Date.now();
}

async function trackUserConnection(userId, ip) {
  const users = await getUsers();
  const index = users.findIndex((user) => user.id === userId);

  if (index < 0) return { ok: false, error: 'Usuario no encontrado' };

  const user = users[index];
  const currentIps = Array.isArray(user.ips) ? user.ips : [];

  if (ip && !currentIps.includes(ip)) {
    if (currentIps.length >= Number(user.maxConnections || 1)) {
      return { ok: false, error: 'Máximo de conexiones/IPs alcanzado' };
    }
    currentIps.push(ip);
  }

  users[index] = {
    ...user,
    ips: currentIps,
    lastAccessAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveUsers(users);
  return { ok: true };
}

async function getUserByToken(token) {
  const users = await getUsers();
  return users.find((user) => user.token === token) || null;
}

async function getUsers() {
  const stored = await loadJson(USERS_KEY, { users: [] }, FALLBACK_USERS);
  return Array.isArray(stored.users) ? stored.users : [];
}

async function saveUsers(users) {
  await saveJson(USERS_KEY, { users }, FALLBACK_USERS);
}

async function getCatalog() {
  const stored = await loadJson(CATALOG_KEY, { items: [] }, FALLBACK_CATALOG);
  return { items: normalizeCatalog(Array.isArray(stored.items) ? stored.items : []) };
}

async function saveCatalog(catalog) {
  await saveJson(
    CATALOG_KEY,
    { items: normalizeCatalog(Array.isArray(catalog.items) ? catalog.items : []) },
    FALLBACK_CATALOG
  );
}

async function getCacheInfo() {
  const fallback = { version: 1, updatedAt: null };
  const stored = await loadJson(CACHE_INFO_KEY, fallback, FALLBACK_CACHE_INFO);

  return {
    version: Number(stored?.version || 1),
    updatedAt: stored?.updatedAt || null
  };
}

async function bumpCacheVersion() {
  const current = await getCacheInfo();
  const next = {
    version: Number(current.version || 1) + 1,
    updatedAt: new Date().toISOString()
  };

  await saveJson(CACHE_INFO_KEY, next, FALLBACK_CACHE_INFO);
  return next;
}

async function loadJson(key, fallback, filePath) {
  if (hasRedis()) {
    const raw = await redisGet(key);
    if (raw) return safeJson(raw, fallback);
  }

  try {
    const file = await fs.readFile(filePath, 'utf8');
    const parsed = safeJson(file, fallback);
    if (hasRedis()) await redisSet(key, JSON.stringify(parsed));
    return parsed;
  } catch {
    return fallback;
  }
}

async function saveJson(key, value, filePath) {
  if (hasRedis()) {
    await redisSet(key, JSON.stringify(value));
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function hasRedis() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function testRedisConnection() {
  if (!hasRedis()) {
    return {
      ok: false,
      mode: 'archivo-local',
      message: 'Faltan UPSTASH_REDIS_REST_URL o UPSTASH_REDIS_REST_TOKEN'
    };
  }

  try {
    const ping = await redisCommand(['PING']);
    const testKey = `xtremio:test:${Date.now()}`;

    await redisCommand(['SET', testKey, 'ok']);
    const got = await redisCommand(['GET', testKey]);
    await redisCommand(['DEL', testKey]);

    return {
      ok: ping === 'PONG' && got === 'ok',
      mode: 'upstash',
      ping,
      readback: got
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'upstash',
      message: error?.message || 'Error conectando con Redis'
    };
  }
}

async function redisGet(key) {
  return await redisCommand(['GET', key]);
}

async function redisSet(key, value) {
  return await redisCommand(['SET', key, value]);
}

async function redisCommand(command) {
  const response = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Upstash error ${response.status}`);
  }

  return data.result ?? null;
}

function getRequestUrl(req) {
  return new URL(req.url, siteBase(req));
}

function getOriginalPath(req, url) {
  return String(
    url.searchParams.get('__pathname') ||
      req.headers['x-original-path'] ||
      req.headers['x-rewrite-path'] ||
      url.pathname
  );
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(JSON.stringify(body));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});

      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function getCookies(req) {
  const cookieHeader = String(req.headers.cookie || '');
  const cookies = {};

  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join('='));
  }

  return cookies;
}

function createSessionToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('hex');
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;

  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('hex');

  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAdminSession(req) {
  const cookies = getCookies(req);
  return verifySessionToken(cookies.xt_admin || '');
}

function setAdminCookie(req, res, token, clear = false) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  const value = clear ? '' : encodeURIComponent(token);
  const maxAge = clear ? '; Max-Age=0' : `; Max-Age=${7 * 24 * 60 * 60}`;
  res.setHeader(
    'Set-Cookie',
    `xt_admin=${value}; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge}`
  );
}

function siteBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${proto}://${host}`;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

function slug(value) {
  return (
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'general'
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
function calcRemainingForClient(user) {
  if (!user?.expiresAt) {
    return { label: 'Sin caducidad', expired: false };
  }

  const ms = new Date(user.expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return { label: 'Caducado', expired: true };
  }

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return {
    label: `${parts.join(' ')} restantes`,
    expired: false
  };
}

function planLabelClient(plan) {
  return ({ mensual:'Mensual', trimestral:'Trimestral', anual:'Anual', personalizado:'Personalizado' })[plan] || 'Mensual';
}

function escapeHtmlClient(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]
  ));
}

function serveConfigurePage(res, user, token) {
  const left = calcRemainingForClient(user);
  const safeName = escapeHtmlClient(user.name || 'Cliente');
  const safePlan = escapeHtmlClient(planLabelClient(user.plan || 'mensual'));
  const safeState = escapeHtmlClient(user.enabled !== false && !left.expired ? 'ACTIVO' : 'CADUCADO / INACTIVO');
  const safeExpires = escapeHtmlClient(user.expiresAt ? new Date(user.expiresAt).toLocaleDateString() : 'Sin fecha');
  const safeRemaining = escapeHtmlClient(left.label);
  const safeConnections = escapeHtmlClient(String(user.maxConnections || 1));

  const deviceColor = Number(user.maxConnections || 1) <= 1
    ? '#22c55e'
    : Number(user.maxConnections || 1) === 2
      ? '#f59e0b'
      : '#ef4444';

  const planColor = (user.plan === 'anual')
    ? '#7c3aed'
    : (user.plan === 'trimestral')
      ? '#d4a514'
      : '#e50914';

  const countdownText = escapeHtmlClient(left.label);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MoiStremioTV · Configuración</title>
<style>
:root{
  --bg:#050916;--panel:#0d1428;--line:#21304f;--text:#f8fafc;--muted:#94a3b8;
  --red:#ef4444;--green:#22c55e;--blue:#2563eb;--gold:#f59e0b;--purple:#7c3aed;
}
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background:
    radial-gradient(circle at top left, rgba(229,9,20,.20) 0, rgba(5,9,22,0) 35%),
    radial-gradient(circle at top right, rgba(124,58,237,.16) 0, rgba(5,9,22,0) 30%),
    #050916;
  color:var(--text);
  font-family:Inter,Arial,sans-serif;
  padding:20px;
}
.wrap{width:min(980px,100%)}
.card{
  background:rgba(13,20,40,.98);
  border:1px solid #2a3554;
  border-radius:28px;
  overflow:hidden;
  box-shadow:0 30px 90px rgba(0,0,0,.42);
}
.hero{
  position:relative;
  padding:28px;
  background:
    linear-gradient(135deg, rgba(229,9,20,.22), rgba(124,58,237,.10)),
    linear-gradient(180deg, #141d35, #0b1226);
  border-bottom:1px solid #2a3554;
}
.brand{font-size:40px;font-weight:900;line-height:1}
.brand .accent{color:#ef4444}
.subtitle{color:#cbd5e1;margin-top:8px;font-size:15px}
.badges{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.badge{
  display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;
  border:1px solid rgba(255,255,255,.12);font-weight:800;font-size:13px
}
.grid{
  display:grid;grid-template-columns:1.2fr .8fr;gap:18px;padding:22px
}
.panel{
  background:#0a1120;border:1px solid #243453;border-radius:22px;padding:18px
}
.lines{display:grid;gap:12px}
.line{
  display:flex;justify-content:space-between;gap:10px;
  padding:14px 16px;border-radius:18px;background:#0c1730;border:1px solid #243453
}
.label{color:#9fb0c8;font-size:13px}
.value{font-weight:800;text-align:right}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
button{
  border:0;border-radius:16px;padding:12px 18px;font-weight:800;color:#fff;cursor:pointer
}
.btn-green{background:#22c55e}
.btn-blue{background:#2563eb}
.msg{margin-top:14px;font-size:14px;color:#cbd5e1}
.note{margin-top:12px;font-size:12px;color:#94a3b8}
.side-card{
  border-radius:24px;padding:18px;background:
  linear-gradient(180deg, rgba(18,26,49,.98), rgba(10,17,32,.98));
  border:1px solid #2c3d66;
}
.poster{
  border-radius:22px;
  min-height:210px;
  background:
    linear-gradient(180deg, rgba(0,0,0,.08), rgba(0,0,0,.55)),
    linear-gradient(135deg, ${planColor}, ${deviceColor});
  border:1px solid rgba(255,255,255,.10);
  display:flex;flex-direction:column;justify-content:space-between;padding:16px
}
.poster-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.poster-brand{font-weight:900;font-size:24px;line-height:1.05}
.poster-brand span{color:#fff}
.poster-mini{font-size:12px;opacity:.9;font-weight:700}
.pill{
  display:inline-flex;align-items:center;justify-content:center;
  padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.12);
  border:1px solid rgba(255,255,255,.18);font-size:12px;font-weight:900
}
.poster-title{
  font-size:26px;font-weight:900;line-height:1.02;max-width:260px;
  text-shadow:0 6px 18px rgba(0,0,0,.35)
}
.poster-meta{display:grid;gap:8px}
.meta-chip{
  display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;
  background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.12);width:max-content;font-size:12px;font-weight:900
}
.qrbox{
  background:#fff;border-radius:18px;min-height:180px;display:flex;align-items:center;justify-content:center;
  margin-top:16px;padding:10px
}
.countdown{
  margin-top:14px;padding:12px 14px;border-radius:16px;background:#091121;border:1px solid #243453;
  font-weight:900;font-size:14px;color:#e2e8f0
}
.live-dot{
  width:10px;height:10px;border-radius:999px;background:${deviceColor};box-shadow:0 0 0 8px rgba(255,255,255,.04)
}
@media (max-width: 860px){
  .grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <div class="brand">Moi<span class="accent">StremioTV</span></div>
        <div class="subtitle">Panel cliente PRO · Actualiza el addon sin reinstalar</div>
        <div class="badges">
          <div class="badge" style="background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.28)"><span class="live-dot"></span>${safeState}</div>
          <div class="badge" style="background:rgba(229,9,20,.12);border-color:rgba(229,9,20,.28)">PLAN ${safePlan.toUpperCase()}</div>
          <div class="badge" style="background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.28)">${safeConnections} DISPOSITIVO(S)</div>
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="lines">
            <div class="line"><div class="label">Usuario</div><div class="value">${safeName}</div></div>
            <div class="line"><div class="label">Plan</div><div class="value">${safePlan}</div></div>
            <div class="line"><div class="label">Conexiones</div><div class="value">${safeConnections}</div></div>
            <div class="line"><div class="label">Caduca</div><div class="value">${safeExpires}</div></div>
            <div class="line"><div class="label">Estado</div><div class="value">${safeState}</div></div>
            <div class="line"><div class="label">Tiempo restante</div><div class="value" id="remainingValue">${safeRemaining}</div></div>
          </div>

          <div class="actions">
            <button class="btn-green" id="refreshBtn">🚀 Actualizar servidor</button>
            <button class="btn-blue" id="reinstallBtn">♻️ Reinstalar addon actualizado</button>
            <button class="btn-blue" id="copyBtn">🔗 Copiar acceso</button>
          </div>

          <div id="msg" class="msg"></div>
          <div class="note">Primero actualiza el servidor. Después pulsa “Reinstalar addon actualizado”.</div>
        </div>

        <div class="side-card">
          <div class="poster">
            <div class="poster-top">
              <div>
                <div class="poster-mini">ACCESO PRIVADO</div>
                <div class="poster-brand">Moi<span>StremioTV</span></div>
              </div>
              <div class="pill">PRO</div>
            </div>

            <div class="poster-title">${safePlan} · ${safeConnections} disp.</div>

            <div class="poster-meta">
              <div class="meta-chip">🎬 Cine · Series · TV</div>
              <div class="meta-chip">⚽ Eventos deportivos</div>
              <div class="meta-chip">⏳ ${countdownText}</div>
            </div>
          </div>

          <div class="qrbox">
            <canvas id="qrCanvas" width="180" height="180"></canvas>
          </div>

          <div class="countdown" id="countdownBox">Tiempo restante: ${countdownText}</div>
        </div>
      </div>
    </div>
  </div>

<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
<script>
const token = ${JSON.stringify(token)};
let cacheVersion = ${JSON.stringify(user.updatedAt || Date.now())};
const manifestUrl = () => `/u/${encodeURIComponent(token)}/manifest.json?v=${encodeURIComponent(cacheVersion)}`;
const refreshUrl = `/u/${encodeURIComponent(token)}/refresh-cache`;
const expiresAt = ${JSON.stringify(user.expiresAt || null)};
const msg = document.getElementById('msg');

async function drawQr() {
  const canvas = document.getElementById('qrCanvas');
  if (!window.QRCode) {
    msg.textContent = 'QR no disponible';
    return;
  }
  try {
    await QRCode.toCanvas(canvas, location.origin + manifestUrl(), {
      width: 180,
      margin: 1,
      color: { dark: '#111827', light: '#ffffff' }
    });
  } catch {
    msg.textContent = 'No se pudo generar el QR';
  }
}

function tickCountdown() {
  if (!expiresAt) return;
  const target = new Date(expiresAt).getTime();
  const now = Date.now();
  const diff = target - now;
  const box = document.getElementById('countdownBox');
  const value = document.getElementById('remainingValue');
  if (diff <= 0) {
    box.textContent = 'Tiempo restante: Caducado';
    value.textContent = 'Caducado';
    return;
  }
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const txt = `${days}d ${hours}h ${minutes}m restantes`;
  box.textContent = 'Tiempo restante: ' + txt;
  value.textContent = txt;
}

async function refreshServer() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Actualizando...';
  msg.textContent = 'Actualizando servidor...';

  try {
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    cacheVersion = data.updatedAt || Date.now();
    await drawQr();
    msg.textContent = '✅ Servidor actualizado. Ahora pulsa “Reinstalar addon actualizado”.';
  } catch (e) {
    msg.textContent = '❌ No se pudo actualizar el servidor';
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Actualizar servidor';
  }
}

function reinstallAddon() {
  location.href = location.origin + manifestUrl();
}

async function copyAccess() {
  try {
    await navigator.clipboard.writeText(location.origin + manifestUrl());
    msg.textContent = '✅ Enlace copiado';
  } catch {
    msg.textContent = '❌ No se pudo copiar el enlace';
  }
}

document.getElementById('refreshBtn').addEventListener('click', refreshServer);
document.getElementById('reinstallBtn').addEventListener('click', reinstallAddon);
document.getElementById('copyBtn').addEventListener('click', copyAccess);

drawQr();
tickCountdown();
setInterval(tickCountdown, 30000);
</script>
</body>
</html>`);
}
