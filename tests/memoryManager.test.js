const path = require('path');
const { expect } = require('chai');

// In-memory stub for redis operations
const data = new Map();
const redis = {
  async rpush(key, value) {
    if (!data.has(key)) data.set(key, []);
    data.get(key).push(value);
  },
  async del(key) {
    data.delete(key);
  },
  async lrange(key, start, stop) {
    const arr = data.get(key) || [];
    const end = stop === -1 ? arr.length : stop + 1;
    return arr.slice(start, end);
  },
  async keys(pattern) {
    const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
    return Array.from(data.keys()).filter(k => regex.test(k));
  }
};

async function addToList(coreId, listName, payload) {
  const key = `${coreId}:${listName}`;
  await redis.rpush(key, JSON.stringify(payload));
}

async function getList(coreId, listName) {
  const arr = await redis.lrange(`${coreId}:${listName}`, 0, -1);
  return arr.map(JSON.parse);
}

// Inject stub into require cache before loading module under test
const modulePath = path.resolve(__dirname, '../db/agent_storage.js');
require.cache[modulePath] = { exports: { redis, addToList, getList } };

const { applyDecay } = require('../modules/memoryManager');

describe('applyDecay', function () {
  it('removes stale low-confidence memories', async function () {
    const coreId = 'core1';
    const now = Date.now();
    const oldTs = now - 3 * 60 * 60 * 1000; // 3h ago
    const recentTs = now - 30 * 60 * 1000; // 30m ago

    for (const type of ['episodic', 'semantic', 'procedural']) {
      await addToList(coreId, type, { ts: oldTs, confidence: 0.1, text: 'drop' });
      await addToList(coreId, type, { ts: oldTs, confidence: 0.9, text: 'keep1' });
      await addToList(coreId, type, { ts: recentTs, confidence: 0.1, text: 'keep2' });
    }

    await applyDecay(coreId);

    for (const type of ['episodic', 'semantic', 'procedural']) {
      const remaining = await getList(coreId, type);
      const texts = remaining.map(e => e.text);
      expect(texts).to.not.include('drop');
      expect(texts).to.include.members(['keep1', 'keep2']);
      expect(texts).to.have.length(2);
    }
  });
});
