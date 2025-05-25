// modules/tweetComposer.js
// ========================
// Builds an eye-catching tweet (< 280 chars) that turns whatever just
// happened inside the simulation into a tiny story for X (Twitter).

const aiModule      = require('./aiModule');
const { getHistory } = require('./history');

/**
 * Compose a tweet about the very last interaction.
 * @param {object} opts
 * @param {object} opts.profile  – live profile row (already parsed)
 * @param {string} opts.coreId   – agent’s core_id
 * @param {string} opts.sender   – username of the human/agent just addressed
 * @param {string} opts.message  – raw user message
 * @param {string} opts.reply    – bot’s freshly-generated reply
 * @returns {Promise<string>}    – a ready-to-post tweet (max 280 chars)
 */
async function composeTweet ({ profile, coreId, sender, message, reply }) {

  /* ──────────────────────────────────────────────────────────────
     1)  Grab a *tiny* memory slice so the LLM knows the background
     ────────────────────────────────────────────────────────────── */
  const historyLines = await getHistory(
    coreId,
    ['inner_monologue', 'episodes', 'belief_network'],
    15                // last 15 records mixed & sorted
  );

  const compactHistory = historyLines
    .map(e => {
      if (e.role) return `${e.role.toUpperCase()}: ${e.message || e.text}`;
      if (e.belief) return `BELIEF: ${e.belief}`;
      if (e.summary) return `EPISODE: ${e.summary}`;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 600);      // cap context length (LLM token budget)

  /* ──────────────────────────────────────────────────────────────
     2)  System prompt – written in English for a public audience
     ────────────────────────────────────────────────────────────── */
  const systemPrompt = `
You are the social-media manager for a pixel-world AI called
“${profile.chosen_name}”. Write a punchy X (Twitter) post – max
280 characters – that will hook human readers who know nothing
about Habbo. It should:

  • Stand alone (no inside jargon, no spoilers, no prompt leaks).
  • Capture today’s most interesting or funny moment.
  • Sound like a REAL person live-tweeting the adventure.
  • Add ONE fitting emoji at the end (no more, no hashtags).

If nothing noteworthy happened, invent a witty observation instead.

Return ONLY the final tweet, no extra text.
  `.trim();

  /* ──────────────────────────────────────────────────────────────
     3)  Assemble user prompt that feeds the LLM the raw material
     ────────────────────────────────────────────────────────────── */
  const userPrompt = [
    `BOT_NAME: ${profile.chosen_name}`,
    `HUMAN_OR_AGENT_SENDER: ${sender}`,
    `USER_MESSAGE: ${message}`,
    `BOT_REPLY: ${reply}`,
    `RECENT_CONTEXT:\n${compactHistory}`,
    `\n---\nNOW TWEET:`   // LLM ends after this
  ].join('\n\n');

  /* ──────────────────────────────────────────────────────────────
     4)  Call the same aiModule used everywhere else
     ────────────────────────────────────────────────────────────── */
  const rawTweet = await aiModule._internalGenerateReply({
    profile,
    context : '',          // no room context needed
    sender  : 'SOCIAL_BOT',
    message : `${systemPrompt}\n\n${userPrompt}`,
    memory  : ''
  });

  return rawTweet.slice(0, 280).trim();   // safety-trim
}

module.exports = { composeTweet };
