
const { sendJson, handleOptions } = require('../lib/common');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  return sendJson(res, 200, {
    ok: true,
    node: process.version,
    hasAddonToken: Boolean(process.env.ADDON_TOKEN),
    hasAdminUser: Boolean(process.env.ADMIN_USER),
    hasAdminPass: Boolean(process.env.ADMIN_PASS),
    hasSessionSecret: Boolean(process.env.SESSION_SECRET),
    hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN)
  });
};
