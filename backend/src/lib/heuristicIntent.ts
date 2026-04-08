import type { SwapIntent } from '../types/swap.js';

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';

const chainAliases: Record<ChainKey, string[]> = {
  ethereum: ['ethereum', 'eth mainnet', 'mainnet'],
  base: ['base'],
  bsc: ['bsc', 'bnb chain', 'binance', 'binance smart chain', 'bnb'],
  polygon: ['polygon', 'matic', 'pol'],
  arbitrum: ['arbitrum', 'arb'],
  optimism: ['optimism', 'op']
};

const tokenAliases: Record<string, string[]> = {
  ETH: ['eth', 'ethereum', 'ether'],
  BNB: ['bnb', 'binance coin'],
  USDC: ['usdc', 'usd coin'],
  USDT: ['usdt', 'tether'],
  DAI: ['dai'],
  WBTC: ['wbtc', 'wrapped bitcoin'],
  BUSD: ['busd', 'binance usd'],
  POL: ['pol', 'matic'],
  ARB: ['arb', 'arbitrum token'],
  OP: ['op', 'optimism token'],
  WETH: ['weth', 'wrapped ether']
};

function detectChain(segment: string): ChainKey | undefined {
  const text = segment.toLowerCase();
  for (const [key, aliases] of Object.entries(chainAliases)) {
    if (aliases.some((alias) => text.includes(alias))) {
      return key as ChainKey;
    }
  }
  return undefined;
}

function detectToken(segment: string): string | undefined {
  const text = segment.toLowerCase();

  for (const [symbol, aliases] of Object.entries(tokenAliases)) {
    if (aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(text))) {
      return symbol;
    }
  }

  return undefined;
}

export function parseIntentHeuristically(prompt: string): SwapIntent {
  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();

  const fromMatch = normalized.match(/from\s+([^,.!?]+)/);
  const toMatch = normalized.match(/to\s+([^,.!?]+)/);
  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);

  const fromSegment = fromMatch?.[1] ?? normalized;
  const toSegment = toMatch?.[1] ?? normalized;

  const amount = amountMatch?.[1];
  const fromChain = detectChain(fromSegment) ?? detectChain(normalized);
  const toChain = detectChain(toSegment);
  const fromTokenSymbol = detectToken(normalized.split(' from ')[0] ?? normalized);
  const toTokenSymbol = detectToken(toSegment);

  const signals = [amount, fromChain, toChain, fromTokenSymbol, toTokenSymbol].filter(Boolean).length;
  const confidence = Number((signals / 5).toFixed(2));

  return {
    amount,
    fromChain,
    toChain,
    fromTokenSymbol,
    toTokenSymbol,
    confidence,
    reasoning:
      confidence >= 0.8
        ? 'High-confidence parse from heuristic fallback.'
        : 'Partial parse from heuristic fallback. Verify fields before quote.',
    source: 'heuristic'
  };
}
