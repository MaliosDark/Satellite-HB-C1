// chatObserver.js
// ==================

const fs   = require('fs');
const path = require('path');

module.exports = function installChatObserver(page, callback) {
  const seen = new Set();

  const logDir  = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, 'chat.jsonl');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', 'utf8');

  async function scrape() {
    try {
      const entries = await page.evaluate(() => {
        const widget = document.querySelector('.nitro-chat-widget');
        if (!widget) return [];
        return Array.from(widget.querySelectorAll('.chat-content'))
          .map((node, idx) => {
            const strongs = node.querySelectorAll('.username strong');
            if (strongs.length === 0) return null;
            const userEl  = strongs[strongs.length - 1];
            const msgEl   = node.querySelector('.message');
            if (!msgEl) return null;
            const sender   = userEl.textContent.trim();
            const message  = msgEl.textContent.trim();
            const timestamp = Date.now();
            const id       = `${idx}||${sender}||${message}`;
            return { id, sender, message, timestamp };
          })
          .filter(x => x);
      });

      for (const { id, sender, message, timestamp } of entries) {
        if (seen.has(id)) continue;
        seen.add(id);

        callback(sender, message);

        const record = { sender, message, timestamp };
        fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
      }
    } catch (err) {
      console.error('[chatObserver] scrape failed:', err);
    }
  }

  setTimeout(scrape, 500);
  setInterval(scrape, 500);
};
