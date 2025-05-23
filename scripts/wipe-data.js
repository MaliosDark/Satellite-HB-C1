// scripts/wipe-data.js
// =====================
//
//  ╔═══════════════════════════════════════════╗
//  ║       🚀 PAi-OS Data Wiper v1.0 🚀        ║
//  ╚═══════════════════════════════════════════╝

require('dotenv').config();
const mysql = require('mysql2/promise');
const Redis = require('ioredis');

const {
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  REDIS_HOST,
  REDIS_PORT
} = process.env;

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';

(async function() {
  console.log(
    BOLD + CYAN + `
    ╔══════════════════════════════════════╗
    ║         PAi-OS Data Wiper           ║
    ║      Drop MySQL + Flush Redis       ║
    ╚══════════════════════════════════════╝
  ` + RESET
  );

  // ——— MYSQL —————————————————————————————————
  console.log(YELLOW + `→ Connecting to MySQL @ ${DB_HOST}…` + RESET);
  const mysqlConfig = {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    multipleStatements: true
  };

  try {
    const conn = await mysql.createConnection(mysqlConfig);
    console.log(GREEN + '✔ MySQL connected' + RESET);
    console.log(YELLOW + `→ Dropping database ${DB_NAME} if exists…` + RESET);
    await conn.query(`
      DROP DATABASE IF EXISTS \`${DB_NAME}\`;
      CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    `);
    console.log(GREEN + `✔ Database ${DB_NAME} dropped and re-created` + RESET);
    await conn.end();
  } catch (err) {
    console.error(RED + '✖ MySQL error:' + RESET, err.message);
    process.exit(1);
  }

  // ——— REDIS —————————————————————————————————
  console.log('\n' + YELLOW + `→ Connecting to Redis @ ${REDIS_HOST}:${REDIS_PORT}…` + RESET);
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT
  });

  redis.on('error', e => {
    console.error(RED + '✖ Redis error:' + RESET, e.message);
    process.exit(1);
  });

  await new Promise(r => redis.once('ready', r));
  console.log(GREEN + '✔ Redis connected' + RESET);
  console.log(YELLOW + '→ Flushing Redis DB 0…' + RESET);
  await redis.flushdb();
  console.log(GREEN + '✔ Redis DB 0 flushed' + RESET);

  // ——— DONE —————————————————————————————————
  console.log(
    BOLD + CYAN + `
    ╔══════════════════════════════════════╗
    ║        All data has been wiped!      ║
    ║  PAi-OS ready for a fresh bootstrap  ║
    ╚══════════════════════════════════════╝
  ` + RESET
  );

  redis.disconnect();
  process.exit(0);
})();
