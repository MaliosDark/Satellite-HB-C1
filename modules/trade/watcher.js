// File: modules/trade/watcher.js

const fs = require('fs');
const path = require('path');
const anchor = require('@project-serum/anchor');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const {
  getOrCreateWallet
} = require('./walletManager');
const {
  getTokenPrice
} = require('./priceTracker');
const { Token, TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const { Trader } = require('./trader');

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const CLUSTER = 'devnet';                                        // devnet or mainnet-beta
const RPC_URL = anchor.web3.clusterApiUrl(CLUSTER);
const PROGRAM_ID = new PublicKey('2eoCVVq7AAavNFUvZrHdY3KP8DeX1QEDZDJQC8UQ78ms');
const BOT_CORE_ID = 'my_bot_core_id';                            // key for walletManager
const METADATA_DIR = path.join(__dirname, 'metadata');           // where <mint>.json lives
const METADATA_URI_PREFIX = 'http://localhost:3030/metadata/';   // prefix for JSON
const BUY_USD_THRESHOLD = 0.5;                                   // buy if price < 0.5 USD
const SELL_USD_THRESHOLD = 2.0;                                  // sell if price > 2.0 USD
const TRADE_AMOUNT = 1;                                          // tokens per buy/sell
const POLL_INTERVAL_MS = 30_000;                                 // 30 seconds
// ─── END CONFIG ─────────────────────────────────────────────────────────────

async function main() {
  // 1) Setup connection + provider + program + trader
  const connection = new Connection(RPC_URL, 'confirmed');
  const payerKeypair = await getOrCreateWallet(BOT_CORE_ID);
  const wallet = new anchor.Wallet(payerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idl = require('./bonding_curve/idl.json');
  const program = new anchor.Program(idl, PROGRAM_ID, provider);
  const trader = new Trader(provider);

  // Keep track of which mints have been initialized
  const initializedMints = new Set();

  // Helper: derive PDAs for a given mint
  function derivePdas(mintPubkey) {
    const mintBuffer = new PublicKey(mintPubkey).toBuffer();
    const statePda = PublicKey.findProgramAddressSync(
      [Buffer.from('state'), mintBuffer],
      PROGRAM_ID
    )[0];
    const reservePda = PublicKey.findProgramAddressSync(
      [Buffer.from('reserve'), mintBuffer],
      PROGRAM_ID
    )[0];
    const mintAuthPda = PublicKey.findProgramAddressSync(
      [Buffer.from('mint-authority'), mintBuffer],
      PROGRAM_ID
    )[0];
    return { statePda, reservePda, mintAuthPda };
  }

  // 2) Initialize curve for a new mint
  async function initializeCurve(mintPubkey, metadataUri) {
    const { statePda, mintAuthPda } = derivePdas(mintPubkey);

    try {
      await program.rpc.initialize(
        new anchor.BN(1_000_000_000),     // example base_price (1 SOL)
        new anchor.BN(500_000_000),       // example slope (0.5 SOL)
        metadataUri,
        {
          accounts: {
            state: statePda,
            mint: new PublicKey(mintPubkey),
            mintAuthority: mintAuthPda,
            initializer: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: anchor.web3.TokenInstructions.TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          }
        }
      );
      console.log(`Initialized curve for mint ${mintPubkey}`);
      initializedMints.add(mintPubkey);
    } catch (err) {
      console.error(`Failed to initialize ${mintPubkey}:`, err.toString());
    }
  }

  // 3) Perform buy/sell based on price
  async function performTrade(mintPubkey) {
    const { statePda, reservePda, mintAuthPda } = derivePdas(mintPubkey);
    const mintPublicKey = new PublicKey(mintPubkey);

    // Fetch USD price
    let priceUsd;
    try {
      priceUsd = await getTokenPrice(mintPubkey);
    } catch {
      console.warn(`Price unavailable for ${mintPubkey}`);
      return;
    }

    // Get (or create) associated token account for user
    const userAta = await getOrCreateAssociatedTokenAccount(
      connection,
      provider.wallet.payer,   // payer
      mintPublicKey,
      provider.wallet.publicKey
    );

    // Check on-chain token balance
    const tokenBalance = Number(userAta.amount);

    // Buy if price < BUY_THRESHOLD
    if (priceUsd < BUY_USD_THRESHOLD) {
      try {
        const tx = await trader.buy(mintPubkey, TRADE_AMOUNT);
        console.log(`Bought ${TRADE_AMOUNT} of ${mintPubkey} at $${priceUsd.toFixed(2)} — Tx ${tx}`);
      } catch (err) {
        console.error(`Buy failed for ${mintPubkey}:`, err.toString());
      }
      return;
    }

    // Sell if price > SELL_THRESHOLD and we have tokens
    if (priceUsd > SELL_USD_THRESHOLD && tokenBalance >= TRADE_AMOUNT) {
      try {
        const tx = await trader.sell(mintPubkey, TRADE_AMOUNT);
        console.log(`Sold ${TRADE_AMOUNT} of ${mintPubkey} at $${priceUsd.toFixed(2)} — Tx ${tx}`);
      } catch (err) {
        console.error(`Sell failed for ${mintPubkey}:`, err.toString());
      }
      return;
    }
  }

  // 4) Polling loop: scan metadata dir, init new curves, then trade
  setInterval(async () => {
    const files = fs.readdirSync(METADATA_DIR);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const mintPubkey = file.replace('.json', '');
      if (!initializedMints.has(mintPubkey)) {
        const metadataUri = METADATA_URI_PREFIX + file;
        await initializeCurve(mintPubkey, metadataUri);
      }
    }

    // After initialization, trade on all initialized mints
    for (const mint of Array.from(initializedMints)) {
      await performTrade(mint);
    }
  }, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
