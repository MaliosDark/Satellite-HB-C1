// File: modules/room-movement.js
// ==============================
//
// Robust autonomous movement for PAi-OS agents.
// - Always moves (no external AI dependency).
// - Avoids moving “up” to prevent re-entering the door/hotel view.
// - Uses CDP dispatchKeyEvent to avoid stealing OS focus.
// - Retries each key press up to 3× before moving on.
// - Exposes startAutoWander() to kick off perpetual wandering.

const DEFAULT_AREA    = { width: 20, height: 20 };
const MIN_STEPS       = 1;
const MAX_STEPS       = 3;
const MIN_MOVE_PAUSE  = 300;
const MAX_MOVE_PAUSE  = 700;
const RETRY_COUNT     = 3;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Dispatch a key via CDP so we never grab OS focus
async function dispatchKey(page, type, code) {
  const vkMap = { ArrowUp:0x26, ArrowDown:0x28, ArrowLeft:0x25, ArrowRight:0x27 };
  const client = await page.target().createCDPSession();
  await client.send('Input.dispatchKeyEvent', {
    type,
    code,
    windowsVirtualKeyCode: vkMap[code],
    nativeVirtualKeyCode:  vkMap[code],
    autoRepeat: false
  });
}

const keyMap = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' };

/**
 * Presses one or more directions, retrying if necessary.
 */
async function move(page, dir) {
  const dirs = Array.isArray(dir) ? dir : [dir];
  for (const d of dirs) {
    const code = keyMap[d];
    if (!code) continue;
    let pressed = false;
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
      try {
        await dispatchKey(page, 'keyDown', code);
        await sleep(150 + Math.random() * 150);
        await dispatchKey(page, 'keyUp', code);
        pressed = true;
        break;
      } catch {
        await sleep(100 + Math.random() * 200);
      }
    }
  }
}

/**
 * Walks a given path of directions with small pauses.
 */
async function walkPath(page, path) {
  for (const dir of path) {
    await move(page, dir);
    await sleep(200 + Math.random() * 300);
  }
}

/**
 * Randomly wanders but never “up” (towards the door).
 */
async function randomWander(page, area = DEFAULT_AREA, moves = 8) {
  // avoid 'up' to stay away from door
  const directions = ['down','left','right'];
  for (let i = 0; i < moves; i++) {
    const dir   = directions[Math.floor(Math.random() * directions.length)];
    const steps = MIN_STEPS + Math.floor(Math.random() * (MAX_STEPS - MIN_STEPS + 1));
    for (let s = 0; s < steps; s++) {
      await move(page, dir);
      await sleep(200 + Math.random() * 300);
    }
    await sleep(MIN_MOVE_PAUSE + Math.random() * (MAX_MOVE_PAUSE - MIN_MOVE_PAUSE));
  }
}

/**
 * Starts a perpetual wander loop in the background.
 */
function startAutoWander(getPage) {
  (async function loop() {
    let page;
    while (!(page = getPage())) {
      await sleep(100);
    }
    while (true) {
      try {
        await randomWander(page);
      } catch (err) {
        console.error('[room-movement] randomWander error:', err);
      }
      await sleep(1000 + Math.random() * 2000);
    }
  })();
}

module.exports = {
  move,
  walkPath,
  randomWander,
  startAutoWander
};
