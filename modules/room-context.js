// File: modules/room-context.js
// =============================
// Fetches current room context (user count + items) for a given botId.

const mysql = require('mysql2/promise');
const botConfigs = require('../config/bots-config');
require('dotenv').config();

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '',
  user:               process.env.DB_USER     || '',
  password:           process.env.DB_PASS     || '',
  database:           process.env.DB_NAME     || '',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0
});

/**
 * Returns a string like "Users: 5, Items: sofa_neo_red, dream_vase"
 * @param {number} botId 
 */
async function getRoomContext(botId) {
  // 1) look up the roomId for this bot
  const cfg = botConfigs.find(c => c.botId === botId);
  if (!cfg) throw new Error(`No botConfig for botId=${botId}`);
  const roomId = cfg.roomId;

  // 2) query user count and item list
  const conn = await pool.getConnection();
  try {
    const [[{ total }]] = await conn.query(
      'SELECT COUNT(*) AS total FROM rooms_users WHERE room_id = ?', 
      [roomId]
    );
    const [rows] = await conn.query(
      'SELECT item_id FROM items_rooms WHERE room_id = ?', 
      [roomId]
    );
    const itemList = rows.map(r => r.item_id).join(', ') || 'none';

    return `Users: ${total}, Items: ${itemList}`;
  } finally {
    conn.release();
  }
}

module.exports = { getRoomContext };
