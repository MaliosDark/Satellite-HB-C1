// File: modules/client-emulator.js
// ========================
// Minimal Puppeteer client that:
// - Loads Nitro iframe URL with extended timeout and retry.
// - Hooks every chat line via chatObserver *and* UiMapper
// - Exposes onChat(sender, message)
// - Provides sendChat(text) via UiMapper (with fallback to direct input and enforced 3 s throttle)
// - Provides movement via roomMovement
// - Provides exploreAndAct()

const puppeteer           = require('puppeteer-extra');
const StealthPlugin       = require('puppeteer-extra-plugin-stealth');
const installChatObserver = require('./chatObserver');
const UiMapper            = require('./ui-mapper');
const roomMovement        = require('./room-movement');

puppeteer.use(StealthPlugin());

/** Simple sleep helper */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = class HabboClient {
  constructor({ iframeUrl, username, roomId, onChat }) {
    this.url         = `${iframeUrl}&room=${roomId}`;
    this.username    = username;
    this.onChat      = onChat;
    this._lastSentAt = 0;       // timestamp of last sendChat
    this._init();
  }

  async _init() {
    this.browser = await puppeteer.launch({
      headless: false,
      args: ['--start-maximized']
    });
    this.page = await this.browser.newPage();

    // stealth flags
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3] });
    });

    // navegación con timeout extendido y reintento
    try {
      await this.page.goto(this.url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.page.waitForSelector('.nitro-chat-widget', { timeout: 60000 });
    } catch (err) {
      console.warn('[INIT] First navigation failed, retrying:', err.message);
      await this.page.goto(this.url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.page.waitForSelector('.nitro-chat-widget', { timeout: 60000 });
    }

    // install UI mapping
    await UiMapper.install(this.page, undefined, (sender, msg) => this.onChat(sender, msg));

    // coordinate overlay (dev)
    await this.page.evaluate(() => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0',
        padding: '4px 8px', background: 'rgba(0,0,0,0.6)',
        color: '#0f0', fontSize: '12px', zIndex: '10000',
        pointerEvents: 'none'
      });
      document.body.appendChild(overlay);
      document.addEventListener('mousemove', e => {
        overlay.textContent = `x: ${e.clientX}, y: ${e.clientY}`;
      });
    });

    await this.page.addStyleTag({
      content: `
        /* Deshabilita todos los clics en el ícono "habbo" */
        .navigation-item.icon.icon-habbo {
          pointer-events: none !important;
          opacity: 0.5;
        }
      `
    });

    // close initial popup if present
    try {
      const btn = await this.page.$('div.nitro-card-header-close');
      if (btn) {
        await btn.click();
        await sleep(500);
        console.log('[POPUP] closed via selector');
      }
    } catch (e) {
      console.warn('[POPUP] unable to close:', e.message);
    }

    // minimize the room tool panel so it never steals focus
    try {
      await this.page.waitForSelector('.btn-toggle.toggle-roomtool', { timeout: 5000 });
      await this.page.click('.btn-toggle.toggle-roomtool');
      console.log('[INIT] Room tool panel minimized');
    } catch (e) {
      console.warn('[INIT] Could not find or click the room-tool toggle:', e.message);
    }

    // helper to open self menu, click one of [Dance, Actions, Signs], then close it
    this.performContextAction = async () => {
      // 1) click your own avatar to open the context menu
      await this.page.evaluate(username => {
        const avatars = Array.from(document.querySelectorAll('.user-avatar'));
        const mine = avatars.find(a => a.getAttribute('data-username') === username);
        if (mine) mine.click();
      }, this.username);

      // 2) wait for the menu
      await this.page.waitForSelector('.nitro-context-menu.visible', { timeout: 5000 });

      // 3) pick from allowed items
      const choice = await this.page.evaluate(() => {
        const allowed = ['Dance', 'Actions', 'Signs'];
        const items = Array.from(document.querySelectorAll('.nitro-context-menu .menu-item'));
        const candidates = items.filter(i =>
          allowed.some(label => i.textContent.trim().startsWith(label))
        );
        if (candidates.length === 0) return null;
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        pick.click();
        return pick.textContent.trim();
      });

      if (choice) {
        console.log(`[MENU] performed context action: ${choice}`);
      }

      // 4) click outside the menu to close it
      await this.page.mouse.click(10, 10); // adjust coords if needed
      await sleep(200);
    };

    // original observer
    await installChatObserver(this.page, (s,m)=>this.onChat(s,m), this.username);

    // movement
    this.moveUp    = () => roomMovement.move(this.page, 'up');
    this.moveDown  = () => roomMovement.move(this.page, 'down');
    this.moveLeft  = () => roomMovement.move(this.page, 'left');
    this.moveRight = () => roomMovement.move(this.page, 'right');
    this.walkPath  = path => roomMovement.walkPath(this.page, path);

    // explore & act
    this.exploreAndAct = async () => {
      await this.walkPath(['down','down','down','down']);
      const target = await this.page.evaluate(() => {
        const el = document.querySelector('.item, .seat');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left+r.width/2, y: r.top+r.height/2 };
      });
      if (target) {
        await this.page.mouse.click(target.x, target.y);
        console.log('[ACTION] clicked item');
      }
    };

    // initial greeting
    try {
      await this.sendChat(`Hello, I am ${this.username}!`);
    } catch {}
  }

  /**
   * Sends chat in chunks ≤100 chars, with at least 3 s between each send.
   */
  async sendChat(text) {
    const now   = Date.now();
    const since = now - this._lastSentAt;
    if (since < 3000) {
      await sleep(3000 - since);
    }
  
    const MAX = 100;
    const chunks = [];
    if (text.length <= MAX) {
      chunks.push(text);
    } else {
      const words = text.split(' ');
      let chunk = '';
      for (const w of words) {
        const candidate = chunk ? `${chunk} ${w}` : w;
        if (candidate.length > MAX) {
          chunks.push(chunk);
          chunk = w;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) chunks.push(chunk);
    }
  
    for (const chunk of chunks) {
      try {
        await UiMapper.sendChat(this.page, chunk);
      } catch {
        await this.page.focus('input.chat-input');
        await this.page.keyboard.type(chunk);
        await this.page.keyboard.press('Enter');
      }
      await sleep(3000);
    }
  
    this._lastSentAt = Date.now();
  }
};
