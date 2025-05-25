#!/usr/bin/env node
// scripts/show-evolution.js  —  tolerant version
// ▸ Usage: node scripts/show-evolution.js [coreId] [N=10]

const chalkMod = require('chalk');
const chalk = chalkMod.default || chalkMod;
const { redis } = require('../db/agent_storage');

let [coreId, N = 10] = process.argv.slice(2);
N = parseInt(N, 10) || 10;

const pad = (s, w) => s.toString().padEnd(w);
const bar = (v, w = 24, col = 'cyan') =>
  chalk[col]('█'.repeat(Math.round(Math.max(0, Math.min(1, v)) * w)))
  + chalk.dim('░'.repeat(w - Math.round(Math.max(0, Math.min(1, v)) * w)));

const banner = txt => console.log(chalk.bold.green(`\n╔═ ${txt} ═════════════════════════════════════════╗\n`));
const end    = ()   => console.log(chalk.bold.green('╚════════════════════════════════════════════════════════════╝\n'));

(async () => {
  let ids = coreId ? [coreId] :
            [...new Set((await redis.keys('*:evolution_log')).map(k => k.split(':')[0]))].sort();

  if (!ids.length) { console.log('No evolution_log keys found'); process.exit(); }

  for (const id of ids) {
    const rows = (await redis.lrange(`${id}:evolution_log`, -N, -1)).map(JSON.parse);
    if (!rows.length) { console.log(chalk.yellow(`– no data for ${id}`)); continue; }

    banner(`Evolution of ${id} (last ${rows.length})`);

    rows.forEach(r => {
      console.log(chalk.bold.blue(`⏰ ${new Date(r.ts).toLocaleTimeString()}`));

      if (!r.diff) {                     // ← SIMPLE ENTRY
        console.log('  ' + pad(chalk.white('emotion'), 12) +
                    chalk.yellow(' → ') + chalk.green(r.emotion));
        console.log(); return;
      }

      // COMPLEX DIFF
      for (const [k, v] of Object.entries(r.diff)) {
        if (typeof v.from === 'number' && typeof v.to === 'number') {
          const d = v.to - v.from, col = d >= 0 ? 'green' : 'red';
          console.log('  ' + pad(chalk.white(k), 12) + ' ' +
                      bar(v.to, 20, col) + ' ' +
                      chalk[col](d >= 0 ? `+${d.toFixed(2)}` : d.toFixed(2)));
        } else {
          console.log('  ' + pad(chalk.white(k), 12) +
                      chalk.yellow(' “') + chalk.cyan(String(v.from)) +
                      chalk.yellow('” → “') + chalk.magenta(String(v.to)) + chalk.yellow('”'));
        }
      }
      console.log();
    });

    end();
  }
  process.exit();
})();
