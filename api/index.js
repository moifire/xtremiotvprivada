
const manifest = require('../serverapi/manifest');
const catalog = require('../serverapi/catalog');
const meta = require('../serverapi/meta');
const stream = require('../serverapi/stream');
const adminCatalog = require('../serverapi/admin/catalog');
const adminClearDb = require('../serverapi/admin/clear-db');
const adminDeleteItem = require('../serverapi/admin/delete-item');
const adminHealth = require('../serverapi/admin/health');
const adminImportM3u = require('../serverapi/admin/import-m3u');
const adminLogin = require('../serverapi/admin/login');
const adminUsers = require('../serverapi/admin/users');

module.exports = async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const url = new URL(req.url, `${proto}://${host}`);
    const path = url.pathname;

    if (path === '/api' || path === '/api/') {
      return res.status(200).json({ ok: true, route: 'api-root' });
    }

    if (path === '/manifest.json') return manifest(req, res);
    if (/^\/catalog\/[^/]+\/[^/]+\.json$/.test(path)) {
      const m = path.match(/^\/catalog\/([^/]+)\/([^/]+)\.json$/);
      req.url = `/api?type=${encodeURIComponent(m[1])}&id=${encodeURIComponent(m[2])}${url.search || ''}`;
      return catalog(req, res);
    }
    if (/^\/meta\/[^/]+\/[^/]+\.json$/.test(path)) {
      const m = path.match(/^\/meta\/([^/]+)\/([^/]+)\.json$/);
      req.url = `/api?type=${encodeURIComponent(m[1])}&id=${encodeURIComponent(m[2])}${url.search || ''}`;
      return meta(req, res);
    }
    if (/^\/stream\/[^/]+\/[^/]+\.json$/.test(path)) {
      const m = path.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
      req.url = `/api?type=${encodeURIComponent(m[1])}&id=${encodeURIComponent(m[2])}${url.search || ''}`;
      return stream(req, res);
    }

    if (path === '/api/admin/login') return adminLogin(req, res);
    if (path === '/api/admin/catalog') return adminCatalog(req, res);
    if (path === '/api/admin/users') return adminUsers(req, res);
    if (path === '/api/admin/clear-db') return adminClearDb(req, res);
    if (path === '/api/admin/delete-item') return adminDeleteItem(req, res);
    if (path === '/api/admin/import-m3u') return adminImportM3u(req, res);
    if (path === '/api/admin/health') return adminHealth(req, res);

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Ruta no encontrada', path }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message || 'Internal error' }));
  }
};
