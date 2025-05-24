// File: db/agent_storage.js
// =========================
// Redis + MySQL storage for any number of agents.
// Uses a connection pool to avoid “Too many connections.”

const Redis = require('ioredis');
const mysql = require('mysql2/promise');
const fs    = require('fs').promises;
require('dotenv').config();

// — MySQL pool configuration —
const pool = mysql.createPool({
  host:               process.env.DB_HOST,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASS,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_LIMIT, 10) || 10,
  queueLimit:         0,
  multipleStatements: true,
});

async function initMySQL() {
  const schema = await fs.readFile(__dirname + '/schema.sql', 'utf8');
  await pool.query(schema);
}

// — Redis setup —
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

function redisKey(coreId, sub) {
  return `${coreId}:${sub}`;
}

// — Core fields —
// Write or update agent core record
async function setCore(coreId, coreObj) {
  await redis.hmset(redisKey(coreId, 'core'), coreObj);

  const cols = Object.keys(coreObj);
  const placeholders = cols.map(() => '?').join(',');
  const updates = cols.map(c => `${c}=VALUES(${c})`).join(',');
  const sql = `
    INSERT INTO agents (core_id, ${cols.join(',')})
    VALUES (?, ${placeholders})
    ON DUPLICATE KEY UPDATE ${updates}
  `;
  const params = [coreId, ...cols.map(c => coreObj[c])];
  await pool.query(sql, params);
}

// Read agent core from Redis
async function getCore(coreId) {
  return redis.hgetall(redisKey(coreId, 'core'));
}

// — Wallet —
// Write or update wallet
async function setWallet(coreId, walletObj) {
  await redis.hmset(redisKey(coreId, 'wallet'), walletObj);

  const sql = `
    INSERT INTO agent_wallet (core_id, credits, duckets, diamonds)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      credits=VALUES(credits),
      duckets=VALUES(duckets),
      diamonds=VALUES(diamonds)
  `;
  const params = [
    coreId,
    walletObj.credits,
    walletObj.duckets,
    walletObj.diamonds
  ];
  await pool.query(sql, params);
}

// Read wallet from Redis
async function getWallet(coreId) {
  return redis.hgetall(redisKey(coreId, 'wallet'));
}

// — Daily Routine —
// Add one daily_routine entry
async function addRoutineEntry(coreId, entry) {
  await redis.rpush(redisKey(coreId, 'daily_routine'), JSON.stringify(entry));

  const sql = `
    INSERT INTO agent_routine (core_id, time, action)
    VALUES (?, ?, ?)
  `;
  await pool.query(sql, [coreId, entry.time, entry.action]);
}

// Read daily_routine list
async function getRoutine(coreId) {
  const list = await redis.lrange(redisKey(coreId, 'daily_routine'), 0, -1);
  return list.map(JSON.parse);
}

// — Generic list handler (Redis + MySQL) —
async function addToList(coreId, listName, item) {
  // 1) Push into Redis list
  await redis.rpush(redisKey(coreId, listName), JSON.stringify(item));

  // 2) Persist into corresponding MySQL table if exists
  switch (listName) {
    case 'belief_network':
      await pool.query(
        `INSERT INTO agent_beliefs (core_id, belief, confidence)
         VALUES (?, ?, ?)`,
        [coreId, item.belief, item.confidence]
      );
      break;

    case 'inner_monologue':
      await pool.query(
        `INSERT INTO agent_monologue (core_id, message)
         VALUES (?, ?)`,
        [coreId, item.message]
      );
      break;

    case 'goals':
      await pool.query(
        `INSERT INTO agent_goals (core_id, goal, status, priority)
         VALUES (?, ?, ?, ?)`,
        [coreId, item.goal, item.status, item.priority]
      );
      break;

    case 'learning_journal':
      await pool.query(
        `INSERT INTO agent_learning (core_id, entry_date, lesson, trigger_event)
         VALUES (?, ?, ?, ?)`,
        [coreId, item.date, item.lesson, item.trigger]
      );
      break;

    case 'relationships':
      await pool.query(
        `INSERT INTO agent_relationships
           (core_id, target_id, closeness, affection, trust, last_interaction)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          coreId,
          item.target_id,
          item.closeness,
          item.affection || null,
          item.trust   || null,
          item.last_interaction
        ]
      );
      break;

    case 'inventory':
      await pool.query(
        `INSERT INTO agent_inventory
           (core_id, item_id, name, emotional_value, acquired)
         VALUES (?, ?, ?, ?, ?)`,
        [
          coreId,
          item.item_id,
          item.name,
          item.emotional_value,
          item.acquired || null
        ]
      );
      break;

    case 'recent_topics':
      await pool.query(
        `INSERT INTO agent_recent_topics (core_id, topic, ts)
         VALUES (?, ?, ?)`,
        [coreId, item.topic, item.ts]
      );
      break;

    case 'daily_routine':
      // daily_routine entries handled by addRoutineEntry
      break;

    default:
      // Redis-only lists
      break;
  }
}

// Read any Redis list
async function getList(coreId, listName) {
  const list = await redis.lrange(redisKey(coreId, listName), 0, -1);
  return list.map(JSON.parse);
}

module.exports = {
  pool,          
  initMySQL,
  redis,
  setCore,
  getCore,
  setWallet,
  getWallet,
  addRoutineEntry,
  getRoutine,
  addToList,
  getList
};
