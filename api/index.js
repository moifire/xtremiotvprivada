import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CATALOG_KEY = process.env.CATALOG_KEY || 'xtremio:catalog';
const USERS_KEY = process.env.USERS_KEY || 'xtremio:users';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me';
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    const url = new URL(req.url, `https://${req.headers.host}`);
    const pathname = url.searchParams.get('__pathname') || req.headers['x-original-path'] || req.headers['x-rewrite-path'] || url.pathname;

    if (pathname.startsWith('/api/admin/')) {
      return handleAdmin(req, res, url);
    }

    const userMatch = pathname.match(/^\/u\/([^/]+)\/(.+)$/);
    if (userMatch) {
      const token = decodeURIComponent(userMatch[1]);
      const endpoint = userMatch[2];
      const user = await getUserByToken(token);
      if (!user) return json(res, 401, { error: 'Token no válido' });
      if (!isUserActive(user)) return json(res, 401, { error: 'Usuario caducado o desactivado' });

      const ip = getClientIp(req);
      const track = await trackUserConnection(user, ip);
      if (!track.ok) return json(res, 401, { error: track.error || 'Límite de conexiones alcanzado' });

      if (endpoint === 'manifest.json') return serveManifest(req, res, url, token);
      if (endpoint.startsWith('catalog/')) return serveCatalog(req, res, endpoint);
      if (endpoint.startsWith('meta/')) return serveMeta(req, res, endpoint);
      if (endpoint.startsWith('stream/')) return serveStream(req, res, endpoint);
      return json(res, 404, { error: 'Ruta no encontrada' });
    }

    return json(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    return json(res, 500, { error: error.message || 'Error interno' });
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const idx = v.indexOf('=');
    return [decodeURIComponent(v.slice(0, idx)), decodeURIComponent(v.slice(idx + 1))];
  }));
}

function signSession(value) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

