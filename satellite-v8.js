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
  setCore,
  addToList,
  getList,
  redis
} = require('./db/agent_storage');


const HabboClient        = require('./modules/client-emulator');
const botConfigs         = require('./config/bots-config');
const aiModule           = require('./modules/aiModule');
const { getRoomContext } = require('./modules/room-context');
const movement           = require('./modules/room-movement');
const { extractTopics } = require('./modules/topicExtractor');
const evo = require('./modules/evolution');
const { retrieveRelevant } = require('./modules/memoryRetriever');
const memoryEnhancer = require('./modules/memoryEnhancer');
const memoryManager = require('./modules/memoryManager');



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
          await movement.randomWander(client.page, { width: 20, height: 20 }, 5);
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

    // Make sure cognitive_traits is always an object, never a "[object Object]" string
    if (typeof profile.cognitive_traits === 'string') {
      try {
        profile.cognitive_traits = JSON.parse(profile.cognitive_traits);
      } catch (err) {
        // If parsing fails, fall back to an empty traits object
        profile.cognitive_traits = {};
        console.warn(`[${cfg.username}] Warning: failed to parse cognitive_traits; reset to {}`, err);
      }
    }

    // 3) Gather memory (commented for later study)
    // const lists = [
    //   'daily_routine','belief_network','inner_monologue','conflicts',
    //   'personal_timeline','relationships','motivations','dream_generator',
    //   'goals','perceptions','learning_journal','aspirational_dreams'
    // ];
    // let memArr = [];
    // for (const name of lists) {
    //   memArr.push(...await getList(coreId, name));
    // }
    // const memText = memArr.map(e => JSON.stringify(e)).join('\n');
    

    // 4) Get current room context
    const context = await getRoomContext(cfg.botId);

    const query = `${text} | Context: ${context}`;
    const topMemories = await retrieveRelevant(coreId, 'inner_monologue', query, 5);
    const semanticCues = await memoryManager.retrieveMemories(coreId, 'semantic', {
      query: text,
      k: 5
    });
    const memorySnippet = [
      ...semanticCues.map(c => c.text || `${c.sender}:${c.message}`),
      ...topMemories.map(m => `${m.role}:${m.sender}:${m.message}`)
    ].join('\n');
    

    // 5) Human-like thinking delay
    await sleep(randomBetween(...aiModule.THINK_DELAY_RANGE));

    // 6) Generate reply
    let reply = await aiModule.generateReply({
      profile,
      context,
      sender,
      memory: memorySnippet,
      message: text
    });

    // 6.5) Extract “real” topics from the user’s text
    const topics = extractTopics(text, { lang: 'en' });
    for (const topic of topics) {
      await addToList(coreId, 'recent_topics', { topic, ts: Date.now() });
    }

    // 6.6) EVOLUTION & MEMORY-DECAY STEP — based on last turn
    const oldEmo = profile.current_emotion;
    const oldCog = profile.cognitive_traits;  
    const now    = Date.now();

    // A) Emotion shift
    const newEmotion   = evo.computeEmotionShift(oldEmo, text, reply);

    // B) Cognitive traits shift
    const newCogTraits = evo.computeCognitiveShift(oldCog, text, reply);

    // C) Belief revision
    const rawBeliefs     = await getList(coreId, 'belief_network');
    const updatedBeliefs = evo.reviseBeliefs(rawBeliefs, text, reply);

    // D) Memory decay
    const rawMono     = await getList(coreId, 'inner_monologue');
    const filteredMono = evo.applyMemoryDecay(rawMono, now);

    // E) Persist core updates
    await setCore(coreId, {
      current_emotion:   newEmotion,
      cognitive_traits: JSON.stringify(newCogTraits)
    });

    // F) Replace belief_network in Redis/MySQL
    await redis.del(`${coreId}:belief_network`);
    for (const b of updatedBeliefs) {
      await addToList(coreId, 'belief_network', b);
    }

    // G) (Optional) prune inner_monologue
    await redis.del(`${coreId}:inner_monologue`);
    for (const m of filteredMono) {
      await addToList(coreId, 'inner_monologue', m);
    }

    // Update in-memory profile for remainder of this turn
    profile.current_emotion   = newEmotion;
    profile.cognitive_traits  = newCogTraits;


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

    await memoryManager.writeMemory(coreId, 'episodic', {
      text,
      sender,
      ts: Date.now()
    });
    await memoryManager.consolidate(coreId);
    await memoryManager.applyDecay(coreId);
    
    // 7.5) Memory enhancing: summaries, pruning, episodes, self-reflection
    await memoryEnhancer.enhance(coreId);

    const LAST_CACHE_KEY = `${botKey}:last_replies`;
    let lastReplies = (await redis.lrange(LAST_CACHE_KEY, 0, 9)) || []; 

    function isTooSimilar(a, b) {
      const min = Math.min(a.length, b.length);
      let same = 0;
      while (same < min && a[same] === b[same]) same++;
      return (same / b.length) > 0.7;  // >70% igual
    }

    if ( lastReplies.some(old => isTooSimilar(old, reply)) ) {
      console.log('[REPEAT] detected reply too similar, regenerating…');
      reply = await aiModule.generateReply({ profile, context, sender, message: text });
    }

    await redis.lpush(LAST_CACHE_KEY, reply);
    await redis.ltrim(LAST_CACHE_KEY, 0, 9);

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
      // 1️⃣ Envío público siempre
      await client.sendChat(chunk);

      // 2️⃣ Ocasionalmente, susurra al jugador más cercano (30% de las veces)
      const nearby = await client.getNearbyPlayers(150);
      if (nearby.length > 0 && Math.random() < 0.3) {
        nearby.sort((a, b) => a.distance - b.distance);
        await client.performSocialAction({ type: 'whisper', target: nearby[0].username });
      }

      // ─── CONTEXT‐DRIVEN SOCIAL INTERACTIONS
      // 3) Pide amistad si confiamos en quien habló
      if (profile.cognitive_traits.trust > 0.7) {
        await client.performSocialAction({ type: 'friend', target: sender });
      }

      // 4) Da “respeto” si usó “thank you” o “please”
      if (/\b(thank you|please)\b/i.test(text)) {
        await client.performSocialAction({ type: 'respect', target: sender });
      }

      // 5) Si lo habíamos ignorado, dale una segunda oportunidad
      const ignored = (await getList(coreId, 'ignored_users')) || [];
      if (ignored.find(u => u.user === sender)) {
        await client.performSocialAction({ type: 'unignore', target: sender });
        await redis.lrem(`${coreId}:ignored_users`, 0, JSON.stringify({ user: sender }));
      }

      // 6) Mantenemos el “latido social” con una danza ocasional
      const wantsDance = reply.toLowerCase().endsWith('[dance]');
      const sociability = profile.cognitive_traits.sociability ?? 0;
      if (wantsDance || sociability > 0.6 || Math.random() < 0.1) {
        await client.performContextAction();
      }

      // 7) Acepta peticiones de amistad entrantes
      await client.handleIncomingFriendRequest();

      // Pausa antes del siguiente chunk
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

