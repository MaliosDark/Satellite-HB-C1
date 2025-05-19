// File: modules/client-emulator.js
// ========================
// Minimal Puppeteer client that:
// - Loads Nitro iframe URL
// - Hooks every chat line via chatObserver *and* UiMapper
// - Exposes onChat(sender, message)
// - Provides sendChat(text) via UiMapper
// - Provides movement via roomMovement
// - Provides exploreAndAct()

const puppeteer           = require('puppeteer-extra');
const StealthPlugin       = require('puppeteer-extra-plugin-stealth');
const installChatObserver = require('./chatObserver');
const UiMapper            = require('./ui-mapper');
const roomMovement        = require('./room-movement');

puppeteer.use(StealthPlugin());

module.exports = class HabboClient {
  constructor({ iframeUrl, username, roomId, onChat }) {
    this.url      = `${iframeUrl}&room=${roomId}`;
    this.username = username;
    this.onChat   = onChat;
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
      Object.defineProperty(navigator, 'languages',   { get: () => ['en-US','en'] });
      Object.defineProperty(navigator, 'plugins',     { get: () => [1,2,3] });
    });

    await this.page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('canvas', { timeout: 60000 });

    // install UI mapping (with chat‐bubble detection)
    await UiMapper.install(this.page, undefined, (sender, msg) => this.onChat(sender, msg));

    // coordinate overlay for dev
    await this.page.evaluate(() => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.6)',
        color: '#0f0',
        fontSize: '12px',
        zIndex: '10000',
        pointerEvents: 'none'
      });
      document.body.appendChild(overlay);
      document.addEventListener('mousemove', e => {
        overlay.textContent = `x: ${e.clientX}, y: ${e.clientY}`;
      });
      document.addEventListener('click', e => {
        // console.log(`[UI MAP] click at (${e.clientX}, ${e.clientY}) on:`, e.target);
      }, true);
    });

    // close any initial popups
    await UiMapper.closePopup(this.page);

    // still hook original observer (optional)
    await installChatObserver(this.page, (sender, msg) => this.onChat(sender, msg), this.username);

    // movement helpers
    this.moveUp    = () => roomMovement.move(this.page, 'up');
    this.moveDown  = () => roomMovement.move(this.page, 'down');
    this.moveLeft  = () => roomMovement.move(this.page, 'left');
    this.moveRight = () => roomMovement.move(this.page, 'right');
    this.walkPath  = path => roomMovement.walkPath(this.page, path);

    // high-level explore & act sequence
    this.exploreAndAct = async () => {
      await this.walkPath(['down','down','down','down']);
      const target = await this.page.evaluate(() => {
        const item = document.querySelector('.item, .seat');
        if (!item) return null;
        const r = item.getBoundingClientRect();
        return { x: r.left + r.width/2, y: r.top + r.height/2 };
      });
      if (target) {
        await this.page.mouse.click(target.x, target.y);
        console.log('[ACTION] clicked on detected element at', target);
      } else {
        console.log('[ACTION] no item/seat found at current location');
      }
    };

    // initial greeting
    await UiMapper.sendChat(this.page, `Hello, I am ${this.username}!`);
  }

  async sendChat(text) {
    await UiMapper.sendChat(this.page, text);
  }

  async close() {
    await this.browser.close();
  }
};
