// modules/history.js
const { redis } = require('../db/agent_storage');

/**
 * Returns a merged, timestamp-sorted slice of multiple Redis lists.
 * @param {string} coreId
 * @param {string[]} lists  names of Redis lists (without `${coreId}:` prefix)
 * @param {number} limit   max number of entries to return
 */
async function getHistory(coreId, lists = [], limit = 50) {
  // 1) read each list in parallel
  const raws = await Promise.all(
    lists.map(name => redis.lrange(`${coreId}:${name}`, 0, limit - 1))
  );
  // 2) parse and flatten
  const merged = raws.flat().map(JSON.parse);
  // 3) sort by timestamp descending, slice to limit
  merged.sort((a, b) => b.ts - a.ts);
  return merged.slice(0, limit);
}

module.exports = { getHistory };
