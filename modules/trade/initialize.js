// File: modules/trade/initialize.js

const anchor = require('@project-serum/anchor');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getOrCreateWallet } = require('./walletManager'); // your existing module

(async () => {
  // ─── CONFIG ───────────────────────────────────────────────────────────────
  const CLUSTER = 'devnet';
  const PROGRAM_ID = new PublicKey('2eoCVVq7AAavNFUvZrHdY3KP8DeX1QEDZDJQC8UQ78ms');
  const TOKEN_MINT = new PublicKey('YOUR_SPL_MINT_ADDRESS_HERE');
  const BOT_CORE_ID = 'my_bot_core_id'; // identifier for your walletManager
  // ─── END CONFIG ───────────────────────────────────────────────────────────

  // 1) Connect to Devnet
  const connection = new Connection(anchor.web3.clusterApiUrl(CLUSTER), 'confirmed');

  // 2) Load (or create) a wallet via your walletManager
  const payerKeypair = await getOrCreateWallet(BOT_CORE_ID);
  const wallet = new anchor.Wallet(payerKeypair);

  // 3) Build Anchor provider
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);

  // 4) Load the IDL and instantiate the program
  const idl = require('./bonding_curve/idl.json'); // after you ran `anchor build` and copied it here
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // 5) Derive the PDA for the on‐chain state account
  const [statePda] = await PublicKey.findProgramAddress(
    [Buffer.from('state')],
    PROGRAM_ID
  );

  // 6) Derive the PDA for the mint_authority (to pass into accounts)
  const [mintAuthPda] = await PublicKey.findProgramAddress(
    [Buffer.from('mint-authority')],
    PROGRAM_ID
  );

  // 7) Call initialize(base_price, slope)
  //    You must already have funded your payerKeypair (e.g. `solana airdrop 2`).
  const basePriceLamports = 1_000_000_000; // example: 1 SOL = 1e9 lamports
  const slopeLamports = 500_000_000;     // example slope

  const txSignature = await program.methods
    .initialize(
      new anchor.BN(basePriceLamports),
      new anchor.BN(slopeLamports)
    )
    .accounts({
      state: statePda,
      mint: TOKEN_MINT,
      mintAuthority: mintAuthPda,
      initializer: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: anchor.web3.TokenInstructions.TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log('✓ Initialized on‐chain state. Tx signature:', txSignature);
})();
