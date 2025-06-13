// File: modules/trade/trader.js

const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
  } = require('@solana/web3.js');
  const {
    TOKEN_PROGRAM_ID,
    getOrCreateAssociatedTokenAccount,
  } = require('@solana/spl-token');
  const anchor = require('@project-serum/anchor');
  
  // ← Replace this with your real Program ID
  const PROGRAM_ID = new PublicKey('2eoCVVq7AAavNFUvZrHdY3KP8DeX1QEDZDJQC8UQ78ms');
  
class Trader {
  constructor(provider) {
    this.provider = provider; // anchor AnchorProvider
    this.program = new anchor.Program(
      require('./bonding_curve/idl.json'),
      PROGRAM_ID,
      provider
    );
  }
  
    // Buy `amount` tokens of whatever mint the state PDA points to
    async buy(mintAddress, amount) {
      const mintPubkey = new PublicKey(mintAddress);
  
      // derive PDAs
      const [statePda] = await PublicKey.findProgramAddress(
        [Buffer.from('state'), mintPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [reservePda] = await PublicKey.findProgramAddress(
        [Buffer.from('reserve'), mintPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [mintAuthPda] = await PublicKey.findProgramAddress(
        [Buffer.from('mint-authority'), mintPubkey.toBuffer()],
        PROGRAM_ID
      );
  
      // get/create user token account
      const user = this.provider.wallet.publicKey;
      const ata = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.provider.wallet.payer,
        mintPubkey,
        user
      );
  
      // call on‐chain buy()
      const tx = await this.program.methods
        .buy(new anchor.BN(amount))
        .accounts({
          state: statePda,
          user: user,
          reserve: reservePda,
          mint: mintPubkey,
          mintAuthority: mintAuthPda,
          userTokenAccount: ata.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return tx;
    }
  
    // Sell `amount` tokens
    async sell(mintAddress, amount) {
      const mintPubkey = new PublicKey(mintAddress);
  
      // derive PDAs
      const [statePda] = await PublicKey.findProgramAddress(
        [Buffer.from('state'), mintPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [reservePda] = await PublicKey.findProgramAddress(
        [Buffer.from('reserve'), mintPubkey.toBuffer()],
        PROGRAM_ID
      );
      const [mintAuthPda] = await PublicKey.findProgramAddress(
        [Buffer.from('mint-authority'), mintPubkey.toBuffer()],
        PROGRAM_ID
      );
  
      // get user token account
      const user = this.provider.wallet.publicKey;
      const ata = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.provider.wallet.payer,
        mintPubkey,
        user
      );
  
      // call on‐chain sell()
      const tx = await this.program.methods
        .sell(new anchor.BN(amount))
        .accounts({
          state: statePda,
          user: user,
          reserve: reservePda,
          mint: mintPubkey,
          mintAuthority: mintAuthPda,
          userTokenAccount: ata.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return tx;
  }
}

// Convenience helper used by the CLI and other modules
// to perform a single buy or sell action.
async function makeTradingDecision(
  config,
  _currentPrice,
  connection,
  programId,
  payer,
  mintAddress,
  amountLamports,
  action
) {
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);
  const trader = new Trader(provider);
  const tokens = Math.floor(amountLamports / 1_000_000_000);
  if (action === 'BUY') {
    return trader.buy(mintAddress, tokens);
  }
  if (action === 'SELL') {
    return trader.sell(mintAddress, tokens);
  }
  throw new Error('Action must be BUY or SELL');
}

module.exports = { Trader, makeTradingDecision };
  