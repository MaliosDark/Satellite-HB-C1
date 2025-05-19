// File: modules/room-movement.js
// ==============================
// Simple walker: simulates arrow‐key presses for avatar movement
// —keystrokes are sent at the page level, never focusing the chat input.

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  
  module.exports = {
    /**
     * Presses one arrow key briefly.
     * @param {import('puppeteer').Page} page
     * @param {'up'|'down'|'left'|'right'} dir
     */
    async move(page, dir) {
      const keyMap = {
        up:    'ArrowUp',
        down:  'ArrowDown',
        left:  'ArrowLeft',
        right: 'ArrowRight'
      };
      const key = keyMap[dir];
      if (!key) throw new Error(`Unknown direction: ${dir}`);
      // ensure focus is the game canvas
      await page.focus('canvas');
      await page.keyboard.down(key);
      await sleep(200);
      await page.keyboard.up(key);
    },
  
    /**
     * Walks a sequence of directions.
     * @param {import('puppeteer').Page} page
     * @param {Array<'up'|'down'|'left'|'right'>} path
     */
    async walkPath(page, path) {
      for (const dir of path) {
        await this.move(page, dir);
        await sleep(300);
      }
    }
};
  