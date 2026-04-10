const {
  handleManifest,
  handleCatalog,
  handleMeta,
  handleStream,
  handleAdminUsers,
  handleNotFound,
} = require('../server/router');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // Compatibilidad con /api?...
  if (path === '/api' || path === '/api/') {
    return handleManifest(req, res);
  }

  if (path === '/api/manifest' || path === '/api/manifest.json') {
    return handleManifest(req, res);
  }

  if (path === '/api/catalog') {
    return handleCatalog(req, res);
  }

  if (path === '/api/meta') {
    return handleMeta(req, res);
  }

  if (path === '/api/stream') {
    return handleStream(req, res);
  }

  if (path === '/api/admin/users') {
    return handleAdminUsers(req, res);
  }

  return handleNotFound(req, res);
};
