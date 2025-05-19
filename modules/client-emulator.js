// File: modules/client-emulator.js
// ========================
// Minimal Puppeteer client that:
// - Loads Nitro iframe URL
// - Hooks every chat line via chatObserver
// - Exposes onChat(sender, message)
// - Provides sendChat(text)

const puppeteer           = require('puppeteer-extra');
const StealthPlugin       = require('puppeteer-extra-plugin-stealth');
const installChatObserver = require('./chatObserver');

puppeteer.use(StealthPlugin());

module.exports = class HabboClient {
  constructor({ iframeUrl, username, roomId, onChat }) {
    this.url      = `${iframeUrl}&room=${roomId}`;
    this.username = username;
    this.onChat   = onChat;
    this._init();
  }

  async _init() {
    this.browser = await puppeteer.launch({ headless: false, args: ['--start-maximized'] });
    this.page    = await this.browser.newPage();

    // stealth flags
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages',   { get: () => ['en-US','en'] });
      Object.defineProperty(navigator, 'plugins',     { get: () => [1,2,3] });
    });

    await this.page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForSelector('canvas', { timeout: 60000 });

    // close any popups
    await this.page.evaluate(() => {
      document.querySelectorAll('.nitro-card-header-close').forEach(btn => btn.click());
    });

    // hook chat
    await installChatObserver(this.page, (s, msg) => this.onChat(s, msg));

    // initial greeting
    await this.sendChat(`Hello, I am ${this.username}!`);
  }

  async sendChat(text) {
    const SEL    = '.input-sizer .chat-input, .input-sizer input[type="text"]';
    const MAXLEN = 110;
    await this.page.waitForSelector(SEL, { timeout: 5000 });

    for (let i = 0; i < text.length; i += MAXLEN) {
      const chunk = text.slice(i, i + MAXLEN);
      await this.page.$eval(SEL, (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, chunk);
      await this.page.keyboard.press('Enter');
      await sleep(500);
    }
  }

  async close() {
    await this.browser.close();
  }
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
