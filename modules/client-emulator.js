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

    // performContextAction: click Dance|Actions|Signs then close menu
    // … inside client‐emulator.js …

    // inside modules/client-emulator.js, replace performContextAction with:

    // in modules/client-emulator.js, inside _init():
    // Replace your existing performContextAction with this:

    // inside HabboClient, replace performContextAction with this:
    // inside HabboClient, overwrite performContextAction with:
    // in modules/client-emulator.js, replace performContextAction with:
    // inside modules/client-emulator.js, in your _init() after defining exploreAndAct:
    // inside your HabboClient._init(), replace performContextAction with:

    this.performContextAction = async () => {
      const FRAME_URL = 'react/index';
      const MENU_SEL  = '.position-absolute.nitro-context-menu.visible';
      const AVATAR_SEL = `[data-username="${this.username}"]`;
      const PRIMARY   = ['Dance', 'Actions', 'Signs'];
      const DANCE_STYLES = ['Pogo Mogo', 'Duck Funk', 'The Rollie'];
      const BACK_LABEL   = 'Back';
    
      // click in the center of an element handle
      async function clickCenter(handle) {
        const box = await handle.boundingBox();
        if (!box) return false;
        await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
        return true;
      }
    
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // 1️⃣ find the Nitro iframe
          const nitroFrame = this.page.frames().find(f => f.url().includes(FRAME_URL));
          if (!nitroFrame) throw new Error('Nitro iframe not found');
    
          console.log(`[MENU][${attempt}] opening main context menu…`);
    
          // 2️⃣ open main menu (avatar or last bubble)
          if (await nitroFrame.$(AVATAR_SEL)) {
            await nitroFrame.click(AVATAR_SEL);
          } else {
            const bubbles = await nitroFrame.$$(`.bubble-container.visible .username strong`);
            if (!bubbles.length) throw new Error('No bubble found');
            await nitroFrame.evaluate(el => el.closest('.bubble-container.visible').click(), bubbles.pop());
          }
    
          // 3️⃣ wait for main menu
          const mainMenu = await nitroFrame.waitForSelector(MENU_SEL, { timeout: 3000 });
    
          // 4️⃣ click the “Dance” item
          {
            const danceIcon = await mainMenu.$(`.menu-item i.icon-dance`);
            if (!danceIcon) throw new Error('Main “Dance” not found');
            console.log('[MENU] clicking Dance…');
            if (!await clickCenter.call(this, danceIcon)) throw new Error('Dance icon click failed');
          }
    
          // 5️⃣ now wait for the **dance-style submenu**
          console.log('[MENU] waiting for style submenu…');
          const styleMenu = await nitroFrame.waitForSelector(MENU_SEL, { timeout: 3000 });
    
          // 6️⃣ choose a style at random (not “Back”)
          const styleHandles = await styleMenu.$$('.menu-item');
          const styles = [];
          let backHandle = null;
          for (let h of styleHandles) {
            const txt = (await (await h.getProperty('textContent')).jsonValue()).trim();
            if (DANCE_STYLES.includes(txt)) {
              styles.push({ handle: h, label: txt });
            } else if (txt === BACK_LABEL) {
              backHandle = h;
            }
          }
          if (!styles.length) throw new Error('No dance styles found');
    
          // pick one at random
          const choice = styles[Math.floor(Math.random() * styles.length)];
          console.log(`[MENU] clicking style “${choice.label}”`);
          if (!await clickCenter.call(this, choice.handle)) {
            throw new Error(`Style click failed: ${choice.label}`);
          }
    
          // 7️⃣ final cleanup: click outside to close any leftover menu
          await this.page.mouse.click(5, 5);
          await sleep(150);
          console.log(`[MENU] dance style "${choice.label}" performed!`);
          return;
        }
        catch (err) {
          console.warn(`[MENU][${attempt}] failed: ${err.message}`);
          // click outside to reset
          await this.page.mouse.click(5, 5).catch(()=>{});
          await sleep(300);
        }
      }
    
      console.error('[MENU] performContextAction giving up after 3 tries');
    };

    // inside your HabboClient._init(), replacing the old performSocialAction:

    this.performSocialAction = async ({ type, target }) => {
      const FRAME_URL  = 'react/index';
      const MENU_SEL   = '.position-absolute.nitro-context-menu.visible';
      const OPTIONS    = {
        friend:   'Ask to be a Friend',
        trade:    'Trade',
        whisper:  'Whisper',
        respect:  'Give respect',
        ignore:   'Ignore',
        unignore: 'Listen'
      };
      const label     = OPTIONS[type];
      if (!label) {
        console.warn(`[SOCIAL] unknown action type: ${type}`);
        return false;
      }

      // helper: click at the center of any element handle
      async function clickCenter(handle) {
        const box = await handle.boundingBox();
        if (!box) return false;
        await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
        return true;
      }

      // 1️⃣ find Nitro iframe
      const nitroFrame = this.page.frames().find(f => f.url().includes(FRAME_URL));
      if (!nitroFrame) throw new Error('Nitro iframe not found');

      // 2️⃣ open the context menu on the target user
      const sel = `[data-username="${target}"]`;
      if (await nitroFrame.$(sel)) {
        await nitroFrame.click(sel);
      } else {
        // fallback: click their last bubble
        const bubbles = await nitroFrame.$$(`.bubble-container.visible .username strong`);
        const match = bubbles.reverse().find(async s => {
          const txt = (await (await s.getProperty('textContent')).jsonValue()).trim();
          return txt === target;
        });
        if (!match) throw new Error(`No bubble found for ${target}`);
        await nitroFrame.evaluate(el => el.closest('.bubble-container.visible').click(), match);
      }

      // 3️⃣ wait for the menu
      const menu = await nitroFrame.waitForSelector(MENU_SEL, { timeout: 3000 });

      // 4️⃣ scan items for our label, click it via mouse
      const items = await menu.$$('.menu-item');
      for (const item of items) {
        const txt = (await (await item.getProperty('textContent')).jsonValue()).trim();
        if (txt.startsWith(label)) {
          if (await clickCenter.call(this, item)) {
            console.log(`[SOCIAL] ${type}@${target} performed (“${label}”)`);
            // cleanup
            await this.page.mouse.click(5, 5);
            return true;
          }
        }
      }

      console.warn(`[SOCIAL] could not perform ${type} on ${target}`);
      // 5️⃣ cleanup
      await this.page.mouse.click(5, 5);
      return false;
    };
    
    this.handleIncomingFriendRequest = async () => {
      // pop-up selector
      const POPUP_SEL   = '.accept-friend-btn';
      const POPUP_BOX   = '.headerfriend-close, .accept-friend-btn, .reject-friend-btn';

      try {
        // wait briefly for the request dialog
        const acceptBtn = await this.page.waitForSelector(POPUP_SEL, { timeout: 2000 });
        // click “Accept”
        await acceptBtn.click();
        console.log('[FRIEND] request accepted');
      } catch {
        // none appeared
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
