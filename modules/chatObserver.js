// File: modules/chatObserver.js
// ==============================
// Polls the Habbo chat widget every 500ms, deduplicates by sender+message,
// skips any bubbles from your own bot, and logs all incoming messages.

const fs   = require('fs');
const path = require('path');

module.exports = function installChatObserver(page, callback, selfName) {
  // Keep track of which messages we've already processed (sender||message)
  const seen = new Set();

  // Periodically clear the seen set every 60 seconds to prevent unbounded growth
  setInterval(() => seen.clear(), 60_000);

  // Prepare log directory and file for persisting all chat records
  const logDir  = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, 'chat.jsonl');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', 'utf8');

  // The scraping function runs in Node context, pulls chat bubbles from the page
  async function scrape() {
    try {
      const entries = await page.evaluate(() => {
        const widget = document.querySelector('.nitro-chat-widget');
        if (!widget) return [];

        // Grab **all** chat-content nodes (both public & whisper)
        return Array.from(widget.querySelectorAll('.chat-content'))
          .map(node => {
            // pick off the last <strong> in .username
            const userEls = node.querySelectorAll('.username strong');
            if (!userEls.length) return null;
            const sender = userEls[userEls.length - 1].textContent.trim();

            // either a normal message or a whisper
            const msgEl = node.querySelector('.message, .whisper-message, .whisper-text');
            if (!msgEl) return null;
            const message = msgEl.textContent.trim();

            return { sender, message };
          })
          .filter(x => x);
      });

      for (const { sender, message } of entries) {
        // Make sure both sender and message exist
        if (!sender || !message) continue;

        // Skip our own bot
        if (sender.toLowerCase() === selfName.toLowerCase()) continue;

        const id = `${sender}||${message}`;
        if (seen.has(id)) continue;
        seen.add(id);

        // Fire your handler
        callback(sender.toLowerCase(), message);

        // And log it
        const record = { timestamp: Date.now(), sender, message };
        fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
      }
    } catch (err) {
      console.error('[chatObserver] scrape failed:', err);
    }
  }

  setTimeout(scrape, 500);
  setInterval(scrape, 500);
};
