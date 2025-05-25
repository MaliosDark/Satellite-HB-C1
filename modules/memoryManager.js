// File: modules/memoryManager.js

const { redis, addToList, getList } = require('../db/agent_storage');
// Placeholder client for vector-store (e.g. Pinecone, Weaviate)
const vectorStore = require('./vectorStoreClient');

// Configuration
const TYPES = ['episodic', 'semantic', 'procedural'];
const DECAY_THRESHOLD = 0.3;
const SUMMARY_BATCH = 100;

/**
 * Write a memory of a given type.
 * @param {string} coreId
 * @param {'episodic'|'semantic'|'procedural'} type
 * @param {object} payload
 */
async function writeMemory(coreId, type, payload) {
  if (!TYPES.includes(type)) throw new Error(`Unknown memory type: ${type}`);
  const key = `${coreId}:${type}`;
  await redis.rpush(key, JSON.stringify({ ...payload, ts: Date.now() }));
  // also index embedding in vector store for semantic
  if (type === 'semantic') {
    await vectorStore.upsert(coreId, payload.id || `${key}:${Date.now()}`, payload.text);
  }
}

/**
 * Retrieve top-k relevant memories.
 * - semantic: vector similarity
 * - episodic: last N
 * - procedural: all routines
 */
async function retrieveMemories(coreId, type, { query, k = 5 } = {}) {
  const key = `${coreId}:${type}`;
  if (type === 'semantic' && query) {
    return vectorStore.query(coreId, query, k);
  }
  if (type === 'episodic') {
    const arr = await getList(coreId, 'episodic');
    return arr.slice(-k);
  }
  if (type === 'procedural') {
    return getList(coreId, 'procedural');
  }
  return [];
}

/**
 * Consolidate episodic into semantic summaries via LLM.
 */
async function consolidate(coreId) {
  const episodes = await getList(coreId, 'episodic');
  if (episodes.length < SUMMARY_BATCH) return;
  const batch = episodes.slice(-SUMMARY_BATCH).map(e => e.text).join(' ');
  // call your LLM here to summarize:
  const summary = (await vectorStore.llmSummarize(batch)).slice(0, 300);
  await writeMemory(coreId, 'semantic', { text: summary, source: 'auto-summary' });
  // prune half of episodic
  const keep = episodes.slice(-SUMMARY_BATCH / 2);
  await redis.del(`${coreId}:episodic`);
  for (const e of keep) await redis.rpush(`${coreId}:episodic`, JSON.stringify(e));
}

/**
 * Apply decay policy across all types.
 */
async function applyDecay(coreId) {
  for (const type of TYPES) {
    const list = await getList(coreId, type);
    const filtered = list.filter(entry => {
      const age = Date.now() - entry.ts;
      // drop if older than 2h and confidence low
      if (age > 2 * 60 * 60 * 1000 && (entry.confidence||0) < DECAY_THRESHOLD) {
        return false;
      }
      return true;
    });
    await redis.del(`${coreId}:${type}`);
    for (const e of filtered) await redis.rpush(`${coreId}:${type}`, JSON.stringify(e));
  }
}

setInterval(async () => {
    const now = Date.now();
    for (const key of await redis.keys('*:inner_monologue')) {
      const items = (await redis.lrange(key, 0, -1)).map(JSON.parse);
      const keep  = items.filter(i => now - i.ts < 3_600_000); // ≤1 h
      await redis.del(key);
      for (const x of keep) await redis.rpush(key, JSON.stringify(x));
    }
  }, 10 * 60 * 1000); // every 10 min
  

module.exports = {
  writeMemory,
  retrieveMemories,
  consolidate,
  applyDecay,
};
