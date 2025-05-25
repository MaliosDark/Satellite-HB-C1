// File: modules/memoryRetriever.js
// =================================

const axios = require('axios');
const { redis } = require('../db/agent_storage');

const EMBEDDING_API = process.env.EMBEDDING_API_URL;   // e.g. https://intel.nexus-ereb.us/api/generate
const EMBEDDING_KEY = process.env.EMBEDDING_API_KEY;   // your service API key

function embeddingsConfigured() {
  return EMBEDDING_API && EMBEDDING_KEY;
}

// 1) Embed a piece of text via Sofia‐style endpoint
async function embedText(text) {
  if (!embeddingsConfigured()) {
    throw new Error('EMBEDDING_NOT_CONFIGURED');
  }
  const res = await axios.post(
    EMBEDDING_API,
    {
      model: 'mxbai-embed-large:latest',
      input: text
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${EMBEDDING_KEY}`
      }
    }
  );
  // adjust depending on your service’s response shape:
  // if it returns { embedding: [...] }:
  if (res.data.embedding) return res.data.embedding;
  // or if it mimics OpenAI shape:
  return res.data.data[0].embedding;
}

// 2) Store memory (optional embedding)
async function storeMemory(coreId, listName, item) {
  try {
    const vec = await embedText(item.message || item.belief || JSON.stringify(item));
    item.embedding = vec;
  } catch {
    // embedding skipped
  }
  await redis.rpush(`${coreId}:${listName}`, JSON.stringify(item));
}

// 3) Retrieve top-k relevant memories
async function retrieveRelevant(coreId, listName, query, k = 5) {
  if (!embeddingsConfigured()) return [];
  let qVec;
  try { qVec = await embedText(query); }
  catch { return []; }

  const all = await redis.lrange(`${coreId}:${listName}`, 0, -1);
  const parsed = all.map(JSON.parse);

  function cosine(a = [], b = []) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += (a[i]||0) * (b[i]||0);
      magA += (a[i]||0) ** 2;
      magB += (b[i]||0) ** 2;
    }
    return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  }

  const scored = parsed.map(item => ({ item, score: cosine(qVec, item.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(x => x.item);
}

module.exports = { storeMemory, retrieveRelevant };
