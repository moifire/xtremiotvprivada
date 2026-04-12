
const { ensureUsersShape } = require('./users-common');

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USERS_KEY = process.env.USERS_KEY || 'moitube:users';

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
  if (!res.ok || json.error) throw new Error(json.error || `Error Redis ${res.status}`);
  return json.result;
}

async function getUsersDb() {
  try {
    const result = await redisCommand(['GET', USERS_KEY]);
    return ensureUsersShape(result ? JSON.parse(result) : { users: [] });
  } catch {
    return ensureUsersShape({ users: [] });
  }
}

async function setUsersDb(db) {
  db = ensureUsersShape(db);
  await redisCommand(['SET', USERS_KEY, JSON.stringify(db)]);
  return db;
}

module.exports = { getUsersDb, setUsersDb };