function verifySession(signed) {
  if (!signed || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function requireAdmin(req) {
  const cookies = getCookies(req);
  return verifySession(cookies.xt_admin || '');
}

async function handleAdmin(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.username !== ADMIN_USER || body.password !== ADMIN_PASS) {
      return json(res, 401, { error: 'Credenciales incorrectas' });
    }
    const payload = Buffer.from(JSON.stringify({ username: body.username, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString('base64url');
    const cookie = signSession(payload);
    const secure = (req.headers['x-forwarded-proto'] || 'https') === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `xt_admin=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax${secure}`);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const secure = (req.headers['x-forwarded-proto'] || 'https') === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `xt_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
    return json(res, 200, { ok: true });
  }

  const session = requireAdmin(req);
  if (!session) return json(res, 401, { error: 'Sesión no válida' });

  if (pathname === '/api/admin/session' && req.method === 'GET') {
    return json(res, 200, { ok: true, username: session.username });
  }

  if (pathname === '/api/admin/health' && req.method === 'GET') {
    const users = await getUsers();
    const catalog = await getCatalog();
    return json(res, 200, {
      ok: true,
      storage: UPSTASH_URL ? 'upstash' : 'archivo-local',
      users: users.length,
      items: catalog.items.length
    });
  }

  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const users = await getUsers();
    return json(res, 200, { users: users.sort((a, b) => (a.name || '').localeCompare(b.name || '')) });
  }

  if (pathname === '/api/admin/users' && req.method === 'POST') {
    const body = await readBody(req);
    const users = await getUsers();
    const now = new Date().toISOString();
    const id = body.id || crypto.randomUUID();
    const existingIndex = users.findIndex(u => u.id === id || (body.token && u.token === body.token));
    const token = body.token?.trim() || buildToken(body.name || 'user');
    const next = {
      id,
      name: String(body.name || '').trim(),
      token,
      enabled: body.enabled !== false,
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      maxConnections: Math.max(1, Number(body.maxConnections || 1)),
      notes: String(body.notes || '').trim(),
      ips: Array.isArray(body.ips) ? body.ips : (existingIndex >= 0 ? users[existingIndex].ips || [] : []),
      lastAccessAt: existingIndex >= 0 ? users[existingIndex].lastAccessAt || null : null,
      createdAt: existingIndex >= 0 ? users[existingIndex].createdAt || now : now,
      updatedAt: now
    };
    if (!next.name) return json(res, 400, { error: 'El nombre es obligatorio' });
    const dup = users.find(u => u.token === token && u.id !== id);
    if (dup) return json(res, 400, { error: 'Ese token ya existe' });
    if (existingIndex >= 0) users[existingIndex] = { ...users[existingIndex], ...next };
    else users.push(next);
    await saveUsers(users);
    return json(res, 200, { ok: true, user: next, installUrl: `${siteBase(url, req)}/u/${encodeURIComponent(token)}/manifest.json` });
  }

  if (pathname === '/api/admin/users/delete' && req.method === 'POST') {
    const body = await readBody(req);
    const users = await getUsers();
    const next = users.filter(u => u.id !== body.id);
    await saveUsers(next);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/users/reset-ips' && req.method === 'POST') {
    const body = await readBody(req);
    const users = await getUsers();
    const idx = users.findIndex(u => u.id === body.id);
    if (idx < 0) return json(res, 404, { error: 'Usuario no encontrado' });
    users[idx].ips = [];
    users[idx].updatedAt = new Date().toISOString();
    await saveUsers(users);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/catalog' && req.method === 'GET') {
    return json(res, 200, await getCatalog());
  }

  if (pathname === '/api/admin/catalog' && req.method === 'POST') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? normalizeCatalog(body.items) : [];
    await saveCatalog({ items });
    return json(res, 200, { ok: true, count: items.length });
  }

  if (pathname === '/api/admin/catalog/import-m3u' && req.method === 'POST') {
    const body = await readBody(req);
    const parsed = parseM3U(String(body.text || ''));
    await saveCatalog({ items: parsed });
    return json(res, 200, { ok: true, count: parsed.length });
  }

  if (pathname === '/api/admin/clear-db' && req.method === 'POST') {
    await saveCatalog({ items: [] });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Ruta admin no encontrada' });
}

async function serveManifest(req, res, url, token) {
  const catalog = await getCatalog();
  const base = `${siteBase(url, req)}/u/${encodeURIComponent(token)}`;
  const categories = unique(catalog.items.map(item => item.category).filter(Boolean));
  const catalogs = categories.map(cat => ({ type: 'tv', id: slug(cat), name: `TV · ${cat}`, extra: [{ name: 'search' }] }));
  if (!catalogs.length) catalogs.push({ type: 'tv', id: 'all', name: 'TV', extra: [{ name: 'search' }] });
  return json(res, 200, {
    id: 'com.moitube.ultra.private.clean',
    version: '4.0.0',
    name: 'MoiTube Ultra Private Legal PRO',
    description: 'Catálogo privado con usuarios, caducidad y máximas conexiones.',
    logo: '',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv', 'movie', 'series'],
    catalogs,
    idPrefixes: ['xtv_'],
    behaviorHints: { configurable: false, configurationRequired: false },
    transportUrl: base
  });
}

async function serveCatalog(req, res, endpoint) {
  const match = endpoint.match(/^catalog\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return json(res, 404, { error: 'Ruta de catálogo no válida' });
  const [, type, catalogId] = match;
  const url = new URL(req.url, `https://${req.headers.host}`);
  const search = (url.searchParams.get('search') || '').toLowerCase().trim();
  const catalog = await getCatalog();
  let items = catalog.items.filter(item => item.type === type || (type === 'tv' && !item.type));
  if (catalogId !== 'all') items = items.filter(item => slug(item.category || '') === catalogId);
  if (search) items = items.filter(item => `${item.name} ${item.description || ''} ${item.category || ''}`.toLowerCase().includes(search));
  return json(res, 200, { metas: items.map(toMetaPreview) });
}

async function serveMeta(req, res, endpoint) {
  const match = endpoint.match(/^meta\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return json(res, 404, { error: 'Ruta meta no válida' });
  const [, type, id] = match;
  const catalog = await getCatalog();
  const item = catalog.items.find(v => v.id === id && (v.type || 'tv') === type);
  if (!item) return json(res, 404, { error: 'Item no encontrado' });
  return json(res, 200, { meta: toMetaFull(item) });
}

async function serveStream(req, res, endpoint) {
  const match = endpoint.match(/^stream\/([^/]+)\/([^/.]+)\.json$/);
  if (!match) return json(res, 404, { error: 'Ruta stream no válida' });
  const [, type, id] = match;
  const catalog = await getCatalog();
  const item = catalog.items.find(v => v.id === id && (v.type || 'tv') === type);
  if (!item) return json(res, 404, { error: 'Item no encontrado' });
  const streams = [];
  if (item.streamUrl) {
    streams.push({
      title: item.streamTitle || item.name,
      url: item.streamUrl,
      behaviorHints: { notWebReady: false }
    });
  }
  if (item.ytId) streams.push({ title: item.name, ytId: item.ytId });
  return json(res, 200, { streams });
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
    type: item.type || 'tv',
    name: String(item.name || `Canal ${index + 1}`),
    poster: String(item.poster || ''),
    posterShape: item.posterShape || 'regular',
    background: String(item.background || ''),
    description: String(item.description || ''),
    genres: Array.isArray(item.genres) ? item.genres : (item.category ? [String(item.category)] : []),
    category: String(item.category || (Array.isArray(item.genres) && item.genres[0]) || 'General'),
    streamUrl: String(item.streamUrl || item.url || ''),
    streamTitle: String(item.streamTitle || ''),
    ytId: String(item.ytId || ''),
    releaseInfo: String(item.releaseInfo || ''),
    runtime: String(item.runtime || '')
  }));
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#EXTINF:')) {
      const name = trimmed.split(',').slice(1).join(',').trim() || 'Canal';
      current = {
        id: `xtv_${items.length + 1}`,
        type: 'tv',
        name,
        description: '',
        poster: extractAttr(trimmed, 'tvg-logo') || '',
        category: extractAttr(trimmed, 'group-title') || 'General',
        genres: [extractAttr(trimmed, 'group-title') || 'General'],
        streamUrl: ''
      };
    } else if (!trimmed.startsWith('#') && current) {
      current.streamUrl = trimmed;
      items.push(current);
      current = null;
    }
  }
  return items;
}

