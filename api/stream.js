
const { sendJson, handleOptions, requireAddonToken, parseUrl } = require('./lib/common');
const { getCatalog } = require('./lib/db');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (!requireAddonToken(req, res)) return;

  const url = parseUrl(req);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  const db = await getCatalog();

  let streams = [];
  if (type === 'series' && id && id.includes(':')) {
    const [seriesId] = id.split(':');
    const item = db.items.find(x => x.id === seriesId && x.type === 'series');
    const episode = item?.videos?.find(v => v.id === id);
    streams = episode?.streams || [];
  } else {
    const item = db.items.find(x => x.id === id && (!type || x.type === type));
    streams = item?.streams || [];
  }
  return sendJson(res, 200, { streams });
};
