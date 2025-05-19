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

const HabboClient      = require('./modules/client-emulator');
const botConfigs       = require('./config/bots-config');
const aiModule         = require('./modules/aiModule');
const { getRoomContext } = require('./modules/room-context');

// cooldown durations
const GLOBAL_CD = 3_000;
const USER_CD   = 3_000;

// helper functions
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// track busy keys for cooldowns
const busy = new Map();

async function main(){
  await initMySQL();
  console.log('✅ MySQL schema ready');

  for(const cfg of botConfigs){
    // define handler and client in sequence so `client` is in scope
    let client;
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
 * @param {object} cfg
 * @param {() => HabboClient} getClient
 */
function makeHandler(cfg, getClient) {
  return async function onChat(senderRaw, textRaw) {
    const client  = getClient();
    const botName = cfg.username.toLowerCase();
    const sender  = senderRaw.toLowerCase();
    const text    = textRaw.trim();
    const now     = Date.now();
    const botKey  = `bot:${cfg.username}`;

    // 1) ignore your own messages
    if (sender === botName) return;

    // 2) block re-entrance while busy
    if (busy.has(botKey) || busy.has(sender)) return;
    busy.set(botKey, true);
    busy.set(sender, true);

    try {
      // 3) load or bootstrap profile
      let profile = await getCore(cfg.botId);
      if (!profile || !profile.core_id) {
        profile = await aiModule.loadProfile(cfg.username);
      }

      // 4) gather memory
      const lists = [
        'daily_routine','belief_network','inner_monologue','conflicts',
        'personal_timeline','relationships','motivations','dream_generator',
        'goals','perceptions','learning_journal','aspirational_dreams'
      ];
      let memoryArr = [];
      for (const name of lists) {
        memoryArr.push(...await getList(cfg.botId, name));
      }
      const memText = memoryArr.map(e => JSON.stringify(e)).join('\n');

      // 5) get room context
      const context = await getRoomContext(cfg.botId);

      // 6) think delay
      const [minD, maxD] = aiModule.THINK_DELAY_RANGE;
      await sleep(randomBetween(minD, maxD));

      // 7) generate reply
      const reply = await aiModule.generateReply({
        memory:  memText,
        profile,
        context,
        sender,
        message: text
      });

      // 8) record memory
      await addToList(cfg.botId, 'inner_monologue', { role:'user', sender, text, ts: now });
      await addToList(cfg.botId, 'inner_monologue', { role:'bot', sender:botName, text:reply, ts: Date.now() });

      // 9) send reply, tagging the original sender
      //    e.g. "Nova → user123: Hello there!"
      const out = `${cfg.username} → ${senderRaw}: ${reply}`;
      await client.sendChat(out);

      // 10) clear busy immediately so you can respond quickly again
      busy.delete(botKey);
      busy.delete(sender);
    }
    catch(err) {
      console.error(`[${cfg.username}] onChat error:`, err);
    }
    finally {
      // fallback clear in case something went wrong
      setTimeout(() => busy.delete(botKey), GLOBAL_CD);
      setTimeout(() => busy.delete(sender),   USER_CD);
    }
  };
}


main().catch(console.error);
