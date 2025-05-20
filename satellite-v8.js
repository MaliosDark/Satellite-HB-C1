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
  getList
} = require('./db/agent_storage');

const HabboClient        = require('./modules/client-emulator');
const botConfigs         = require('./config/bots-config');
const aiModule           = require('./modules/aiModule');
const { getRoomContext } = require('./modules/room-context');

// debounce before replying (ms)
const REPLY_DEBOUNCE_MS = 5000;

// cooldown durations after sending (ms)
const GLOBAL_CD = 3000;
const USER_CD   = 3000;

// helpers
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// track busy keys for cooldowns
const busy = new Map();

// pending reply timers per sender
const replyTimers = new Map();

async function main() {
  await initMySQL();
  console.log('✅ MySQL schema ready');

  for (const cfg of botConfigs) {
    let client;
    // wrap onChat to debounce
    const handler = makeHandler(cfg, () => client);

    client = new HabboClient({
      iframeUrl: cfg.iframeUrl,
      username:  cfg.username,
      roomId:    cfg.roomId,
      onChat:    handler
    });
    console.log(`🚀 ${cfg.username} launched`);
    await sleep(300);
  }
}

/**
 * Debounced handler creator
 * @param {object} cfg
 * @param {() => HabboClient} getClient
 */
function makeHandler(cfg, getClient) {
  return (senderRaw, textRaw) => {
    const botName = cfg.username.toLowerCase();
    const sender  = senderRaw.toLowerCase();
    const text    = textRaw.trim();

    // ignore your own
    if (sender === botName) return;

    // clear any previous timer for this sender
    clearTimeout(replyTimers.get(sender));

    // schedule the actual response once they've paused
    const t = setTimeout(async () => {
      replyTimers.delete(sender);
      await handleMessage(cfg, getClient(), sender, text);
    }, REPLY_DEBOUNCE_MS);

    replyTimers.set(sender, t);
  };
}

/**
 * Actual per‐message logic: load memory, generate & send
 */
async function handleMessage(cfg, client, sender, text) {
  const botKey = `bot:${cfg.username}`;
  // enforce cooldown
  if (busy.has(botKey) || busy.has(sender)) return;
  busy.set(botKey, true);
  busy.set(sender, true);

  try {
    // 1) load or bootstrap profile
    let profile = await getCore(cfg.botId);
    if (!profile || !profile.core_id) {
      profile = await aiModule.loadProfile(cfg.username);
    }
    const coreId = profile.core_id;

    // 2) gather memory lists
    const lists = [
      'daily_routine', 'belief_network', 'inner_monologue', 'conflicts',
      'personal_timeline','relationships','motivations','dream_generator',
      'goals','perceptions','learning_journal','aspirational_dreams'
    ];
    let memoryArr = [];
    for (const name of lists) {
      memoryArr.push(...await getList(coreId, name));
    }
    const memText = memoryArr.map(e => JSON.stringify(e)).join('\n');

    // 3) get room context
    const context = await getRoomContext(cfg.botId);

    // 4) think delay
    const [minD, maxD] = aiModule.THINK_DELAY_RANGE;
    await sleep(randomBetween(minD, maxD));

    // 5) generate reply
    const reply = await aiModule.generateReply({
      memory:  memText,
      profile,
      context,
      sender,
      message: text
    });

    // 6) record memory
    await addToList(coreId, 'inner_monologue', {
      role:    'user',
      sender,
      message: text,
      ts:      Date.now()
    });
    await addToList(coreId, 'inner_monologue', {
      role:    'bot',
      sender:  cfg.username.toLowerCase(),
      message: reply,
      ts:      Date.now()
    });

    // 7) send the full reply in one message
    const out = `${cfg.username} → ${sender}: ${reply}`;
    await client.sendChat(out);
  }
  catch (err) {
    console.error(`[${cfg.username}] handleMessage error:`, err);
  }
  finally {
    // release locks after cooldown
    setTimeout(() => busy.delete(`bot:${cfg.username}`), GLOBAL_CD);
    setTimeout(() => busy.delete(sender),                 USER_CD);
  }
}

main().catch(console.error);
