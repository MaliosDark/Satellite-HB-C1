// scripts/redis-dump-full.js
require('dotenv').config();
const fs    = require('fs');
const Redis = require('ioredis');

(async () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  });

  // 1) SCAN keys
  let cursor = '0', all = [];
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', '*', 'COUNT', 1000);
    cursor = next;
    all.push(...batch);
  } while (cursor !== '0');

  // 2) Fetch values by tipo
  const dump = {};
  for (const key of all) {
    const type = await redis.type(key);
    let value;
    if (type === 'list') {
      value = await redis.lrange(key, 0, -1);
    } else if (type === 'hash') {
      value = await redis.hgetall(key);
    } else if (type === 'string') {
      value = await redis.get(key);
    } else if (type === 'set') {
      value = await redis.smembers(key);
    } else if (type === 'zset') {
      value = await redis.zrange(key, 0, -1, 'WITHSCORES');
    } else {
      value = `Unsupported type: ${type}`;
    }
    dump[key] = { type, value };
  }

  fs.writeFileSync('redis-full-dump.json', JSON.stringify(dump, null, 2), 'utf8');
  console.log('✅ redis-full-dump.json generado');
  process.exit();
})();