function extractAttr(text, attr) {
  const match = text.match(new RegExp(`${attr}="([^"]*)"`));
  return match ? match[1] : '';
}

function buildToken(name) {
  const base = slug(name || 'user') || 'user';
  return `${base}_${crypto.randomBytes(4).toString('hex')}`;
}

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function unique(items) {
  return [...new Set(items)];
}

function siteBase(url, req) {
  const proto = req?.headers['x-forwarded-proto'] || url.protocol.replace(':','') || 'https';
  const host = req?.headers['x-forwarded-host'] || req?.headers.host || url.host;
  return `${proto}://${host}`;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '0.0.0.0';
}

function isUserActive(user) {
  if (!user?.enabled) return false;
  if (!user.expiresAt) return true;
  return new Date(user.expiresAt).getTime() > Date.now();
}

async function trackUserConnection(user, ip) {
  const users = await getUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx < 0) return { ok: false, error: 'Usuario no encontrado' };
  const ips = Array.isArray(users[idx].ips) ? users[idx].ips : [];
  if (!ips.includes(ip)) {
    if (ips.length >= Number(users[idx].maxConnections || 1)) {
      return { ok: false, error: 'Máximo de conexiones/IPs alcanzado' };
    }
    ips.push(ip);
  }
  users[idx].ips = ips;
  users[idx].lastAccessAt = new Date().toISOString();
  await saveUsers(users);
  return { ok: true };
}

async function getUserByToken(token) {
  const users = await getUsers();
  return users.find(u => u.token === token) || null;
}

async function getUsers() {
  const data = await loadJson(USERS_KEY, { users: [] }, path.join(process.cwd(), 'data', 'users.json'));
  return Array.isArray(data.users) ? data.users : [];
}

async function saveUsers(users) {
  return saveJson(USERS_KEY, { users }, path.join(process.cwd(), 'data', 'users.json'));
}

async function getCatalog() {
  const filePath = path.join(process.cwd(), 'data', 'catalog.sample.json');
  const data = await loadJson(CATALOG_KEY, { items: [] }, filePath);
  return { items: normalizeCatalog(Array.isArray(data.items) ? data.items : []) };
}

async function saveCatalog(catalog) {
  return saveJson(CATALOG_KEY, { items: normalizeCatalog(catalog.items || []) }, path.join(process.cwd(), 'data', 'catalog.sample.json'));
}

async function loadJson(key, fallback, filePath) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const value = await upstashGet(key);
    if (value) return safeJson(value, fallback);
    if (fallback && Object.keys(fallback).length) {
      try {
        const file = await fs.readFile(filePath, 'utf8');
        const parsed = safeJson(file, fallback);
        await upstashSet(key, JSON.stringify(parsed));
        return parsed;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
  try {
    const file = await fs.readFile(filePath, 'utf8');
    return safeJson(file, fallback);
  } catch {
    return fallback;
  }
}

async function saveJson(key, value, filePath) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstashSet(key, JSON.stringify(value));
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

async function upstashGet(key) {
  const response = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  if (!response.ok) throw new Error(`Upstash GET failed: ${response.status}`);
  const data = await response.json();
  return data.result || null;
}

async function upstashSet(key, value) {
  const response = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
  if (!response.ok) throw new Error(`Upstash SET failed: ${response.status}`);
}
