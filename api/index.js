
const USERS_KEY = process.env.USERS_KEY || 'xtremio:users';
const CATALOG_KEY = process.env.CATALOG_KEY || 'xtremio:catalog';
const SESSION_COOKIE = 'moistremiotv_session';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
function text(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(data);
}
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(p => {
    const idx = p.indexOf('=');
    if (idx > -1) out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}
function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function randomToken(name='user') {
  const slug = String(name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'user';
  return `${slug}_${Math.random().toString(16).slice(2,10)}`;
}
function addMonths(baseDate, months) {
  const d = new Date(baseDate);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}
function renewDate(currentExpiresAt, plan) {
  const now = new Date();
  let start = now;
  if (currentExpiresAt) {
    const current = new Date(currentExpiresAt);
    if (!Number.isNaN(current.getTime()) && current > now) start = current;
  }
  if (plan === 'monthly') return addMonths(start,1).toISOString();
  if (plan === 'quarterly') return addMonths(start,3).toISOString();
  if (plan === 'annual') return addMonths(start,12).toISOString();
  return null;
}
async function redisCmd(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash no configurado');
  const resp = await fetch(url.replace(/\/$/, '') + '/pipeline', {
    method:'POST',
    headers:{
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([args])
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error || 'Error Redis');
  const first = Array.isArray(data) ? data[0] : null;
  if (first?.error) throw new Error(first.error);
  return first?.result;
}
async function getJsonKey(key, fallback) {
  try {
    const value = await redisCmd(['GET', key]);
    if (value == null) return fallback;
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}
async function setJsonKey(key, value) {
  await redisCmd(['SET', key, JSON.stringify(value)]);
}
async function delKey(key) {
  await redisCmd(['DEL', key]);
}
async function getUsers() {
  return await getJsonKey(USERS_KEY, []);
}
async function saveUsers(users) {
  await setJsonKey(USERS_KEY, users);
}
async function getCatalog() {
  return await getJsonKey(CATALOG_KEY, { items: [] });
}
async function saveCatalog(catalog) {
  await setJsonKey(CATALOG_KEY, catalog);
}
function isAuthed(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] && cookies[SESSION_COOKIE] === String(process.env.SESSION_SECRET || '');
}
function requireAuth(req, res) {
  if (!isAuthed(req)) {
    json(res, 401, { ok:false, error:'No autorizado' });
    return false;
  }
  return true;
}
function parseOriginalUrl(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('__pathname') || url.pathname;
}
async function handleLogin(req, res) {
  const body = await bodyJson(req).catch(() => ({}));
  const user = String(body.username || '');
  const pass = String(body.password || '');
  if (user === String(process.env.ADMIN_USER || '') && pass === String(process.env.ADMIN_PASS || '')) {
    const secret = encodeURIComponent(String(process.env.SESSION_SECRET || ''));
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return json(res, 200, { ok:true });
  }
  return json(res, 401, { ok:false, error:'Credenciales incorrectas' });
}
async function handleLogout(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return json(res, 200, { ok:true });
}
async function handleSystem(req, res) {
  if (!requireAuth(req, res)) return;
  const users = await getUsers();
  const catalog = await getCatalog();
  let redisOk = false, detail = '';
  try {
    detail = await redisCmd(['PING']);
    redisOk = detail === 'PONG';
  } catch (e) {
    detail = e.message;
  }
  const now = Date.now();
  const soon = users.filter(u => {
    if (!u.expiresAt) return false;
    const diff = new Date(u.expiresAt).getTime() - now;
    return diff > 0 && diff <= 7*24*60*60*1000;
  }).length;
  const expired = users.filter(u => u.expiresAt && new Date(u.expiresAt).getTime() <= now).length;
  return json(res, 200, {
    ok:true,
    storage:'upstash',
    redisOk,
    detail,
    users: users.length,
    items: Array.isArray(catalog.items) ? catalog.items.length : 0,
    soon,
    expired,
    hasUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    hasToken: !!process.env.UPSTASH_REDIS_REST_TOKEN
  });
}
async function handleUsers(req, res) {
  if (!requireAuth(req, res)) return;
  const users = await getUsers();
  if (req.method === 'GET') return json(res, 200, { ok:true, users });
  const body = await bodyJson(req).catch(() => ({}));
  if (req.method === 'POST') {
    const token = body.token?.trim() || randomToken(body.name);
    const user = {
      token,
      name: body.name?.trim() || token,
      plan: body.plan || 'custom',
      expiresAt: body.expiresAt || null,
      maxConnections: Math.max(1, Number(body.maxConnections || 1)),
      active: body.active !== false,
      notes: body.notes || '',
      ips: [],
      lastAccess: null,
      createdAt: new Date().toISOString()
    };
    const exists = users.find(u => u.token === token);
    if (exists) return json(res, 400, { ok:false, error:'El token ya existe' });
    users.unshift(user);
    await saveUsers(users);
    return json(res, 200, { ok:true, user });
  }
  if (req.method === 'PUT') {
    const idx = users.findIndex(u => u.token === body.token);
    if (idx === -1) return json(res, 404, { ok:false, error:'Usuario no encontrado' });
    const prev = users[idx];
    users[idx] = {
      ...prev,
      name: body.name?.trim() || prev.name,
      plan: body.plan || prev.plan || 'custom',
      expiresAt: body.expiresAt || null,
      maxConnections: Math.max(1, Number(body.maxConnections || prev.maxConnections || 1)),
      active: body.active !== false,
      notes: body.notes ?? prev.notes
    };
    await saveUsers(users);
    return json(res, 200, { ok:true, user: users[idx] });
  }
  if (req.method === 'DELETE') {
    const token = body.token;
    const next = users.filter(u => u.token !== token);
    await saveUsers(next);
    return json(res, 200, { ok:true });
  }
  return json(res, 405, { ok:false, error:'Método no permitido' });
}
async function handleResetIps(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await bodyJson(req).catch(() => ({}));
  const users = await getUsers();
  const idx = users.findIndex(u => u.token === body.token);
  if (idx === -1) return json(res, 404, { ok:false, error:'Usuario no encontrado' });
  users[idx].ips = [];
  await saveUsers(users);
  return json(res, 200, { ok:true });
}
async function handleRenew(req, res) {
  if (!requireAuth(req, res)) return;
  const body = await bodyJson(req).catch(() => ({}));
  const users = await getUsers();
  const idx = users.findIndex(u => u.token === body.token);
  if (idx === -1) return json(res, 404, { ok:false, error:'Usuario no encontrado' });
  const plan = body.plan || users[idx].plan || 'monthly';
  const newDate = renewDate(users[idx].expiresAt, plan);
  users[idx].expiresAt = newDate;
  users[idx].plan = plan;
  await saveUsers(users);
  return json(res, 200, { ok:true, user: users[idx] });
}
function parseM3u(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  let pending = null;
  let n = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const attrs = {};
      line.replace(/([a-zA-Z0-9_-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
      const comma = line.indexOf(',');
      const name = comma > -1 ? line.slice(comma + 1).trim() : (attrs['tvg-name'] || `Canal ${n}`);
      pending = {
        id: attrs['tvg-id'] || `xtv_${n}`,
        type: 'tv',
        name,
        poster: '',
        posterShape: 'regular',
        description: attrs['group-title'] || '',
        genre: attrs['group-title'] || '',
        channel: attrs['tvg-name'] || name,
        streamUrl: '',
        extra: [{ name: 'search' }]
      };
      n += 1;
    } else if (!line.startsWith('#') && pending) {
      pending.streamUrl = line;
      items.push(pending);
      pending = null;
    }
  }
  return { items };
}
async function handleCatalogAdmin(req, res, pathname) {
  if (!requireAuth(req, res)) return;
  if (pathname.endsWith('/catalog') && req.method === 'GET') {
    return json(res, 200, { ok:true, catalog: await getCatalog() });
  }
  const body = await bodyJson(req).catch(() => ({}));
  if (pathname.endsWith('/catalog') && req.method === 'POST') {
    const catalog = { items: Array.isArray(body.items) ? body.items : [] };
    await saveCatalog(catalog);
    return json(res, 200, { ok:true, catalog });
  }
  if (pathname.endsWith('/catalog/import-m3u') && req.method === 'POST') {
    const catalog = parseM3u(body.text || '');
    await saveCatalog(catalog);
    return json(res, 200, { ok:true, catalog, count: catalog.items.length });
  }
  if (pathname.endsWith('/catalog/clear') && req.method === 'POST') {
    await saveCatalog({ items: [] });
    return json(res, 200, { ok:true });
  }
  return json(res, 404, { ok:false, error:'Ruta no encontrada' });
}
async function handleAdmin(req, res, pathname) {
  if (pathname === '/api/admin/login') return handleLogin(req, res);
  if (pathname === '/api/admin/logout') return handleLogout(req, res);
  if (pathname === '/api/admin/system') return handleSystem(req, res);
  if (pathname === '/api/admin/users') return handleUsers(req, res);
  if (pathname === '/api/admin/users/reset-ips') return handleResetIps(req, res);
  if (pathname === '/api/admin/users/renew') return handleRenew(req, res);
  if (pathname.startsWith('/api/admin/catalog')) return handleCatalogAdmin(req, res, pathname);
  return json(res, 404, { ok:false, error:'Admin no encontrado' });
}
async function validateToken(token, req) {
  const users = await getUsers();
  const idx = users.findIndex(u => u.token === token);
  if (idx === -1) return { ok:false, reason:'Token inválido' };
  const user = users[idx];
  if (user.active === false) return { ok:false, reason:'Usuario inactivo' };
  if (user.expiresAt && new Date(user.expiresAt).getTime() <= Date.now()) return { ok:false, reason:'Usuario caducado' };
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '');
  user.ips = Array.isArray(user.ips) ? user.ips : [];
  if (ip && !user.ips.includes(ip)) {
    if (user.ips.length >= Number(user.maxConnections || 1)) {
      return { ok:false, reason:'Máximo de conexiones alcanzado' };
    }
    user.ips.push(ip);
  }
  user.lastAccess = new Date().toISOString();
  users[idx] = user;
  await saveUsers(users);
  return { ok:true, user };
}
async function handleStremio(req, res, pathname) {
  const m = pathname.match(/^\/u\/([^/]+)\/(.+)$/);
  if (!m) return text(res, 404, 'Not found');
  const token = decodeURIComponent(m[1]);
  const rest = m[2];
  const valid = await validateToken(token, req);
  if (!valid.ok) return text(res, 401, valid.reason);
  const catalog = await getCatalog();
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  if (rest === 'manifest.json') {
    const genres = [...new Set(items.map(i => i.genre || i.description).filter(Boolean))];
    const catalogs = genres.length ? genres.map(g => ({ type:'tv', id:`cat_${slug(g)}`, name:`TV · ${g}`, extra:[{name:'search'}]})) : [{ type:'tv', id:'all', name:'TV', extra:[{name:'search'}]}];
    return json(res, 200, {
      id:'com.moistremiotv.private',
      version:'5.2.0',
      name:'MoiStremioTV',
      description:'Catálogo privado con usuarios y suscripciones',
      resources:['catalog','meta','stream'],
      types:['tv'],
      catalogs,
      behaviorHints:{ configurable:false, configurationRequired:false }
    });
  }
  let mm = rest.match(/^catalog\/tv\/([^/.]+)\.json/);
  if (mm) {
    const id = decodeURIComponent(mm[1]);
    let metas = items;
    if (id !== 'all') {
      const name = id.replace(/^cat_/, '').replace(/-/g, ' ');
      metas = items.filter(i => slug(i.genre || i.description || '') === name);
    }
    return json(res, 200, { metas: metas.map(toMeta) });
  }
  mm = rest.match(/^meta\/tv\/([^/.]+)\.json/);
  if (mm) {
    const id = decodeURIComponent(mm[1]);
    const item = items.find(i => i.id === id);
    return json(res, 200, { meta: item ? toMeta(item) : null });
  }
  mm = rest.match(/^stream\/tv\/([^/.]+)\.json/);
  if (mm) {
    const id = decodeURIComponent(mm[1]);
    const item = items.find(i => i.id === id);
    return json(res, 200, { streams: item && item.streamUrl ? [{ title:item.channel || item.name, url:item.streamUrl }] : [] });
  }
  return text(res, 404, 'Not found');
}
function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'all';
}
function toMeta(item) {
  return {
    id: item.id,
    type: item.type || 'tv',
    name: item.name,
    poster: item.poster || undefined,
    posterShape: item.posterShape || 'regular',
    description: item.description || '',
    genres: item.genre ? [item.genre] : [],
    behaviorHints:{ notWebReady:false }
  };
}
export default async function handler(req, res) {
  try {
    const pathname = parseOriginalUrl(req);
    if (pathname.startsWith('/api/admin')) return await handleAdmin(req, res, pathname);
    if (pathname.startsWith('/u/')) return await handleStremio(req, res, pathname);
    return text(res, 404, 'Not found');
  } catch (e) {
    return json(res, 500, { ok:false, error:e.message || 'Error interno' });
  }
}
