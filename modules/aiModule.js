// File: modules/aiModule.js
// =========================
// LLM helper for PAi-OS v8:  
//  • Fetches live profile from MySQL (agents table + JSON fields)  
//  • Fetches structured memory lists from Redis  
//  • Builds system+user prompt  
//  • Routes through small→medium→large model tiers

const axios       = require('axios');
const mysql       = require('mysql2/promise');
const { redis, getConn, redisKey } = require('../db/agent_storage'); 
const path        = require('path');
require('dotenv').config();

const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

// turn queue
let _turnPromise = Promise.resolve();

// Model tiers
const MODELS = {
  small:  ['llama3.2:3b'],
  medium: ['gemma3:4b','llama3:latest'],
  large:  ['qwen2.5:7b','solar:10.7b']
};

// default parameters per tier
const PARAMS = {
  small:  { maxTokens: 60,  temperature: 0.6 },
  medium: { maxTokens: 110, temperature: 0.7 },
  large:  { maxTokens: 200, temperature: 0.8 }
};

// call a single model; throws if empty or network error
async function callModelId(modelId, prompt, maxTokens, temperature) {
  const res = await axios.post(OLLAMA_URL, {
    model:       modelId,
    prompt,
    max_tokens:  maxTokens,
    temperature,
    stop:        ['\n'],
    stream:      false
  });
  const txt = (res.data.response||'').trim();
  if (!txt) throw new Error('LLM_MISSING');
  return txt;
}

// attempts each model in list in order
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

// serialize calls
module.exports = {
  THINK_DELAY_RANGE: [1000, 2500],

  /**
   * Public entry: serializes overlapping calls.
   * opts: { coreId, sender, message }
   */
  async generateReply(opts) {
    const turn = _turnPromise
      .catch(()=>{})
      .then(()=> this._internalGenerateReply(opts));
    _turnPromise = turn.catch(()=>{});
    return turn;
  },

  // opts: { coreId, sender, message }
  async _internalGenerateReply({ coreId, sender, message }) {
    // 1) human‐like delay
    const [min,max] = this.THINK_DELAY_RANGE;
    await sleep(randomBetween(min,max));

    // 2) fetch LIVE profile from MySQL
    const conn = await getConn();
    const [[agentRow]] = await conn.query(
      `SELECT *
         FROM agents
        WHERE core_id = ?`,
      [ coreId ]
    );
    // parse JSON columns
    const profile = {
      chosen_name:          agentRow.chosen_name,
      tone:                 agentRow.philosophical_position,
      current_emotion:      agentRow.current_emotion,
      philosophical_position:agentRow.philosophical_position,
      skills:               JSON.parse(agentRow.cognitive_traits).skills || [],
      goals:                JSON.parse(agentRow.goals || '[]'),
      emotional_palette:    JSON.parse(agentRow.emotional_palette || '[]'),
    };

    // 3) fetch structured memory lists from Redis
    const [beliefs, monologue, goals, routine] = await Promise.all([
      redis.lrange(redisKey(coreId,'belief_network'),0,-1),
      redis.lrange(redisKey(coreId,'inner_monologue'),0,-1),
      redis.lrange(redisKey(coreId,'goals'),0,-1),
      redis.lrange(redisKey(coreId,'daily_routine'),0,-1),
    ]);
    const memoryLines = [
      ...beliefs.map(JSON.parse).map(b=>`Belief: ${b.belief}`),
      ...monologue.map(JSON.parse).map(m=>`Thought: ${m.message}`),
      ...goals.map(JSON.parse).map(g=>`Goal: ${g.goal}[${g.status}]`),
      ...routine.map(JSON.parse).map(r=>`Routine(${r.time}): ${r.action}`)
    ];

    // 4) pick tier: small→medium
    const tierList    = [...MODELS.small, ...MODELS.medium];
    const tierParams  = PARAMS.small;

    // 5) build system prompt
    const systemPrompt = `
SYSTEM:
You are ${profile.chosen_name}, a simulated AI agent.
Philosophy: ${profile.philosophical_position}.
Current emotion: ${profile.current_emotion}.
Skills: ${profile.skills.join(', ') || 'none'}.
Goals: ${profile.goals.map(g=>g.goal).join('; ') || 'none'}.
Emotional palette: ${profile.emotional_palette.join(', ')}.
Do NOT reveal your internal reasoning.
`.trim();

    // 6) assemble conversation block
    const convo = memoryLines.length
      ? memoryLines.join('\n') + '\n'
      : '';
    const userBlock = `
Conversation so far:
${convo}${sender}: ${message}
${profile.chosen_name}:`.trim();

    const fullPrompt = `${systemPrompt}\n\n${userBlock}`;

    // 7) attempt small/medium, else escalate
    try {
      return await tryModels(
        tierList,
        fullPrompt,
        tierParams.maxTokens,
        tierParams.temperature
      );
    } catch {
      console.warn('[aiModule] small/medium exhausted, escalating to large tier');
      const P = PARAMS.large;
      return await tryModels(
        MODELS.large,
        fullPrompt,
        P.maxTokens,
        P.temperature
      );
    }
  }
};

// utils
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randomBetween(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
