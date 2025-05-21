// File: modules/room-movement.js
// ==============================

/** Simple sleep helper */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  /**
   * Presses one or two arrow keys briefly, with random hold time.
   * @param {import('puppeteer').Page} page
   * @param {'up'|'down'|'left'|'right'|['up'|'down','left'|'right']} dir
   */
  async move(page, dir) {
    const keyMap = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' };
    const dirs = Array.isArray(dir) ? dir : [dir];
    const keys = dirs.map(d => {
      if (!keyMap[d]) throw new Error(`Unknown direction: ${d}`);
      return keyMap[d];
    });

    // Focus the page (no canvas)
    await page.focus('body');
    const hold = 150 + Math.random() * 150;
    for (const k of keys) {
      await page.keyboard.down(k);
      await sleep(10 + Math.random() * 40);
    }
    await sleep(hold);
    for (const k of keys.slice().reverse()) {
      await page.keyboard.up(k);
      await sleep(10 + Math.random() * 40);
    }
  },

  /**
   * Walks a sequence of directions with small pauses.
   * @param page
   * @param path Array of directions
   */
  async walkPath(page, path) {
    for (const dir of path) {
      await this.move(page, dir);
      await sleep(200 + Math.random() * 200);
    }
  },

  /**
   * Walks a given number of steps in one direction.
   * @param page
   * @param dir Direction
   * @param steps Count
   */
  async walkSteps(page, dir, steps) {
    for (let i = 0; i < steps; i++) {
      await this.move(page, dir);
      await sleep(200 + Math.random() * 300);
    }
  },

  /**
   * Autonomous wander: simply call randomWander.
   * @param page
   */
  async aiWander(page) {
    // You can adjust area or moves as desired:
    await this.randomWander(page, { width: 10, height: 10 }, 5);
  },

  /**
   * Legacy random wandering fallback.
   * @param page
   * @param area {width, height}  // unused here but kept for signature
   * @param moves Number of segments
   */
  async randomWander(page, area, moves = 10) {
    const directions = ['up','down','left','right'];
    for (let i = 0; i < moves; i++) {
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const distance = 1 + Math.floor(Math.random() * 3);
      await this.walkSteps(page, dir, distance);
      await sleep(500 + Math.random() * 500);
    }
  }
};
