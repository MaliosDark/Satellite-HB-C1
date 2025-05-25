// scripts/setup-twitter-client.js
// --------------------------------
const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const REPO = 'https://github.com/elizaOS/agent-twitter-client.git';
const DIR  = path.join(__dirname, '..', 'vendor', 'agent-twitter-client');

function sh(cmd, cwd = '.') {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// 1) clone only once
if (!fs.existsSync(DIR)) {
  sh(`git clone --depth 1 ${REPO} "${DIR}"`);
} else {
  console.log('✅ agent-twitter-client already present – skipping clone');
}

// 2) install deps
sh('npm install --production', DIR);
console.log('✅ twitter client ready');
