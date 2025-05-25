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
const memoryEnhancer = require('./modules/memoryEnhancer');
const memoryManager = require('./modules/memoryManager');
const { getHistory } = require('./modules/history');
const { postTweet } = require('./modules/twitterPoster');
const { composeTweet } = require('./modules/tweetComposer');



// ── room-hop tuning ──────────────────────────────
const ROOM_HOP_MIN_TURNS = 8;   
const ROOM_HOP_PROB      = 0.15; 
const CROWD_THRESHOLD    = 5;
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

    // ═══ lonelyWatcher────────────────────
    ;(async function lonelyWatcher() {
      while (!client.page) await sleep(100);

      const CHECK_INTERVAL_MS     = 10_000;   // 10 s reales
      const LONELY_THRESHOLD_SECS = 900;      // 15 min

      let lonelyFor = 0;                      // segundos acumulados
      while (true) {
        await sleep(CHECK_INTERVAL_MS);

        const nearby = await client.getNearbyPlayers(400);
        if (nearby.length === 0) {
          lonelyFor += CHECK_INTERVAL_MS / 1000;
          if (lonelyFor >= LONELY_THRESHOLD_SECS) {
            try {
              await client.sendChat('Nobody around, I will explore another place.');
              await negotiateRoomChange(client, '');
            } catch (e) { console.error(e); }
            lonelyFor = 0;
          }
        } else {
          lonelyFor = 0;
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

    // 3) Gather a unified history slice
    const historyEntries = await getHistory(coreId, [
      'inner_monologue',
      'belief_network',
      'episodes'
    ], 30);

    // 4) Build a single memory snippet
    const context = await getRoomContext(cfg.botId);
    const memorySnippet = historyEntries.map(e => {
      if (e.role === 'user' || e.role === 'bot') {
        return `${e.role}:${e.message}`;
      }
      if (e.belief) {
        return `belief:${e.belief}`;
      }
      if (e.summary || e.text) {
        return `summary:${e.summary || e.text}`;
      }
      return JSON.stringify(e);
    }).join('\n');

    
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

    // ─── Twitter “day-in-the-life” log (≈5 % chance per turn) ────
    if (Math.random() < 0.05) {
      try {
        // 80 %: let the LLM craft a narrative tweet
        if (Math.random() < 0.80) {
          const aiTweet = await composeTweet({
            profile,
            coreId,
            sender,
            message: text,
            reply
          });
          await postTweet(aiTweet);
        }
        // 20 %: fall back to a simple chat-preview tweet
        else {
          const preview = text.length > 60 ? text.slice(0, 57) + '…' : text;
          const tweet   = `[${cfg.username}] chatted with @${sender}: “${preview}”`;
          await postTweet(tweet);
        }
      } catch (err) {
        console.warn('[twitterPoster] tweet failed:', err.message);
      }
    }


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
       // conversation-driven room hop ─────────────────────────────
        const turnKey    = `${botKey}:turnsWith:${sender}`;
        const turnsSoFar = (parseInt(await redis.get(turnKey) || '0', 10) + 1);
        await redis.set(turnKey, turnsSoFar, 'EX', 600);           // 10 min TTL

        const nearby     = await client.getNearbyPlayers(200);
        const isCrowded  = nearby.length >= CROWD_THRESHOLD;
        const hopLockKey = `${botKey}:room_hopped_with:${sender}`;
        const hopLocked  = !!(await redis.get(hopLockKey));

        if (!hopLocked &&
            isCrowded &&
            turnsSoFar >= ROOM_HOP_MIN_TURNS &&
            Math.random() < ROOM_HOP_PROB) {
          await redis.set(hopLockKey, 1, 'EX', 3600);              // bloquea más hops 1 h
          await client.sendChat(`@${sender} let's move to another room and keep talking.`);
          await negotiateRoomChange(client, sender);
          return;                                                  // seguimos allá
        }
      // ──────────────────────────────────────────────────────────
      if (nearby.length > 0 && Math.random() < 0.3) {
        nearby.sort((a, b) => a.distance - b.distance);
        await client.performSocialAction({ type: 'whisper', target: nearby[0].username });
      }

      await client.sendChat(chunk);

      if (turnsSoFar === 2) {
        await client.performSocialAction({ type: 'friend', target: sender });
      }

      // ─── CONTEXT‐DRIVEN SOCIAL INTERACTIONS
      if (profile.cognitive_traits.trust > 0.7) {
        await client.performSocialAction({ type: 'friend', target: sender });
      }

      if (/\b(thank you|please)\b/i.test(text)) {
        await client.performSocialAction({ type: 'respect', target: sender });
      }

      const ignored = (await getList(coreId, 'ignored_users')) || [];
      if (ignored.find(u => u.user === sender)) {
        await client.performSocialAction({ type: 'unignore', target: sender });
        await redis.lrem(`${coreId}:ignored_users`, 0, JSON.stringify({ user: sender }));
      }

      const wantsDance = reply.toLowerCase().endsWith('[dance]');
      const sociability = profile.cognitive_traits.sociability ?? 0;
      if (wantsDance || sociability > 0.6 || Math.random() < 0.1) {
        await client.performContextAction();
      }

      await client.handleIncomingFriendRequest();

      await sleep(3000);

    }

    // ——————————————————————————————————————————————————————
    // Room-Change Negotiation Helpers
    // ——————————————————————————————————————————————————————

    /**
     * Scan “All Rooms” and return an array like:
     *   [{ name, count, handle }]
     * Runs on the main page (no frames involved).
     */
    async function scanRooms(client) {
      const page = client.page;
      console.log('[scanRooms] Opening Rooms menu…');
      await page.click('.navigation-item.icon.icon-rooms');

      // Wait for the navigator panel to appear
      await page.waitForSelector('.draggable-window .nitro-navigator',
                                { visible: true, timeout: 5000 });

      console.log('[scanRooms] Clicking All Rooms tab…');
      await page.click('.draggable-window .icon-naviallrooms');

      // Wait for the room list items
      await page.waitForSelector('.draggable-window .navigator-item',
                                { timeout: 5000 });

      // Collect all navigator-item elements
      const els = await page.$$('.draggable-window .navigator-item');
      console.log(`[scanRooms] Found ${els.length} rooms`);

      if (els.length === 0) {
        throw new Error('No rooms detected after clicking All Rooms');
      }

      // Extract room name and occupancy badge
      return Promise.all(
        els.map(async el => {
          const name  = await el.$eval('.text-truncate',
                                      n => n.textContent.trim());
          const badge = await el.$eval('.badge',
                                      b => b.textContent.trim())
                                .catch(() => '0');
          return { name,
                  count: parseInt(badge, 10) || 0,
                  handle: el };
        })
      );
    }

    /**
     * Negotiate a move: choose an empty room or use
     * the “Somewhere new” button. Retries once on error.
     */
    async function negotiateRoomChange(client, partnerName) {
      const page = client.page;

      // One full attempt wrapper
      const attempt = async () => {

        // 20 % chance to click the random “Somewhere new” button
        if (Math.random() < 0.2) {
          console.log('[negotiate] Taking “Somewhere new” branch');
          const btns = await page.$$('.nav-bottom .nav-bottom-buttons-text');
          for (const btn of btns) {
            const txt = await page.evaluate(el => el.textContent.trim(), btn);
            if (txt === 'Somewhere new') {
              await btn.click();
              return true;
            }
          }
        }

        console.log('[negotiate] Scanning rooms…');
        const rooms = await scanRooms(client);

        // Pick the first empty room
        const empty = rooms.find(r => r.count === 0);
        if (!empty) {
          console.warn('[negotiate] No empty rooms — retrying with random');
          return negotiateRoomChange(client, partnerName); // recursive retry
        }

        console.log(`[negotiate] Proposing to meet in "${empty.name}"`);
        await client.sendChat(`@${partnerName} meet me in "${empty.name}"`);

        // 🚪 Immediately enter the room
        console.log(`[negotiate] Entering "${empty.name}" now`);
        await empty.handle.click();
        await client.sendChat('Hello room! Anyone here?');
        await movement.walkPath(client.page,
                                ['down','down','right','right']);
                            
        if (partnerName) {
          await client.sendChat(`@${partnerName} I’m here, let’s continue!`);
        }

        // (Optional) poll to see if partner arrives
        for (let i = 0; i < 90; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const fresh = (await scanRooms(client))
                          .find(r => r.name === empty.name);
          if (fresh && fresh.count > 0) {
            console.log(`[negotiate] Partner joined "${empty.name}"`);
            break;
          }
        }

        return true;
      };

      // Try once; on failure retry once more
      try {
        return await attempt();
      } catch (err) {
        console.error('[negotiate] Error, retrying:', err.message);
        try {
          return await attempt();
        } catch (err2) {
          console.error('[negotiate] Second attempt failed:', err2.message);
          return false;
        }
      }
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

