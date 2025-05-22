// File: modules/evolution.js
// ==========================
//
// Helpers to evolve an agent’s inner state after each turn.

const Sentiment = require('sentiment');  // or your favorite sentiment tool

/**
 * Compute a new emotion label (string) based on oldEmotion,
 * the user’s last message and the bot’s reply.
 */
function computeEmotionShift(oldEmotion, userMsg, botReply) {
  // Example: basic sentiment analysis:
  const sentiment = new Sentiment();
  const scoreUser = sentiment.analyze(userMsg).score;
  const scoreBot  = sentiment.analyze(botReply).score;
  const delta     = scoreUser * 0.3 + scoreBot * 0.2;

  // Map delta to one of your palette labels…
  if (delta >  2) return 'joy';
  if (delta >  0) return 'optimism';
  if (delta < -2) return 'frustration';
  if (delta <  0) return 'skepticism';
  return oldEmotion; // no strong change
}

/**
 * Adjust numeric cognitive traits (object of floats 0–1).
 */
function computeCognitiveShift(oldTraits, userMsg, botReply) {
  const newTraits = { ...oldTraits };

  // Example: bump curiosity if user asked a question
  if (/[?¿]$/.test(userMsg.trim())) {
    newTraits.curiosity = Math.min(1, (newTraits.curiosity||0) + 0.05);
  }
  // Slight decay over time
  Object.keys(newTraits).forEach(k => {
    newTraits[k] = Math.max(0, newTraits[k] * 0.995);
  });

  return newTraits;
}

/**
 * Revise belief confidences: reinforce beliefs mentioned, weaken contradictory ones.
 * @param beliefs Array<{ belief:string, confidence:number }>
 */
function reviseBeliefs(beliefs, userMsg, botReply) {
  return beliefs.map(b => {
    let delta = 0;
    if (userMsg.includes(b.belief) || botReply.includes(b.belief)) {
      delta += 0.05;
    }
    // random small drift
    delta += (Math.random() - 0.5) * 0.02;
    return {
      belief:     b.belief,
      confidence: Math.min(1, Math.max(0, b.confidence + delta))
    };
  })
  // Optionally drop low-confidence beliefs
  .filter(b => b.confidence > 0.2);
}

/**
 * Prune or down-weight old monologue entries.
 * @param monologue Array<{ role, sender, message, ts }>
 * @param now       timestamp
 */
function applyMemoryDecay(monologue, now) {
  const DECAY_WINDOW = 1000 * 60 * 60 * 2; // 2h
  return monologue.filter(entry => {
    // keep recent or important entries
    return (now - entry.ts < DECAY_WINDOW)
        || entry.role === 'bot';
  });
}

module.exports = {
  computeEmotionShift,
  computeCognitiveShift,
  reviseBeliefs,
  applyMemoryDecay
};
