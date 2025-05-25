// File: modules/memoryEnhancer.js
// ================================
// Enhances the agent’s memory system with:
//  • Intermediate summaries of long-term memory
//  • Weighted scoring & auto-pruning
//  • Episodic grouping (clusters of messages)
//  • Metamemory self-reflection and clean-up

const { redis, addToList, getList } = require('../db/agent_storage');

// Configuration (tweakable)
const SUMMARY_INTERVAL = 100;     // every 100 new messages
const DECAY_THRESHOLD  = 0.3;     // memories scoring < 0.3 are pruned
const EPISODE_WINDOW   = 60 * 60 * 1000; // 1h groups

// 1) Summarize batch of old memories into a short note
async function summarizeMemories(coreId) {
  const mono = await getList(coreId, 'inner_monologue');
  if (mono.length < SUMMARY_INTERVAL) return;
  const recent = mono.slice(-SUMMARY_INTERVAL).map(e => e.message).join(' ');
  const summary = recent.slice(0, 200) + '…';
  await addToList(coreId, 'memory_summaries', { summary, ts: Date.now() });
  const keep = mono.slice(-SUMMARY_INTERVAL / 2);
  await redis.del(`${coreId}:inner_monologue`);
  for (const e of keep) await addToList(coreId, 'inner_monologue', e);
}

// 2) Score & prune low-value memories
async function scoreAndPrune(coreId) {
  const mono = await getList(coreId, 'inner_monologue');
  const scored = mono.map(entry => {
    let score = 0.5;
    score += Math.min(0.2, entry.message.length / 500);
    if (entry.emotional_value) score += entry.emotional_value * 0.2;
    const freq = mono.filter(e => e.message === entry.message).length;
    score += Math.min(0.2, (freq - 1) * 0.05);
    return { entry, score };
  });
  const keep = scored.filter(x => x.score >= DECAY_THRESHOLD).map(x => x.entry);
  await redis.del(`${coreId}:inner_monologue`);
  for (const e of keep) await addToList(coreId, 'inner_monologue', e);
}

// 3) Group into episodes: cluster by timestamp proximity
async function groupEpisodes(coreId) {
  const mono = await getList(coreId, 'inner_monologue');
  if (mono.length < 2) return;
  const episodes = [];
  let current = [mono[0]];
  for (let i = 1; i < mono.length; i++) {
    if (mono[i].ts - mono[i - 1].ts < EPISODE_WINDOW) {
      current.push(mono[i]);
    } else {
      episodes.push(current);
      current = [mono[i]];
    }
  }
  episodes.push(current);
  for (const ep of episodes) {
    if (ep.length > 1) {
      const text = ep.map(e => e.message).join(' ');
      const summary = text.slice(0, 150) + '…';
      await addToList(coreId, 'episodes', { summary, count: ep.length, ts: Date.now() });
    }
  }
}

// 4) Metamemory self-reflection: remove contradictory beliefs
async function selfReflect(coreId) {
  const beliefs = await getList(coreId, 'belief_network');
  for (let i = 0; i < beliefs.length; i++) {
    for (let j = i + 1; j < beliefs.length; j++) {
      const a = beliefs[i], b = beliefs[j];
      if (a.belief.includes(b.belief) || b.belief.includes(a.belief)) {
        const drop = a.confidence < b.confidence ? a : b;
        await redis.lrem(`${coreId}:belief_network`, 0, JSON.stringify(drop));
      }
    }
  }
}

// Main entrypoint: call all sub-routines
module.exports = {
  async enhance(coreId) {
    await summarizeMemories(coreId);
    await scoreAndPrune(coreId);
    await groupEpisodes(coreId);
    await selfReflect(coreId);
  }
};
