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
const GLOBAL_CD = 15_000;
const USER_CD   = 10_000;

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
    const client = new HabboClient({
      iframeUrl: cfg.iframeUrl,
      username:  cfg.username,
      roomId:    cfg.roomId,
      onChat:    makeHandler(cfg)
    });
    console.log(`🚀 ${cfg.username} launched`);
    await sleep(300);
  }
}

function makeHandler(cfg){
  return async function onChat(senderRaw, textRaw){
    const botName = cfg.username.toLowerCase();
    const sender  = senderRaw.toLowerCase();
    const text    = textRaw.trim();
    const now     = Date.now();
    const botKey  = `bot:${cfg.username}`;

    if (sender === botName) return;
    if (!text.includes(botName) && !/^(hi|hello|hey)\b/i.test(text)) return;
    if (busy.has(botKey) || busy.has(sender)) return;
    busy.set(botKey, true);
    busy.set(sender,  true);

    try {
      let profile = await getCore(cfg.botId);
      if (!profile || !profile.core_id) {
        profile = await aiModule.loadProfile(cfg.username);
      }


      const lists = [
        'daily_routine',
        'belief_network',
        'inner_monologue',
        'conflicts',
        'personal_timeline',
        'relationships',
        'motivations',
        'dream_generator',
        'goals',
        'perceptions',
        'learning_journal',
        'aspirational_dreams'
      ];
      let memoryArr = [];
      for (const name of lists) {
        const items = await getList(cfg.botId, name);
        memoryArr.push(...items);
      }
      const memText = memoryArr.map(e => JSON.stringify(e)).join('\n');

      const context = await getRoomContext(cfg.botId);

      const [minD, maxD] = aiModule.THINK_DELAY_RANGE;
      await sleep(randomBetween(minD, maxD));

      const reply = await aiModule.generateReply({
        memory:  memText,
        profile,
        context,
        sender,
        message: text
      });

      await addToList(cfg.botId, 'inner_monologue', { role:'user',   sender, text, ts: now });
      await addToList(cfg.botId, 'inner_monologue', { role:'bot',    sender:botName, text:reply, ts: Date.now() });

      await client.sendChat(`${cfg.username}: ${reply}`);
    }
    catch(err) {
      console.error(`[${cfg.username}] onChat error:`, err);
    }
    finally {
      setTimeout(()=> busy.delete(botKey), GLOBAL_CD);
      setTimeout(()=> busy.delete(sender),   USER_CD);
    }
  };
}

main().catch(console.error);
