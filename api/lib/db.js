
const path = require('path');
const fs = require('fs');
const { ensureCatalogShape } = require('./common');

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CATALOG_KEY = process.env.CATALOG_KEY || 'moitube:catalog';

async function redisCommand(args) {
  if (!REST_URL || !REST_TOKEN) throw new Error('Faltan variables de Upstash');
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `Error Redis ${res.status}`);
  }
  return json.result;
}

function readSeed() {
  const file = path.join(process.cwd(), 'data', 'seed.catalog.json');
  return ensureCatalogShape(JSON.parse(fs.readFileSync(file, 'utf8')));
}

async function getCatalog() {
  try {
    const result = await redisCommand(['GET', CATALOG_KEY]);
    if (!result) return readSeed();
    return ensureCatalogShape(JSON.parse(result));
  } catch (e) {
    return readSeed();
  }
}

async function setCatalog(db) {
  db = ensureCatalogShape(db);
  await redisCommand(['SET', CATALOG_KEY, JSON.stringify(db)]);
  return db;
}

module.exports = { getCatalog, setCatalog };
