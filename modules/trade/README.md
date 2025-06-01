# Trade Module

This module adds real trading support to Satellite-HB-C1. It includes:

- Wallets for bots
- Token minting (SPL)
- Bonding curve smart contract
- Metadata server
- Price tracking
- Trading logic for BotMind

## Folder Structure

```
trade/
  index.js
  walletManager.js
  tokenMinter.js
  metadataServer.js
  priceTracker.js
  trader.js
  images/
  metadata/
  bondingCurve/
    Cargo.toml
    Anchor.toml
    programs/
      bonding_curve/
        src/
          lib.rs
```

## Setup

1. Install dependencies:

```bash
npm install @solana/web3.js @solana/spl-token express axios node-fetch form-data
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked
```

2. Start metadata server:

```bash
cd trade
node metadataServer.js
```

3. Use `mintNewToken` to create new tokens and metadata.

## Usage

```js
const { mintNewToken } = require('./tokenMinter');
```
