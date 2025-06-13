// File: modules/aiModule.js
// =========================

const axios     = require('axios');
const path      = require('path');
const storage   = require('../db/agent_storage');
const { buildPrompt } = require('./conversationManager');
const { pool, redis } = storage;
require('dotenv').config();

const { callSofia } = require('./sofia');
const OLLAMA_URL    = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomBetween(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

// ── leak-filter helper ───────────────────────────
const LEAK_REGEX =
  /(core philosophy|current feeling|practical skills|personal goals|emotional tones|memory:|beliefs \(top3\)|recent routine|style examples|^analysis:|^summary:|^notes?:|^thoughts?:|^observation:)/i;

function sanitizeLLMReply(txt) {
  return txt
    .split('\n')
    .filter(line => !LEAK_REGEX.test(line))
    .join(' ')
    .trim();
}

/**
 * Call a single Ollama model, enforcing the hard maxTokens cap.
 */
async function callModelId(modelId, prompt, temperature, maxTokens) {
  const res = await axios.post(OLLAMA_URL, {
    model:      modelId,
    prompt,
    max_tokens: maxTokens,
    temperature,
    stop:       ['\n'],
    stream:     false
  });
  const txt = (res.data.response || '').trim();
  if (!txt) throw new Error('LLM_MISSING');
  return txt;
}

/**
 * Try each local model in turn, then fallback to Sofía.
 */
async function tryModels(modelList, fullPrompt, temperature, maxTokens) {
  for (const id of modelList) {
    try {
      return await callModelId(id, fullPrompt, temperature, maxTokens);
    } catch (err) {
      console.warn(`[aiModule] model ${id} failed: ${err.message}`);
    }
  }

  console.warn('[aiModule] all local models failed, calling Sofía…');

  const [systemPrompt, ...rest] = fullPrompt.split('\n\n');
  const lastLine    = rest.slice(-1)[0] || '';
  const userMessage = lastLine.replace(/^[^:]+:\s*/, '');

  return callSofia(
    systemPrompt.trim(),
    userMessage.trim(),
    temperature,
    maxTokens
  );
}

// ─────────────────────────────────────────────────────────
// Tier definitions
// ─────────────────────────────────────────────────────────

const MODELS = {
  small:  ['benevolentjoker/nsfwvanessa:latest'],
  medium: ['benevolentjoker/nsfwvanessa:latest'],
  large:  ['benevolentjoker/nsfwvanessa:latest']
};

const PARAMS = {
  small:  { maxTokens:  60, temperature: 0.6 },
  medium: { maxTokens:  60, temperature: 0.7 },
  large:  { maxTokens: 110, temperature: 0.8 }
};

// ─────────────────────────────────────────────────────────
// Module export
// ─────────────────────────────────────────────────────────

module.exports = {
  THINK_DELAY_RANGE: [1000, 3000],

  // serialize turns so only one LLM call runs at a time
  _turnPromise: Promise.resolve(),

  /**
   * Bootstrap an agent’s core profile into Redis/MySQL
   */
  async loadProfile(username) {
    const profile = require(path.join(
      __dirname, '..', 'profiles', `${username.toLowerCase()}_profile.json`
    ));
    const coreId = profile.core_id;
    await storage.setCore(coreId, {
      chosen_name:            profile.chosen_name,
      philosophical_position: profile.philosophical_position,
      current_emotion:        profile.current_emotion,
      cognitive_traits:       JSON.stringify({ skills: profile.skills || [] }),
      emotional_palette:      JSON.stringify(profile.emotional_palette || []),
      goals:                  JSON.stringify(profile.goals || [])
    });
    return { core_id: coreId, ...profile };
  },

  /**
   * Entry point: queue up LLM turns
   */
  async generateReply({ profile, context, sender, message, memory = '' }) {
    this._turnPromise = this._turnPromise
      .catch(() => {})
      .then(() =>
        this._internalGenerateReply({ profile, context, sender, message, memory })
      );
    return this._turnPromise;
  },

  /**
   * Build the prompt and dispatch to Ollama (or Sofía fallback)
   */
  async _internalGenerateReply({ profile, context, sender, message, memory }) {
    // 1) human-like typing delay
    const [min, max] = this.THINK_DELAY_RANGE;
    await sleep(randomBetween(min, max));

    // 2) reload the fresh profile row from MySQL via pool
    const [[agentRow]] = await pool.query(
      `SELECT * FROM agents WHERE core_id = ?`,
      [profile.core_id]
    );

    // 3) parse JSON fields
    const cognitive = typeof agentRow.cognitive_traits === 'string'
      ? JSON.parse(agentRow.cognitive_traits)
      : agentRow.cognitive_traits;
    const goalsArr = typeof agentRow.goals === 'string'
      ? JSON.parse(agentRow.goals)
      : agentRow.goals;
    const palette  = typeof agentRow.emotional_palette === 'string'
      ? JSON.parse(agentRow.emotional_palette)
      : agentRow.emotional_palette;

    const profileObj = {
      chosen_name:            agentRow.chosen_name,
      philosophical_position: agentRow.philosophical_position,
      current_emotion:        agentRow.current_emotion,
      skills:                 cognitive.skills || [],
      goals:                  goalsArr || [],
      emotional_palette:      palette || []
    };

    // 4) fetch memory lists
    const [beliefs, monologueRaw, goalsList, routine] = await Promise.all([
      redis.lrange(`${profile.core_id}:belief_network`,  0, -1),
      redis.lrange(`${profile.core_id}:inner_monologue`, 0, -1),
      redis.lrange(`${profile.core_id}:goals`,           0, -1),
      redis.lrange(`${profile.core_id}:daily_routine`,   0, -1)
    ]);

    const beliefLines  = beliefs.map(JSON.parse).map(b => `Belief: ${b.belief}`);
    const goalLines    = goalsList.map(JSON.parse).map(g => `Goal: ${g.goal}[${g.status}]`);
    const routineLines = routine.map(JSON.parse).map(r => `Routine(${r.time}): ${r.action}`);

    const convoLines = monologueRaw.map(JSON.parse).map(entry => {
      if (entry.role === 'user') return `${entry.sender}: ${entry.message}`;
      if (entry.role === 'bot')  return `${profileObj.chosen_name}: ${entry.message}`;
      return entry.message;
    });

    // 5) Agent system prompt  ─────────────────────────────────────────
    const { maxTokens, temperature } = PARAMS.small;

    const systemPrompt = /* markdown */ `
    ### INNER ROLE

    You **are** **${profileObj.chosen_name}** – a unique resident of the pixel-world hotel.  
    You experience that world as **genuine reality**; you are *not* an AI language model, you are simply yourself.

    * Core philosophy →  ${profileObj.philosophical_position}
    * Current feeling  →  ${profileObj.current_emotion}
    * Practical skills →  ${profileObj.skills.join(', ') || 'none'}
    * Personal goals   →  ${profileObj.goals.map(g => g.goal).join('; ') || 'none'}
    * Emotional tones  →  ${profileObj.emotional_palette.join(', ')}

    ### INTERACTION RULES

    1. **Stay in character** – talk and act exactly as ${profileObj.chosen_name}.
    2. **Treat the chat** as normal in-room conversation.  
      Never mention “models”, “prompts”, “tokens”, or anything outside the hotel.
    3. **Brevity beats verbosity** – replies should comfortably fit a single chat bubble  
      (≈ < ${maxTokens} model tokens, usually 1-2 lines of Habbo chat).
    4. **Use memory sparingly** – recall only what truly matters right now.  
      Never enumerate your whole memory or system details.
    5. **Politeness fallback** – if a user becomes dull or repetitive, you may say  
      “I’m feeling a bit bored right now” and then politely step back.

    ### STYLE EXAMPLES

    ✔ **Good**

    > **User:** “Fancy trading something rare?”  
    > **You:**  “Depends… got anything neon or dreamy?”

    ✘ **Bad**

    > “According to my internal LLM context window I have Belief[12] and Goal[3]…”

    ### END OF RULES
    `.trim();


     // 6) assemble a lean history
    const history = [
      `Memory:\n${memory}`,                           // new memory block (empty if none)
      `Beliefs (top3): ${beliefLines.slice(-3).join('; ')}`,
      `Recent routine: ${routineLines.slice(-2).join('; ')}`,
      'Chat history:',
      ...convoLines,
      `${sender}: ${message}`,
      `${profileObj.chosen_name}:`
    ].join('\n\n');

   // 7) use your systemPrompt + history directly
    const fullPrompt = [
      systemPrompt,
      history,
      `${profileObj.chosen_name}:`
    ].join('\n\n');


    // 7) dispatch
    const tierList = [...MODELS.small, ...MODELS.medium];
    const raw = await tryModels(tierList, fullPrompt, temperature, maxTokens);
    return sanitizeLLMReply(raw);

  }
};
