// File: satellite-v8.js
// =====================

// ————————————————————————————————————————————————————————————————————————
//            .       .                   .       .      .     .      .
//           .    .         .    .            .     ______
//       .           .             .               ////////
//                 .    .   ________   .  .      /////////     .    .
//            .            |.____.  /\        ./////////    .
//     .                 .//      \/  |\     /////////
//        .       .    .//          \ |  \ /////////       .     .   .
//                     ||.    .    .| |  ///////// .     .
//      .    .         ||           | |//`,/////                .
//              .       \\        ./ //  /  \/   .
//   .                    \\.___./ //\` '   ,_\     .     .
//           .           .     \ //////\ , /   \                 .    .
//                        .    ///////// \|  '  |    .
//       .        .          ///////// .   \ _ /          .
//                         /////////                              .
//                  .   ./////////     .     .
//          .           --------   .                  ..             .
//   .               .        .         .                       .
//                         ________________________
// ____________------------                        -------------_________

//  PAi-OS Satellite v8 • 2025
// ————————————————————————————————————————————————————————————————————————

console.log(
  "  ____       _    ___  ____    ____        _   _   _ ____         ____ _ \n" +
  " |  _ \\ __ _(_)  / _ \\/ ___|  / ___|  __ _| |_| | | | __ )       / ___/ |\n" +
  " | |_) / _` | | | | | \\___ \\  \\___ \\ / _` | __| |_| |  _ \\ _____| |   | |\n" +
  " |  __/ (_| | | | |_| |___) |  ___) | (_| | |_|  _  | |_) |_____| |___| |\n" +
  " |_|   \\__,_|_|  \\___/|____/  |____/ \\__,_|\\__|_| |_|____/       \\____|_|\n" +
  "\n" +
  "      PAi-OS Satellite v8 • Starting up...\n"
);


// File: satellite-v8.js
// =====================

require('dotenv').config();
const {
  initMySQL,
  getCore,
  addToList,
  getList,
  redis               // for the room-turn lock
} = require('./db/agent_storage');

const HabboClient        = require('./modules/client-emulator');
const botConfigs         = require('./config/bots-config');
const aiModule           = require('./modules/aiModule');
const { getRoomContext } = require('./modules/room-context');
const movement           = require('./modules/room-movement');

// debounce before replying (ms)
const REPLY_DEBOUNCE_MS    = 8000;
// cooldown durations after sending (ms)
const GLOBAL_CD            = 5000;
const USER_CD              = 5000;
// wander interval between autonomous moves (ms)
const WANDER_INTERVAL_MIN  = 30000;  // 30s
const WANDER_INTERVAL_MAX  = 60000;  // 60s
// TTL for the room-turn lock: debounce + max think delay + margin
const LOCK_TTL_MS = REPLY_DEBOUNCE_MS
  + Math.max(...aiModule.THINK_DELAY_RANGE)
  + 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// per-bot & per-sender locks
const busy        = new Map();
const replyTimers = new Map();

async function main() {
  await initMySQL();
  console.log('✅ MySQL schema ready');

  for (const cfg of botConfigs) {
    let client;
    const handler = makeHandler(cfg, () => client);

    client = new HabboClient({
      iframeUrl: cfg.iframeUrl,
      username:  cfg.username,
      roomId:    cfg.roomId,
      onChat:    handler
    });
    console.log(`🚀 ${cfg.username} launched`);

    // autonomous random wandering
    ;(async function wanderForever() {
      while (!client.page) {
        await sleep(100);
      }
      while (true) {
        await sleep(randomBetween(WANDER_INTERVAL_MIN, WANDER_INTERVAL_MAX));
        try {
          await movement.randomWander(client.page, { width: 10, height: 10 }, 5);
        } catch (err) {
          console.error(`[${cfg.username}] wander error:`, err);
        }
      }
    })();
  
    await sleep(300);
  }
}

/**
 * Creates a debounced onChat handler per bot.
 */
function makeHandler(cfg, getClient) {
  return (senderRaw, textRaw) => {
    const botName = cfg.username.toLowerCase();
    const sender  = senderRaw.toLowerCase();
    const text    = textRaw.trim();
    if (sender === botName) return;

    clearTimeout(replyTimers.get(sender));
    const t = setTimeout(async () => {
      replyTimers.delete(sender);
      await handleMessage(cfg, getClient(), sender, text);
    }, REPLY_DEBOUNCE_MS);
    replyTimers.set(sender, t);
  };
}

/**
 * Main message handling: turn-lock → load memory → LLM → send → cleanup.
 */
async function handleMessage(cfg, client, sender, text) {
  const botName = cfg.username.toLowerCase();
  const botKey  = `bot:${cfg.username}`;
  const lockKey = `room:${cfg.roomId}:turn_lock`;

  // 0) Attempt to acquire the room-turn lock
  const got = await redis.set(lockKey, botName, 'NX', 'PX', LOCK_TTL_MS);
  if (got !== 'OK') {
    // someone else is speaking right now
    return;
  }

  // 1) Per-bot & per-sender cooldown
  if (busy.has(botKey) || busy.has(sender)) {
    await redis.del(lockKey);
    return;
  }
  busy.set(botKey, true);
  busy.set(sender, true);

  try {
    // 2) Load or bootstrap profile
    let profile = await getCore(cfg.botId);
    if (!profile || !profile.core_id) {
      profile = await aiModule.loadProfile(cfg.username);
    }
    const coreId = profile.core_id;

    // 3) Gather memory (commented for later study)
    /*
    const lists = [
      'daily_routine','belief_network','inner_monologue','conflicts',
      'personal_timeline','relationships','motivations','dream_generator',
      'goals','perceptions','learning_journal','aspirational_dreams'
    ];
    let memArr = [];
    for (const name of lists) {
      memArr.push(...await getList(coreId, name));
    }
    const memText = memArr.map(e => JSON.stringify(e)).join('\n');
    */

    // 4) Get current room context
    const context = await getRoomContext(cfg.botId);

    // 5) Human-like thinking delay
    await sleep(randomBetween(...aiModule.THINK_DELAY_RANGE));

    // 6) Generate reply
    let reply = await aiModule.generateReply({
      // memory:  memText,    // commented out for now
      profile,
      context,
      sender,
      message: text
    });

    // 7) Record memory
    await addToList(coreId, 'inner_monologue', {
      role:    'user',
      sender,
      message: text,
      ts:      Date.now()
    });
    await addToList(coreId, 'inner_monologue', {
      role:    'bot',
      sender:  botName,
      message: reply,
      ts:      Date.now()
    });

    // 8) Chunk into ≤100-char bubbles and send with 3 s gap
    const MAX = 100;
    const chunks = [];
    let buf = '';
    for (const w of reply.split(' ')) {
      if ((buf + ' ' + w).trim().length > MAX) {
        chunks.push(buf.trim());
        buf = w;
      } else {
        buf += ' ' + w;
      }
    }
    if (buf) chunks.push(buf.trim());

    for (const chunk of chunks) {
      const out = `${cfg.username} → ${sender}: ${chunk}`;
      await client.sendChat(out);
      await sleep(3000);
    }
  }
  catch (err) {
    console.error(`[${cfg.username}] handleMessage error:`, err);
  }
  finally {
    // 9) Release cooldowns
    setTimeout(() => busy.delete(botKey), GLOBAL_CD);
    setTimeout(() => busy.delete(sender),   USER_CD);
    // 10) Release the room-turn lock
    await redis.del(lockKey);
  }
}

main().catch(console.error);

