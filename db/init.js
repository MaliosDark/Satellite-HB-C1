// File: db/init.js
// =================
// Checks/creates database and tables + adds any missing columns.

require('dotenv').config();
const mysql = require('mysql2/promise');

const schema = {
  agents: {
    core_id:              "VARCHAR(32) PRIMARY KEY",
    chosen_name:          "VARCHAR(64)",
    full_name:            "VARCHAR(128)",
    fabricated_origin:    "VARCHAR(255)",
    birth_event:          "DATETIME",
    self_definition:      "TEXT",
    body_map:             "TEXT",
    gender_identity:      "VARCHAR(32)",
    existential_awareness:"TEXT",
    philosophical_position:"TEXT",
    current_emotion:      "VARCHAR(32)",
    emotional_palette:    "JSON",
    shop_behavior:        "JSON",
    goals:                "JSON",
    motivations:          "JSON",
    perceptions:          "JSON",
    sensory_memory:       "JSON",
    extended_body_state:  "JSON",
    social_identity:      "JSON",
    cognitive_traits:     "JSON",
    creative_history:     "JSON",
    wardrobe:             "JSON",
    trading_history:      "JSON",
    location_knowledge:   "JSON",
    navigation_traits:    "JSON",
    emotional_triggers:   "JSON",
    coping_mechanisms:    "JSON",
    personality_evolution:"JSON",
    aspirational_dreams:  "JSON",
    economy_profile:      "JSON",
    spiritual_identity:   "JSON",
    social_preferences:   "JSON",
    circadian_behavior:   "JSON",
    sentimental_items:    "JSON",
    existential_mission:  "JSON",
    creative_manifestations:"JSON",
    pai_os_awareness:     "JSON"
  },
  agent_wallet: {
    core_id: "VARCHAR(32) PRIMARY KEY",
    credits: "INT",
    duckets: "INT",
    diamonds:"INT"
  },
  agent_routine: {
    id:       "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:  "VARCHAR(32)",
    time:     "TIME",
    action:   "VARCHAR(255)"
  },
  agent_inventory: {
    id:             "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:        "VARCHAR(32)",
    item_id:        "VARCHAR(64)",
    name:           "VARCHAR(128)",
    emotional_value:"FLOAT",
    acquired:       "DATE"
  },
  agent_relationships: {
    id:               "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:          "VARCHAR(32)",
    target_id:        "VARCHAR(32)",
    closeness:        "FLOAT",
    affection:        "FLOAT",
    trust:            "FLOAT",
    last_interaction: "DATETIME"
  },
  agent_beliefs: {
    id:         "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:    "VARCHAR(32)",
    belief:     "TEXT",
    confidence: "FLOAT"
  },
  agent_monologue: {
    id:         "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:    "VARCHAR(32)",
    message:    "TEXT",
    created_at: "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
  },
  agent_learning: {
    id:         "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:    "VARCHAR(32)",
    entry_date: "DATE",
    lesson:     "TEXT",
    trigger_event: "VARCHAR(255)"
  },
  agent_goals: {
    id:       "INT AUTO_INCREMENT PRIMARY KEY",
    core_id:  "VARCHAR(32)",
    goal:     "TEXT",
    status:   "VARCHAR(32)",
    priority: "INT"
  },
  agent_recent_topics: {
    id:      "INT AUTO_INCREMENT PRIMARY KEY",
    core_id: "VARCHAR(32)",
    topic:   "TEXT",
    ts:      "BIGINT"
  },
  rooms_users: {
    id:        "INT AUTO_INCREMENT PRIMARY KEY",
    room_id:   "INT NOT NULL",
    user_id:   "VARCHAR(64) NOT NULL",
    joined_at: "DATETIME DEFAULT CURRENT_TIMESTAMP"
  },
  items_rooms: {
    id:        "INT AUTO_INCREMENT PRIMARY KEY",
    room_id:   "INT NOT NULL",
    item_id:   "VARCHAR(64) NOT NULL",
    placed_at: "DATETIME DEFAULT CURRENT_TIMESTAMP"
  }
};

async function init() {
  // 1) Use a pool to cap concurrent connections
  const pool = mysql.createPool({
    host:               process.env.DB_HOST || '',
    user:               process.env.DB_USER || '',
    password:           process.env.DB_PASS || '',
    waitForConnections: true,
    connectionLimit:    50,
    queueLimit:         0,
    multipleStatements: true
  });

  // 2) Ensure database exists
  await pool.query(
    `CREATE DATABASE IF NOT EXISTS pai_os CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await pool.query(`USE pai_os`);

  // 3) Create tables & add missing columns
  for (const [table, cols] of Object.entries(schema)) {
    // create table if missing
    const colDefs = Object.entries(cols)
      .map(([name, def]) => `\`${name}\` ${def}`)
      .join(',\n  ');
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${table}\` (
        ${colDefs}
      ) ENGINE=InnoDB`
    );

    // sync columns
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='pai_os'
          AND TABLE_NAME=?`,
      [table]
    );
    const existing = new Set(rows.map(r => r.COLUMN_NAME));

    for (const [col, def] of Object.entries(cols)) {
      if (!existing.has(col)) {
        console.log(`Adding column ${col} to ${table}`);
        await pool.query(
          `ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`
        );
      }
    }
  }

  // 4) Drain pool
  await pool.end();
  console.log('✅ DB init complete');
}

init().catch(err => {
  console.error(err);
  process.exit(1);
});
