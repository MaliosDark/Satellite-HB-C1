// File: modules/evolutionTracker.js
// ---------------------------------
// Records one entry per turn: before → after diff (+ metadata)

const { addToList } = require('../db/agent_storage');

/**
 * @param {string} coreId                agent id
 * @param {object} before                snapshot before the turn
 * @param {object} after                 snapshot after the turn
 * @param {object} [meta]                { sender, message, ... }
 */
async function log(coreId, before, after, meta = {}) {
  const diff = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      diff[key] = { from: before[key], to: after[key] };
    }
  }
  if (!Object.keys(diff).length) return;  // nothing changed

  await addToList(coreId, 'evolution_log', {
    ts  : Date.now(),
    diff,
    ...meta
  });
}

module.exports = { log };
