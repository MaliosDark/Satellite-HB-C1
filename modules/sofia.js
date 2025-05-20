// File: modules/sofia.js
// ======================

const axios = require('axios');
require('dotenv').config();

const SOFIA_URL = process.env.SOFIA_API_URL;
const SOFIA_KEY = process.env.SOFIA_API_KEY;

/**
 * Calls the Sofia API in chat format.
 * @param {string} systemPrompt  – the system-level instructions
 * @param {string} userMessage   – the user’s latest message
 * @param {number} temperature   – sampling temperature
 * @param {number} maxTokens     – maximum tokens allowed in response
 * @returns {Promise<string>}    – Sofia’s reply
 */
async function callSofia(systemPrompt, userMessage, temperature, maxTokens) {
  const res = await axios.post(
    SOFIA_URL,
    {
      model:       'llama3.2:latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage }
      ],
      temperature,
      max_tokens: maxTokens
    },
    {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SOFIA_KEY}`
      }
    }
  );

  const content = res.data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('SOFIA_NO_CONTENT');
  }
  return content.trim();
}

module.exports = { callSofia };
