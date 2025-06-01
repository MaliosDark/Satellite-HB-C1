// File: modules/trade/walletManager.js

const fs = require('fs');
const path = require('path');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const STORAGE_DIR = path.resolve(__dirname, '../../wallets');

async function getOrCreateWallet(coreId) {
  const file = path.join(STORAGE_DIR, `${coreId}.json`);
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file));
    return Keypair.fromSecretKey(bs58.decode(data.secret));
  } else {
    const kp = Keypair.generate();
    const secret = bs58.encode(kp.secretKey);
    fs.writeFileSync(file, JSON.stringify({ secret }));
    return kp;
  }
}

module.exports = { getOrCreateWallet };
