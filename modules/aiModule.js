// File: modules/aiModule.js
// =========================
// LLM helper for PAi-OS v8 + loadProfile

const axios = require('axios');
const mysql = require('mysql2/promise');
const path  = require('path');
const storage = require('../db/agent_storage');
const { redis } = storage;
require('dotenv').config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

// helper to build your Redis key
function redisKey(coreId, sub) {
  return `${coreId}:${sub}`;
}

// loadProfile: persists minimal core fields into Redis/MySQL
async function loadProfile(username) {
  const profile = require(path.join(__dirname, '..', 'profiles', `${username.toLowerCase()}_profile.json`));
  const coreId  = profile.core_id;

  await storage.setCore(coreId, {
    chosen_name:            profile.chosen_name,
    philosophical_position: profile.philosophical_position,
    current_emotion:        profile.current_emotion,
    cognitive_traits:       JSON.stringify({ skills: profile.skills || [] }),
    emotional_palette:      JSON.stringify(profile.emotional_palette || []),
    goals:                  JSON.stringify(profile.goals || [])
  });

  return { core_id: coreId, ...profile };
}

// LLM turn queue to serialize calls
let _turnPromise = Promise.resolve();

// human-like delay
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

// call single model
async function callModelId(modelId, prompt, maxTokens, temperature) {
  const res = await axios.post(OLLAMA_URL, {
    model:       modelId,
    prompt,
    max_tokens:  maxTokens,
    temperature,
    stop:        ['\n'],
    stream:      false
  });
  const txt = (res.data.response || '').trim();
  if (!txt) throw new Error('LLM_MISSING');
  return txt;
}

// try each in order
async function tryModels(list, prompt, maxTokens, temperature) {
  for (const id of list) {
    try {
      return await callModelId(id, prompt, maxTokens, temperature);
    } catch (err) {
      console.warn(`[aiModule] model ${id} failed: ${err.message}`);
    }
  }
  throw new Error('All models failed');
}

const MODELS = {
  small:  ['llama3.2:3b'],
  medium: [],
  large:  []
};

const PARAMS = {
  small:  { maxTokens: 60,  temperature: 0.6 },
  medium: { maxTokens: 110, temperature: 0.7 },
  large:  { maxTokens: 200, temperature: 0.8 }
};

module.exports = {
  THINK_DELAY_RANGE: [1000, 2500],
  loadProfile,

  async generateReply({ profile, context, sender, message }) {
    // enqueue so only one LLM turn at a time
    const turn = _turnPromise.catch(() => {}).then(() =>
      this._internalGenerateReply({ profile, context, sender, message })
    );
    _turnPromise = turn.catch(() => {});
    return turn;
  },

  async _internalGenerateReply({ profile, context, sender, message }) {
    // 1) human-like delay
    const [min, max] = this.THINK_DELAY_RANGE;
    await sleep(randomBetween(min, max));

    // 2) fetch updated profile from MySQL
    const conn = await mysql.createConnection({
      host:     process.env.DB_HOST,
      user:     process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });
    const [[agentRow]] = await conn.query(
      `SELECT * FROM agents WHERE core_id = ?`,
      [profile.core_id]
    );
    await conn.end();

    // 3) parse profile JSON fields
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

    // 4) fetch memory lists and build history
    const [beliefs, monologueRaw, goalsList, routine] = await Promise.all([
      redis.lrange(redisKey(profile.core_id, 'belief_network'), 0, -1),
      redis.lrange(redisKey(profile.core_id, 'inner_monologue'), 0, -1),
      redis.lrange(redisKey(profile.core_id, 'goals'), 0, -1),
      redis.lrange(redisKey(profile.core_id, 'daily_routine'), 0, -1),
    ]);

    const beliefLines  = beliefs.map(JSON.parse).map(b => `Belief: ${b.belief}`);
    const goalLines    = goalsList.map(JSON.parse).map(g => `Goal: ${g.goal}[${g.status}]`);
    const routineLines = routine.map(JSON.parse).map(r => `Routine(${r.time}): ${r.action}`);

    // reconstruct the actual back-and-forth
    const convoLines = monologueRaw.map(JSON.parse).map(entry => {
      if (entry.role === 'user') return `${entry.sender}: ${entry.text}`;
      if (entry.role === 'bot')  return `${profileObj.chosen_name}: ${entry.text}`;
      return `${entry.text}`;
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
When replying, if your answer exceeds 100 characters split it into multiple messages of at most 100 characters each.
Do NOT reveal your internal reasoning.
`.trim();

    // 6) assemble the full conversation you’ll send to the LLM
    const history = [
      ...beliefLines,
      ...routineLines,
      ...goalLines,
      'Conversation so far:',
      ...convoLines,
      // last user turn
      `${sender}: ${message}`,
      // prompt for bot’s next line
      `${profileObj.chosen_name}:`
    ].join('\n');

    const fullPrompt = `${systemPrompt}\n\n${history}`;

    // 7) call the models
    try {
      return await tryModels(
        [...MODELS.small, ...MODELS.medium],
        fullPrompt,
        PARAMS.small.maxTokens,
        PARAMS.small.temperature
      );
    } catch {
      console.warn('[aiModule] escalating to large tier');
      return await tryModels(
        MODELS.large,
        fullPrompt,
        PARAMS.large.maxTokens,
        PARAMS.large.temperature
      );
    }
  }
};
