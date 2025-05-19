// File: modules/ui-mapper.js
// ==========================
// Installs a click‐listener on the page to record UI coordinates into ui-mapping.json
// Also detects new chat bubbles and calls back into your onChat handler.
// Provides helpers to replay clicks based on those recorded mappings and send chat.

const fs   = require('fs');
const path = require('path');
const DEFAULT_FILE = path.join(__dirname, '..', 'ui-mapping.json');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// logical actions → identifying CSS class
const actions = {
  closePopup: 'nitro-card-header-close',
  focusChat:  'chat-input'
};

module.exports = {
  /**
   * @param {import('puppeteer').Page} page
   * @param {string} [outputFile=DEFAULT_FILE]
   * @param {(sender:string, msg:string)=>void} [chatHandler]
   */
  async install(page, outputFile = DEFAULT_FILE, chatHandler) {
    // ensure mapping file exists
    if (!fs.existsSync(outputFile)) {
      fs.writeFileSync(outputFile, '[]', 'utf8');
    }

    // recorder for clicks
    await page.exposeFunction('recordUiMapping', data => {
      const arr = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      arr.push(data);
      fs.writeFileSync(outputFile, JSON.stringify(arr, null, 2), 'utf8');
      console.log('[UI MAPPER] Saved:', data);
    });

    // optional recorder for chat bubbles
    if (chatHandler) {
      await page.exposeFunction('notifyChatBubble', ({ sender, message }) => {
        chatHandler(sender.toLowerCase(), message);
      });
    }

    // inject page‐side logic
    await page.evaluate((hasChatHandler, actionClasses) => {
      // click logger
      document.addEventListener('click', e => {
        const el   = e.target;
        const rect = el.getBoundingClientRect();
        window.recordUiMapping({
          timestamp: Date.now(),
          x:         e.clientX,
          y:         e.clientY,
          tag:       el.tagName.toLowerCase(),
          classes:   Array.from(el.classList),
          bbox:      { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        });
      }, true);

      // chat‐bubble observer
      if (hasChatHandler) {
        const container = document.querySelector('.nitro-chat-widget');
        if (container) {
          const mo = new MutationObserver(muts => {
            muts.forEach(m => {
              m.addedNodes.forEach(n => {
                if (n.nodeType===1 && n.matches('.chat-content')) {
                  const userEls = n.querySelectorAll('.username strong');
                  if (!userEls.length) return;
                  const sender = userEls[userEls.length-1].textContent.trim();
                  const msgEl = n.querySelector('.message');
                  if (!msgEl) return;
                  const message = msgEl.textContent.trim();
                  window.notifyChatBubble({ sender, message });
                }
              });
            });
          });
          mo.observe(container, { childList: true });
        }
      }
    }, Boolean(chatHandler), actions);

    console.log('[UI MAPPER] Click logger installed');
    if (chatHandler) console.log('[UI MAPPER] Chat‐bubble detector installed');
  },

  loadMappings(file = DEFAULT_FILE) {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  },

  findByClass(className, file = DEFAULT_FILE) {
    return this.loadMappings(file).find(entry =>
      entry.classes.includes(className)
    );
  },

  async click(page, className) {
    const entry = this.findByClass(className);
    if (!entry) throw new Error(`No UI mapping for class "${className}"`);
    await page.mouse.click(entry.x, entry.y);
    await sleep(300);
  },

  async closePopup(page) {
    await this.click(page, actions.closePopup);
    await sleep(500);
  },

  async focusChat(page) {
    await this.click(page, actions.focusChat);
    await sleep(200);
  },

  /**
   * Send text ≤110 chars per chunk, then Enter
   * @param {import('puppeteer').Page} page
   * @param {string} text
   */
  async sendChat(page, text) {
    await this.focusChat(page);
    const MAX = 110;
    for (let i = 0; i < text.length; i += MAX) {
      await page.keyboard.type(text.slice(i, i + MAX));
      await sleep(50);
    }
    await page.keyboard.press('Enter');
    await sleep(200);
  },

  register(actionName, className) {
    actions[actionName] = className;
  }
};
