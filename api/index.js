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

const FALLBACK_DIR = path.join(process.cwd(), 'data');
const FALLBACK_CATALOG = path.join(FALLBACK_DIR, 'catalog.sample.json');
const FALLBACK_USERS = path.join(FALLBACK_DIR, 'users.sample.json');

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
    const token = createSessionToken({ username: ADMIN_USER, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
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

  if (pathname === '/api/admin/health' && req.method === 'GET') {
    const test = await testRedisConnection();
    const users = await getUsers();
    const catalog = await getCatalog();
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
      items: catalog.items.length
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
    if (!String(body.name || '').trim()) return sendJson(res, 400, { error: 'El nombre es obligatorio' });
    if (users.some((u) => u.token === token && u.id !== id)) return sendJson(res, 400, { error: 'Ese token ya existe' });

    const current = existingIndex >= 0 ? users[existingIndex] : null;
    const next = {
      id,
      name: String(body.name || '').trim(),
      token,
      enabled: body.enabled !== false,
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      maxConnections: Math.max(1, Number(body.maxConnections || 1)),
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
    return sendJson(res, 200, { ok: true, count: items.length });
  }

  if (pathname === '/api/admin/catalog/import-m3u' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const text = String(body.text || '');
    if (!text.trim()) return sendJson(res, 400, { error: 'Archivo M3U vacío' });
    const parsed = parseM3U(text);
    await saveCatalog({ items: parsed });
    return sendJson(res, 200, { ok: true, count: parsed.length });
  }

  if (pathname === '/api/admin/clear-db' && req.method === 'POST') {
    await saveCatalog({ items: [] });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Ruta admin no encontrada' });
}

async function serveManifest(req, res, token) {
  const catalog = await getCatalog();
  const categories = unique(catalog.items.filter((item) => (item.type || 'tv') === 'tv').map((item) => item.category || 'General'));
  const tvCatalogs = categories.length
    ? categories.map((category) => ({ type: 'tv', id: slug(category), name: `TV · ${category}`, extra: [{ name: 'search' }] }))
    : [{ type: 'tv', id: 'all', name: 'TV', extra: [{ name: 'search' }] }];

  return sendJson(res, 200, {
    id: 'com.moitube.ultra.private.v4',
    version: '4.1.0',
    name: 'MoiTube Ultra Private Legal PRO',
    description: 'Catálogo privado con usuarios, caducidad, conexiones y panel admin.',
    logo: '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv', 'movie', 'series'],
    catalogs: [
      ...tvCatalogs,
      { type: 'movie', id: 'movies', name: 'Películas', extra: [{ name: 'search' }] },
      { type: 'series', id: 'series', name: 'Series', extra: [{ name: 'search' }] }
    ],
    behaviorHints: { configurable: false, configurationRequired: false },
    transportUrl: `${siteBase(req)}/u/${encodeURIComponent(token)}`
  });
}

async function serveCatalog(req, res, endpoint) {
  const match = endpoint.match(/^catalog\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return sendJson(res, 404, { error: 'Ruta de catálogo no válida' });
  const [, type, catalogId] = match;
  const url = getRequestUrl(req);
  const search = String(url.searchParams.get('search') || '').toLowerCase().trim();
  const catalog = await getCatalog();
  let items = catalog.items.filter((item) => (item.type || 'tv') === type);

  if (type === 'tv' && catalogId !== 'all') items = items.filter((item) => slug(item.category || 'General') === catalogId);
  if (type === 'movie' && catalogId !== 'movies') items = [];
  if (type === 'series' && catalogId !== 'series') items = [];
  if (search) items = items.filter((item) => `${item.name} ${item.description || ''} ${item.category || ''}`.toLowerCase().includes(search));

  return sendJson(res, 200, { metas: items.map(toMetaPreview) });
}

async function serveMeta(req, res, endpoint) {
  const match = endpoint.match(/^meta\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return sendJson(res, 404, { error: 'Ruta meta no válida' });
  const [, type, id] = match;
  const item = (await getCatalog()).items.find((entry) => entry.id === id && (entry.type || 'tv') === type);
  if (!item) return sendJson(res, 404, { error: 'Item no encontrado' });
  return sendJson(res, 200, { meta: toMetaFull(item) });
}

async function serveStream(req, res, endpoint) {
  const match = endpoint.match(/^stream\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return sendJson(res, 404, { error: 'Ruta stream no válida' });
  const [, type, id] = match;
  const item = (await getCatalog()).items.find((entry) => entry.id === id && (entry.type || 'tv') === type);
  if (!item) return sendJson(res, 404, { error: 'Item no encontrado' });
  const streams = [];
  if (item.streamUrl) streams.push({ title: item.streamTitle || item.name, url: item.streamUrl, behaviorHints: { notWebReady: false } });
  if (item.ytId) streams.push({ title: item.name, ytId: item.ytId });
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
    genres: Array.isArray(item.genres) ? item.genres.map(String) : [String(item.category || 'General')],
    category: String(item.category || (Array.isArray(item.genres) && item.genres[0]) || 'General'),
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
      const name = line.includes(',') ? line.slice(line.indexOf(',') + 1).trim() : `Canal ${items.length + 1}`;
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
  users[index] = { ...user, ips: currentIps, lastAccessAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
  await saveJson(CATALOG_KEY, { items: normalizeCatalog(Array.isArray(catalog.items) ? catalog.items : []) }, FALLBACK_CATALOG);
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
    return { ok: false, mode: 'archivo-local', message: 'Faltan UPSTASH_REDIS_REST_URL o UPSTASH_REDIS_REST_TOKEN' };
  }
  try {
    const ping = await redisCommand(['PING']);
    const testKey = `xtremio:test:${Date.now()}`;
    await redisCommand(['SET', testKey, 'ok']);
    const got = await redisCommand(['GET', testKey]);
    await redisCommand(['DEL', testKey]);
    return { ok: ping === 'PONG' && got === 'ok', mode: 'upstash', ping, readback: got };
  } catch (error) {
    return { ok: false, mode: 'upstash', message: error?.message || 'Error conectando con Redis' };
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
  if (!response.ok || data.error) throw new Error(data.error || `Upstash error ${response.status}`);
  return data.result ?? null;
}

function getRequestUrl(req) {
  return new URL(req.url, siteBase(req));
}

function getOriginalPath(req, url) {
  return String(url.searchParams.get('__pathname') || req.headers['x-original-path'] || req.headers['x-rewrite-path'] || url.pathname);
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
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
  res.setHeader('Set-Cookie', `xt_admin=${value}; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge}`);
}

function siteBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${proto}://${host}`;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
