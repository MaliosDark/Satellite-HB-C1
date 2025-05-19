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
      // Evaluate in page context to extract all visible chat messages
      const entries = await page.evaluate(() => {
        const widget = document.querySelector('.nitro-chat-widget');
        if (!widget) return [];
        return Array.from(widget.querySelectorAll('.chat-content'))
          .map(node => {
            // Username is the last <strong> inside .username
            const userEls = node.querySelectorAll('.username strong');
            if (!userEls.length) return null;
            const sender  = userEls[userEls.length - 1].textContent.trim();
            const msgEl   = node.querySelector('.message');
            if (!msgEl) return null;
            const message = msgEl.textContent.trim();
            return { sender, message };
          })
          .filter(x => x);
      });

      // Process each chat entry
      for (const { sender, message } of entries) {
        // Skip messages from ourselves
        if (sender.toLowerCase() === selfName.toLowerCase()) continue;

        // Build a simple ID to dedupe identical bubbles
        const id = `${sender}||${message}`;
        if (seen.has(id)) continue;
        seen.add(id);

        // Notify the bot handler in your code
        callback(sender.toLowerCase(), message);

        // Log every message to disk for auditing or debugging
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

  // Schedule the first scrape after 500ms, then repeat every 500ms
  setTimeout(scrape, 500);
  setInterval(scrape, 500);
};
