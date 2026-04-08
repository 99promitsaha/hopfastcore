import { CHAIN_BY_KEY, type ChainKey } from './chains';

export interface ParsedIntent {
  amount?: string;
  fromChain?: ChainKey;
  toChain?: ChainKey;
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  confidence: number;
  reasoning: string;
}

const CHAIN_ALIASES: Array<{ key: ChainKey; aliases: string[] }> = [
  { key: 'ethereum', aliases: ['ethereum', 'eth mainnet', 'mainnet'] },
  { key: 'base', aliases: ['base'] },
  { key: 'bsc', aliases: ['bsc', 'bnb chain', 'binance', 'binance smart chain', 'bnb'] },
  { key: 'polygon', aliases: ['polygon', 'matic', 'pol'] },
  { key: 'arbitrum', aliases: ['arbitrum', 'arb'] },
  { key: 'optimism', aliases: ['optimism', 'op'] }
];

const TOKEN_ALIASES: Record<string, string[]> = {
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

function detectChainFromSegment(segment: string): ChainKey | undefined {
  for (const chain of CHAIN_ALIASES) {
    if (chain.aliases.some((alias) => segment.includes(alias))) {
      return chain.key;
    }
  }
  return undefined;
}

function detectTokenFromSegment(segment: string, chain?: ChainKey): string | undefined {
  const allowed = chain ? new Set(CHAIN_BY_KEY[chain].tokens.map((token) => token.symbol)) : undefined;

  for (const [symbol, aliases] of Object.entries(TOKEN_ALIASES)) {
    if (allowed && !allowed.has(symbol)) {
      continue;
    }

    if (aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(segment))) {
      return symbol;
    }
  }

  return undefined;
}

export function parsePromptIntent(prompt: string): ParsedIntent {
  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();

  const fromMatch = normalized.match(/from\s+([^,.!?]+)/);
  const toMatch = normalized.match(/to\s+([^,.!?]+)/);

  const fromSegment = fromMatch?.[1] ?? '';
  const toSegment = toMatch?.[1] ?? '';

  const fromChain = detectChainFromSegment(fromSegment) ?? detectChainFromSegment(normalized);
  const toChain = detectChainFromSegment(toSegment);

  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch?.[1];

  const initialClause = normalized.split(' from ')[0] ?? normalized;

  const fromTokenSymbol =
    detectTokenFromSegment(initialClause, fromChain) ?? detectTokenFromSegment(fromSegment, fromChain) ?? undefined;

  const toTokenSymbol =
    detectTokenFromSegment(toSegment, toChain) ??
    detectTokenFromSegment(normalized.split(' to ')[1] ?? '', toChain) ??
    undefined;

  const confidenceSignals = [amount, fromChain, toChain, fromTokenSymbol, toTokenSymbol].filter(Boolean).length;
  const confidence = Number((confidenceSignals / 5).toFixed(2));

  return {
    amount,
    fromChain,
    toChain,
    fromTokenSymbol,
    toTokenSymbol,
    confidence,
    reasoning:
      confidence >= 0.8
        ? 'Strong parse from natural language.'
        : 'Partial parse. Please confirm chain/token fields before requesting quote.'
  };
}
