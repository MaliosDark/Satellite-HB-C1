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
  
  const PROGRAM_ID = new PublicKey('FILL_IN_YOUR_PROGRAM_ID_HERE');
  
  class Trader {
    constructor(provider) {
      this.provider = provider; // anchor AnchorProvider
      this.program = new anchor.Program(
        require('./bonding_curve/idl.json'),
        PROGRAM_ID,
        provider
      );
    }
  
    // Buy `amount` tokens. User pays lamports.
    async buy(amount) {
      const user = this.provider.wallet.publicKey;
  
      // Derive PDAs
      const [statePda] = await PublicKey.findProgramAddress(
        [Buffer.from('state')],
        PROGRAM_ID
      );
      const [reservePda] = await PublicKey.findProgramAddress(
        [Buffer.from('reserve')],
        PROGRAM_ID
      );
      const [mintAuthorityPda] = await PublicKey.findProgramAddress(
        [Buffer.from('mint-authority')],
        PROGRAM_ID
      );
  
      // Find or create user's token account for the mint
      const mint = (await this.program.account.state.fetch(statePda)).mint;
      const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.provider.wallet.payer,
        new PublicKey(mint),
        user
      );
  
      // Build transaction
      const tx = await this.program.methods
        .buy(new anchor.BN(amount))
        .accounts({
          state: statePda,
          user: user,
          reserve: reservePda,
          mint: new PublicKey(mint),
          mintAuthority: mintAuthorityPda,
          userTokenAccount: userTokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return tx;
    }
  
    // Sell `amount` tokens. User burns tokens and receives lamports.
    async sell(amount) {
      const user = this.provider.wallet.publicKey;
  
      // Derive PDAs
      const [statePda] = await PublicKey.findProgramAddress(
        [Buffer.from('state')],
        PROGRAM_ID
      );
      const [reservePda] = await PublicKey.findProgramAddress(
        [Buffer.from('reserve')],
        PROGRAM_ID
      );
      const [mintAuthorityPda] = await PublicKey.findProgramAddress(
        [Buffer.from('mint-authority')],
        PROGRAM_ID
      );
  
      // User's token account
      const mint = (await this.program.account.state.fetch(statePda)).mint;
      const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.provider.wallet.payer,
        new PublicKey(mint),
        user
      );
  
      // Build transaction
      const tx = await this.program.methods
        .sell(new anchor.BN(amount))
        .accounts({
          state: statePda,
          user: user,
          reserve: reservePda,
          mint: new PublicKey(mint),
          mintAuthority: mintAuthorityPda,
          userTokenAccount: userTokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return tx;
    }
  }
  
  module.exports = { Trader };
  