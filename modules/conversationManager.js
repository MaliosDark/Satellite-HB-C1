// builds the prompt from just-enough memory
const { redis } = require('../db/agent_storage');

async function buildPrompt(coreId, botName, sender, incoming) {
  // last 12 chat turns (<= ~1 KB)
  const raw = await redis.lrange(`${coreId}:inner_monologue`, -12, -1);
  const convo = raw
    .map(JSON.parse)
    .map(e => `${e.sender || 'sys'}: ${e.message}`)
    .join('\n');

  return [
    convo,
    `${sender}: ${incoming}`,
    `${botName}:`           // ← LLM stops here
  ].join('\n');
}

module.exports = { buildPrompt };
