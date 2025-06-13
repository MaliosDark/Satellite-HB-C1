// File: scripts/initialize‐multiple.js

const childProcess = require('child_process');
const path = require('path');

//
// Define an array of objects, each with a bot’s core ID and its SPL‐mint address.
// Add as many bots as you need.
//
const botsToInitialize = [
  { coreId: 'nova', mint: 'H3P1qXoCj5f9sKxPz2Tm9vGtVJdYhY1Cn2K5bYwJZQwF' },
  { coreId: 'solbot', mint: 'D2Lm9YhRj6p7XJg8kVb1fWcUzE1rYtPy5aM3nTqK3hBh' },
  // … add additional { coreId, mint } pairs here …
];

(async () => {
  for (const { coreId, mint } of botsToInitialize) {
    console.log(`\n=== Initializing for BOT_CORE_ID=${coreId} / MINT=${mint} ===`);
    await new Promise((resolve, reject) => {
      // Construct the command to run `initialize.js`
      const initScriptPath = path.join(__dirname, '..', 'modules', 'trade', 'initialize.js');
      const cmd = `node ${initScriptPath} ${coreId} ${mint}`;

      const child = childProcess.exec(cmd, (err, stdout, stderr) => {
        process.stdout.write(stdout);
        process.stderr.write(stderr);
        if (err) {
          console.error(`❌ Initialization failed for ${coreId} / ${mint}`);
          return reject(err);
        }
        resolve();
      });
    });
  }
  console.log('\nAll bots have been initialized.\n');
  process.exit(0);
})().catch(err => {
  console.error('Fatal error in initialize-multiple:', err);
  process.exit(1);
});
