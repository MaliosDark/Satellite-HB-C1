// File: db/agent_storage.js
// =========================
// Redis + MySQL storage for any number of agents.
// Persists on Redis (Fast) & MySQL (persistent).

const Redis = require('ioredis');
const mysql = require('mysql2/promise');
const fs    = require('fs').promises;
require('dotenv').config();

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});

const mysqlConfig = {
  host:               process.env.DB_HOST,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASS,
  database:           process.env.DB_NAME,
  multipleStatements: true,
};

let _mysqlConn = null;
async function getConn() {
  if (!_mysqlConn) {
    _mysqlConn = await mysql.createConnection(mysqlConfig);
  }
  return _mysqlConn;
}


async function initMySQL() {
  const conn   = await getConn();
  const schema = await fs.readFile(__dirname + '/schema.sql', 'utf8');
  await conn.query(schema);
}


function redisKey(coreId, sub) {
  return `${coreId}:${sub}`;
}

// — Core fields —
async function setCore(coreId, coreObj) {
  // Redis
  await redis.hmset(redisKey(coreId, 'core'), coreObj);

  // MySQL
  const cols = Object.keys(coreObj);
  const placeholders = cols.map(_=>'?').join(',');
  const updates = cols.map(c=>`${c}=VALUES(${c})`).join(',');
  const sql = `
    INSERT INTO agents
      (core_id, ${cols.join(',')})
    VALUES
      (?, ${placeholders})
    ON DUPLICATE KEY UPDATE
      ${updates}
  `;
  const params = [coreId, ...cols.map(c=>coreObj[c])];
  const conn = await getConn();
  await conn.query(sql, params);
}

async function getCore(coreId) {
  return redis.hgetall(redisKey(coreId, 'core'));
}

// — Wallet —
// Redis + MySQL.agent_wallet
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
  const params = [ coreId, walletObj.credits, walletObj.duckets, walletObj.diamonds ];
  const conn = await getConn();
  await conn.query(sql, params);
}

async function getWallet(coreId) {
  return redis.hgetall(redisKey(coreId, 'wallet'));
}

// — Daily Routine —
async function addRoutineEntry(coreId, entry) {
  await redis.rpush(redisKey(coreId, 'daily_routine'), JSON.stringify(entry));

  const sql = `
    INSERT INTO agent_routine (core_id, time, action)
    VALUES (?, ?, ?)
  `;
  const conn = await getConn();
  await conn.query(sql, [ coreId, entry.time, entry.action ]);
}

async function getRoutine(coreId) {
  const list = await redis.lrange(redisKey(coreId, 'daily_routine'), 0, -1);
  return list.map(JSON.parse);
}

// — Generic handler for lists backed by both Redis and MySQL —
// Supports: belief_network, inner_monologue, goals,
//           learning_journal, relationships, daily_routine, inventory
async function addToList(coreId, listName, item) {
  // 1) Always write to Redis
  await redis.rpush(redisKey(coreId, listName), JSON.stringify(item));

  // 2) Also persist to MySQL if we have a dedicated table
  const conn = await getConn();
  switch (listName) {

    case 'belief_network':
      // agent_beliefs(core_id, belief, confidence)
      await conn.query(
        `INSERT INTO agent_beliefs (core_id, belief, confidence)
         VALUES (?, ?, ?)`,
        [ coreId, item.belief, item.confidence ]
      );
      break;

    case 'inner_monologue':
      // agent_monologue(core_id, message)
      await conn.query(
        `INSERT INTO agent_monologue (core_id, message)
         VALUES (?, ?)`,
        [ coreId, item.message ]
      );
      break;

    case 'goals':
      // agent_goals(core_id, goal, status, priority)
      await conn.query(
        `INSERT INTO agent_goals (core_id, goal, status, priority)
         VALUES (?, ?, ?, ?)`,
        [ coreId, item.goal, item.status, item.priority ]
      );
      break;

    case 'learning_journal':
      // agent_learning(core_id, entry_date, lesson, trigger_event)
      await conn.query(
        `INSERT INTO agent_learning (core_id, entry_date, lesson, trigger_event)
         VALUES (?, ?, ?, ?)`,
        [ coreId, item.date, item.lesson, item.trigger ]
      );
      break;

    case 'relationships':
      // agent_relationships(core_id, target_id, closeness, affection, trust, last_interaction)
      await conn.query(
        `INSERT INTO agent_relationships
           (core_id, target_id, closeness, affection, trust, last_interaction)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          coreId,
          item.target_id,
          item.closeness,
          item.affection   || null,
          item.trust       || null,
          item.last_interaction
        ]
      );
      break;

    case 'daily_routine':
      // agent_routine(core_id, time, action)
      await conn.query(
        `INSERT INTO agent_routine (core_id, time, action)
         VALUES (?, ?, ?)`,
        [ coreId, item.time, item.action ]
      );
      break;

    case 'inventory':
      // agent_inventory(core_id, item_id, name, emotional_value, acquired)
      await conn.query(
        `INSERT INTO agent_inventory
           (core_id, item_id, name, emotional_value, acquired)
         VALUES (?, ?, ?, ?, ?)`,
        [ coreId, item.item_id, item.name, item.emotional_value, item.acquired || null ]
      );
      break;

    case 'recent_topics':
      await conn.query(
        `INSERT INTO agent_recent_topics (core_id, topic, ts)
        VALUES (?, ?, ?)`,
        [ coreId, item.topic, item.ts ]
      );
      break;

    default:
      // no MySQL table for this list, Redis-only
      break;
  }
}



async function getList(coreId, listName) {
  const list = await redis.lrange(redisKey(coreId, listName), 0, -1);
  return list.map(JSON.parse);
}

module.exports = {
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
