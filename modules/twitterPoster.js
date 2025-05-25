// File: twitterPoster.js
// ======================
// Bootstraps agent-twitter-client, keeps cookies, and lets you tweet.
//
// Required ENV ─────────────────────────────────────────────────────
//   TWITTER_USERNAME          – account @handle
//   TWITTER_PASSWORD          – account password
//   TWITTER_EMAIL             – (only needed if Twitter asks)
//   # Optional API-v2 creds (polls, media > 4 MB, etc.)
//   TWITTER_API_KEY
//   TWITTER_API_SECRET_KEY
//   TWITTER_ACCESS_TOKEN
//   TWITTER_ACCESS_TOKEN_SECRET
//
// Nice-to-have ENV ────────────────────────────────────────────────
//   PROXY_URL                 – if you need a proxy
//   STARTUP_TWEET             – text to tweet as soon as the module loads
//   TWITTER_COOKIE_FILE       – path for cached cookies (default ./.twitter-cookies.json)
//
// Dependencies: agent-twitter-client (installed on-demand)

const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');

const {
  TWITTER_USERNAME,
  TWITTER_PASSWORD,
  TWITTER_EMAIL,
  TWITTER_API_KEY,
  TWITTER_API_SECRET_KEY,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
  PROXY_URL,
  STARTUP_TWEET,
  TWITTER_COOKIE_FILE = path.join(__dirname, '.twitter-cookies.json')
} = process.env;

// ── early-exit switch ───────────────────────────
if (process.env.TWITTER_DISABLE === 'true') {
    console.log('[twitterPoster] disabled via TWITTER_DISABLE=true');
    module.exports = {
      postTweet : () => false,
      getScraper: () => null
    };
    return;             
  }
  // ────────────────────────────────────────────────
  

// ──────────────────────────────────────────────────────────────
// 1) Ensure agent-twitter-client is available
// ──────────────────────────────────────────────────────────────
let Scraper;
function ensureClientInstalled() {
  try {
    // ≥v2 exports { Scraper } – fall back to default export otherwise
    Scraper = require('agent-twitter-client').Scraper || require('agent-twitter-client');
  } catch (err) {
    console.log('[twitterPoster] agent-twitter-client not found – installing…');
    execSync('npm install agent-twitter-client@latest --no-save', { stdio: 'inherit' });
    Scraper = require('agent-twitter-client').Scraper || require('agent-twitter-client');
  }
}
ensureClientInstalled();

// tiny sleep helper
const wait = ms => new Promise(r => setTimeout(r, ms));

// ──────────────────────────────────────────────────────────────
// 2) Singleton login routine
// ──────────────────────────────────────────────────────────────
let _scraperPromise;            // ensures we only login once
const MAX_RETRIES = 4;

async function initialiseScraper(retries = 0) {
  if (_scraperPromise) return _scraperPromise;      // already running / done

  _scraperPromise = (async () => {
    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
      throw new Error('TWITTER_USERNAME and TWITTER_PASSWORD must be set');
    }

    const scraper = new Scraper({ proxy: PROXY_URL });

    // A) try cookie-based login first
    if (fs.existsSync(TWITTER_COOKIE_FILE)) {
        try {
        const raw = JSON.parse(fs.readFileSync(TWITTER_COOKIE_FILE, 'utf8'));
    
        // 🛠  normalise: legacy { key, value }  →  { name, value }
        const cookies = raw.map(c => {
            if (c.name) return c;                           
            if (c.key) {
            return {
                name:     c.key,
                value:    c.value,
                domain:   c.domain || '.twitter.com',
                path:     c.path   || '/',
                secure:   !!c.secure,
                httpOnly: !!c.httpOnly,
                expires:  c.expires
                ? Math.floor(new Date(c.expires).getTime() / 1000) // seconds
                : undefined
            };
            }
            throw new Error('Unrecognised cookie format');
        });
    
        await scraper.setCookies(cookies);
        if (await scraper.isLoggedIn()) {
            console.log('[twitterPoster] Logged in via cached cookies');
            fs.writeFileSync(
                TWITTER_COOKIE_FILE,
                JSON.stringify(await scraper.getCookies(), null, 2),
                'utf8'
              );
            return scraper;
        }
        console.log('[twitterPoster] Cached cookies expired – doing full login');
        } catch (err) {
        console.warn('[twitterPoster] Failed reading cookies:', err.message);
        }
    }
    

    // B) full credential login ➜ cache cookies
    console.log('[twitterPoster] Performing password login…');
    await scraper.login(
      TWITTER_USERNAME,
      TWITTER_PASSWORD,
      TWITTER_EMAIL,                 // may be undefined
      TWITTER_API_KEY,
      TWITTER_API_SECRET_KEY,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_TOKEN_SECRET
    );                                         // README usage 

    const cookies = await scraper.getCookies();
    fs.writeFileSync(TWITTER_COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf8');
    console.log('[twitterPoster] Login successful – cookies cached ✔');
    return scraper;
  })().catch(async err => {
    if (retries >= MAX_RETRIES) throw err;
    const delay = 2 ** retries * 1_000;
    console.warn(`[twitterPoster] Login failed (${err.message}) – retrying in ${delay} ms`);
    await wait(delay);
    _scraperPromise = null;                    // allow fresh attempt
    return initialiseScraper(retries + 1);
  });

  return _scraperPromise;
}

// ──────────────────────────────────────────────────────────────
// 3) Public helper – post a tweet (optionally with media)
//    mediaFiles = array of absolute/relative file paths
// ──────────────────────────────────────────────────────────────
async function postTweet(text, mediaFiles = []) {
  if (!text || !text.trim()) {
    throw new Error('postTweet(text) – text cannot be empty');
  }
  const scraper = await initialiseScraper();
  const mediaData = [];

  if (mediaFiles.length) {
    for (const file of mediaFiles) {
      const absPath = path.resolve(file);
      const data     = fs.readFileSync(absPath);
      const ext      = path.extname(absPath).toLowerCase();
      const mimeMap  = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.mp4':'video/mp4' };
      if (!mimeMap[ext]) throw new Error(`Unsupported media type: ${ext}`);
      mediaData.push({ data, mediaType: mimeMap[ext] });
    }
  }

  let tries = 0;
  while (true) {
    try {
      console.log(`[twitterPoster] → tweeting: “${text.slice(0,60)}${text.length>60?'…':''}”`);
      if (mediaData.length) {
        await scraper.sendTweet(text, undefined, mediaData);       // README example 
      } else {
        await scraper.sendTweet(text);
      }
      console.log('[twitterPoster] Tweet sent ✅');
      return true;
    } catch (err) {
      if (++tries > MAX_RETRIES) throw err;
      const delay = 2 ** tries * 1_000;
      console.warn(`[twitterPoster] sendTweet failed (${err.message}) – retry ${tries}/${MAX_RETRIES} in ${delay} ms`);
      await wait(delay);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 4) Auto-tweet at startup (if env var present)
// ──────────────────────────────────────────────────────────────
(async () => {
  try {
    await initialiseScraper();
    if (STARTUP_TWEET) await postTweet(STARTUP_TWEET);
  } catch (err) {
    console.error('[twitterPoster] Fatal error:', err);
  }
})();

// ──────────────────────────────────────────────────────────────
// 5) Export helpers
// ──────────────────────────────────────────────────────────────
module.exports = {
  postTweet,
  getScraper: () => initialiseScraper()
};
