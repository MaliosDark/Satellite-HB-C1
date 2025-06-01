// File: trade/priceTracker.js
// ===========================

const fetch = require('node-fetch');

/**
 * getTokenPrice:
 *   Given the mint address (string) of a Solana SPL token,
 *   makes a request to CoinGecko to retrieve its USD price.
 *   Returns a number (e.g., 2.35) or throws an error if the price is unavailable.
 *
 *   CoinGecko supports SPL tokens on the “solana” platform via:
 *     /simple/token_price/solana?contract_addresses=<mint>&vs_currencies=usd
 */
async function getTokenPrice(mintAddress) {
  if (!mintAddress) {
    throw new Error('The mint address (mintAddress) is required.');
  }

  // Convert to lowercase (CoinGecko expects lowercase addresses)
  const mint = mintAddress.toLowerCase().trim();

  // Build the URL for CoinGecko’s Solana token price endpoint
  const url = `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // Example response structure:
  // {
  //   "5TpN7x...abc": {
  //     "usd": 1.23
  //   }
  // }

  const entry = data[mint];
  if (!entry || typeof entry.usd !== 'number') {
    throw new Error(`Price not available for token ${mintAddress}`);
  }

  return entry.usd;
}

module.exports = { getTokenPrice };
