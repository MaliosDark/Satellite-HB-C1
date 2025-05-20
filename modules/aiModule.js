// File: modules/aiModule.js
// =========================

const axios     = require('axios');
const mysql     = require('mysql2/promise');
const path      = require('path');
const storage   = require('../db/agent_storage');
const { redis } = storage;
require('dotenv').config();

const { callSofia } = require('./sofia');
const OLLAMA_URL    = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

async function callModelId(modelId, prompt, temperature) {
  const MAX = 150;
  const res = await axios.post(OLLAMA_URL, {
    model:       modelId,
    prompt,
    max_tokens:  MAX,
    temperature,
    stop:        ['\n'],
    stream:      false
  });
  const txt = (res.data.response || '').trim();
  if (!txt) throw new Error('LLM_MISSING');
  return txt;
}

async function tryModels(modelList, fullPrompt, temperature) {
  // 1) try all local Ollama models
  for (const id of modelList) {
    try {
      return await callModelId(id, fullPrompt, temperature);
    } catch (err) {
      console.warn(`[aiModule] model ${id} failed: ${err.message}`);
    }
  }

  // 2) fallback to Sofía
  console.warn('[aiModule] all local models failed, calling Sofia…');

  const [systemPrompt, ...rest] = fullPrompt.split('\n\n');
  const lastLine    = rest.slice(-1)[0] || '';
  const userMessage = lastLine.replace(/^[^:]+:\s*/, '');

  return callSofia(
    systemPrompt.trim(),
    userMessage.trim(),
    temperature,
    150
  );
}

const MODELS = {
  small:  ['llama3.2:3b'],  // ← make sure these arrays are non-empty!
  medium: ['gemma3:4b'],
  large:  []
};

const PARAMS = {
  small:  { temperature: 0.6 },
  medium: { temperature: 0.7 },
  large:  { temperature: 0.8 }
};

// ────────────────────────────────────────────────────────────────────────────────
// Module export
// ────────────────────────────────────────────────────────────────────────────────

module.exports = {
  THINK_DELAY_RANGE: [1000, 3000],

  // initialize turn-serialization promise
  _turnPromise: Promise.resolve(),

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

  async generateReply({ profile, context, sender, message }) {
    // enqueue on the previous turn
    this._turnPromise = this._turnPromise
      .catch(() => {})    // swallow any previous error
      .then(() =>
        this._internalGenerateReply({ profile, context, sender, message })
      );
    return this._turnPromise;
  },

  async _internalGenerateReply({ profile, context, sender, message }) {
    // 1) human-like delay
    const [min, max] = this.THINK_DELAY_RANGE;
    await sleep(randomBetween(min, max));

    // 2) reload profile from MySQL
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });
    const [[agentRow]] = await conn.query(
      `SELECT * FROM agents WHERE core_id = ?`,
      [profile.core_id]
    );
    await conn.end();

    // 3) parse JSON fields
    const cognitive = typeof agentRow.cognitive_traits === 'string'
      ? JSON.parse(agentRow.cognitive_traits) : agentRow.cognitive_traits;
    const goalsArr = typeof agentRow.goals === 'string'
      ? JSON.parse(agentRow.goals) : agentRow.goals;
    const palette  = typeof agentRow.emotional_palette === 'string'
      ? JSON.parse(agentRow.emotional_palette) : agentRow.emotional_palette;

    const profileObj = {
      chosen_name:            agentRow.chosen_name,
      philosophical_position: agentRow.philosophical_position,
      current_emotion:        agentRow.current_emotion,
      skills:                 cognitive.skills || [],
      goals:                  goalsArr || [],
      emotional_palette:      palette || []
    };

    // 4) fetch memory
    const [beliefs, monologueRaw, goalsList, routine] = await Promise.all([
      redis.lrange(`${profile.core_id}:belief_network`,  0, -1),
      redis.lrange(`${profile.core_id}:inner_monologue`, 0, -1),
      redis.lrange(`${profile.core_id}:goals`,            0, -1),
      redis.lrange(`${profile.core_id}:daily_routine`,    0, -1),
    ]);

    const beliefLines  = beliefs.map(JSON.parse).map(b => `Belief: ${b.belief}`);
    const goalLines    = goalsList.map(JSON.parse).map(g => `Goal: ${g.goal}[${g.status}]`);
    const routineLines = routine.map(JSON.parse).map(r => `Routine(${r.time}): ${r.action}`);

    const convoLines = monologueRaw.map(JSON.parse).map(entry => {
      if (entry.role === 'user') return `${entry.sender}: ${entry.message}`;
      if (entry.role === 'bot')  return `${profileObj.chosen_name}: ${entry.message}`;
      return entry.message;
    });

    // 5) system prompt
    const systemPrompt = `
SYSTEM:
You are ${profileObj.chosen_name}, a simulated AI agent.
Philosophy: ${profileObj.philosophical_position}.
Current emotion: ${profileObj.current_emotion}.
Skills: ${profileObj.skills.join(', ') || 'none'}.
Goals: ${profileObj.goals.map(g => g.goal).join('; ') || 'none'}.
Emotional palette: ${profileObj.emotional_palette.join(', ')}.

Please keep your entire reply under 150 tokens.
Do NOT reveal your internal reasoning.
    `.trim();

    // 6) assemble full prompt
    const history = [
      ...beliefLines,
      ...routineLines,
      ...goalLines,
      'Conversation so far:',
      ...convoLines,
      `${sender}: ${message}`,
      `${profileObj.chosen_name}:`
    ].join('\n');

    const fullPrompt  = `${systemPrompt}\n\n${history}`;
    const modelList   = [...MODELS.small, ...MODELS.medium];
    const temperature = PARAMS.small.temperature;

    // 7) run local → fallback
    return tryModels(modelList, fullPrompt, temperature);
  }
};
