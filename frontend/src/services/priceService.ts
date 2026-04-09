/**
 * Token price fetcher using CoinGecko free API.
 * Caches prices for 30 seconds to avoid rate-limits.
 */

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  ETH:   'ethereum',
  BNB:   'binancecoin',
  USDC:  'usd-coin',
  USDT:  'tether',
  DAI:   'dai',
  WBTC:  'wrapped-bitcoin',
  BTCB:  'bitcoin',
  cbBTC: 'coinbase-wrapped-btc',
  BUSD:  'binance-usd',
  POL:   'matic-network',
  MON:   'monad-2'
};

interface PriceCache {
  prices: Record<string, number>;
  timestamp: number;
}

let cache: PriceCache | null = null;
const CACHE_TTL = 30_000; // 30 seconds
let inflightPromise: Promise<Record<string, number>> | null = null;

async function fetchAllPrices(): Promise<Record<string, number>> {
  const ids = [...new Set(Object.values(SYMBOL_TO_COINGECKO_ID))].join(',');

  try {
    const response = await fetch(
      `${COINGECKO_API}?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      return cache?.prices ?? {};
    }

    const data = (await response.json()) as Record<string, { usd?: number }>;

    const prices: Record<string, number> = {};
    for (const [symbol, cgId] of Object.entries(SYMBOL_TO_COINGECKO_ID)) {
      const price = data[cgId]?.usd;
      if (typeof price === 'number' && Number.isFinite(price)) {
        prices[symbol] = price;
      }
    }

    cache = { prices, timestamp: Date.now() };
    return prices;
  } catch {
    return cache?.prices ?? {};
  }
}

/**
 * Get USD prices for all supported tokens.
 * Returns a map of symbol → USD price.
 * Deduplicates concurrent requests and caches for 30s.
 */
export async function getTokenPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.prices;
  }

  // Deduplicate concurrent requests
  if (!inflightPromise) {
    inflightPromise = fetchAllPrices().finally(() => {
      inflightPromise = null;
    });
  }

  return inflightPromise;
}

/**
 * Get the USD price and value for a specific token amount.
 */
export function computeUsdValue(
  prices: Record<string, number>,
  symbol: string,
  amount: string
): { price: number; value: number } | null {
  const price = prices[symbol];
  if (typeof price !== 'number') return null;

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) return null;

  return { price, value: price * numAmount };
}
