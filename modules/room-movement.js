// File: modules/room-movement.js
// ==============================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  /**
   * Presses one or two arrow keys briefly, with random hold time.
   * @param {import('puppeteer').Page} page
   * @param {'up'|'down'|'left'|'right'|['up'|'down','left'|'right']} dir
   */
  async move(page, dir) {
    const keyMap = {
      up:    'ArrowUp',
      down:  'ArrowDown',
      left:  'ArrowLeft',
      right: 'ArrowRight'
    };
    // acepta diagonales como ['up','left']
    const dirs = Array.isArray(dir) ? dir : [dir];
    const keys = dirs.map(d => {
      if (!keyMap[d]) throw new Error(`Unknown direction: ${d}`);
      return keyMap[d];
    });

    // enfoca canvas
    await page.focus('canvas');

    // aleatorio: cuánto tiempo mantengo pulsada cada tecla (150-300 ms)
    const holdTime = 150 + Math.random() * 150;

    // presiono todas las teclas simultáneas
    for (const key of keys) {
      await page.keyboard.down(key);
      // pequeña separación para naturalidad
      await sleep(10 + Math.random() * 40);
    }

    await sleep(holdTime);

    // suelto en orden inverso
    for (const key of keys.slice().reverse()) {
      await page.keyboard.up(key);
      await sleep(10 + Math.random() * 40);
    }
  },

  /**
   * Walks a sequence of directions, con pausas aleatorias entre cada paso.
   * @param {import('puppeteer').Page} page
   * @param {Array<'up'|'down'|'left'|'right'|['up'|'down','left'|'right']>} path
   */
  async walkPath(page, path) {
    for (const dir of path) {
      await this.move(page, dir);
      // pausa aleatoria entre pasos (200-400 ms)
      const pause = 200 + Math.random() * 200;
      await sleep(pause);
    }
  },

  /**
   * Camina en una dirección durante X pasos aproximados.
   * @param {import('puppeteer').Page} page
   * @param {'up'|'down'|'left'|'right'} dir
   * @param {number} steps
   */
  async walkSteps(page, dir, steps) {
    for (let i = 0; i < steps; i++) {
      await this.move(page, dir);
      await sleep(200 + Math.random() * 300);
    }
  },

  /**
   * Camina en un patrón aleatorio dentro de un rectángulo definido.
   * @param {import('puppeteer').Page} page
   * @param {{width: number, height: number}} area 
   * @param {number} moves número de movimientos aleatorios
   */
  async randomWander(page, area, moves = 10) {
    const directions = ['up','down','left','right'];
    for (let i = 0; i < moves; i++) {
      // elige dirección al azar
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const distance = 1 + Math.floor(Math.random() * 3); // 1-3 pasos
      await this.walkSteps(page, dir, distance);
      // pausa un poco más larga al cambiar de dirección
      await sleep(500 + Math.random() * 500);
    }
  }
};
