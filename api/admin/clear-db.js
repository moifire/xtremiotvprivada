
const { sendJson, handleOptions, requireAdmin } = require('../lib/common');
const { setCatalog } = require('../lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });

  const emptyCatalog = {
    addonsBrand: {
      name: 'MoiTube Ultra Private Legal PRO',
      description: 'Catálogo privado con base de datos',
      logo: ''
    },
    catalogIds: {
      movie: 'm_' + Math.random().toString(36).slice(2, 8),
      series: 's_' + Math.random().toString(36).slice(2, 8),
      tv: 't_' + Math.random().toString(36).slice(2, 8)
    },
    items: []
  };

  await setCatalog(emptyCatalog);
  return sendJson(res, 200, { ok: true, catalog: emptyCatalog });
};
