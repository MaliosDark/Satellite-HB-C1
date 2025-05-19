// File: modules/chatObserver.js
// ==============================
// Polls the chat widget every 500ms, dedupes by sender+message,
// and skips any bubbles from your own bot.

const fs   = require('fs');
const path = require('path');

module.exports = function installChatObserver(page, callback, selfName) {
  // seen IDs of processed messages (sender||message)
  const seen = new Set();

  // optional: rotate the seen set every 60s to avoid unbounded growth
  setInterval(() => seen.clear(), 60_000);

  // set up logs directory
  const logDir  = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, 'chat.jsonl');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', 'utf8');

  // scrape function: run in Node context
  async function scrape() {
    try {
      const entries = await page.evaluate(() => {
        const widget = document.querySelector('.nitro-chat-widget');
        if (!widget) return [];
        return Array.from(widget.querySelectorAll('.chat-content'))
          .map(node => {
            const userEls = node.querySelectorAll('.username strong');
            if (!userEls.length) return null;
            const sender  = userEls[userEls.length - 1].textContent.trim();
            const msgEl   = node.querySelector('.message');
            if (!msgEl) return null;
            const message = msgEl.textContent.trim();
            // we don't need timestamp in ID
            return { sender, message };
          })
          .filter(x => x);
      });

      for (const { sender, message } of entries) {
        // skip own messages
        if (sender.toLowerCase() === selfName.toLowerCase()) continue;

        const id = `${sender}||${message}`;
        if (seen.has(id)) continue;
        seen.add(id);

        // notify bot
        callback(sender.toLowerCase(), message);

        // append to log
        const record = {
          timestamp: Date.now(),
          sender,
          message
        };
        fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
      }
    } catch (err) {
      console.error('[chatObserver] scrape failed:', err);
    }
  }

  // initial delay + interval
  setTimeout(scrape, 500);
  setInterval(scrape, 500);
};
