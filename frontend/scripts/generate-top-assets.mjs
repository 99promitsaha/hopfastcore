#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const TOP_SYMBOL_LIMIT = 120;
const TOKENS_PER_CHAIN_LIMIT = 100;

const CHAIN_CONFIG = {
  ethereum: {
    chainId: 1,
    native: {
      symbol: 'ETH',
      name: 'Ether',
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      decimals: 18,
      logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png'
    }
  },
  base: {
    chainId: 8453,
    native: {
      symbol: 'ETH',
      name: 'Ether',
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      decimals: 18,
      logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png'
    }
  },
  bsc: {
    chainId: 56,
    native: {
      symbol: 'BNB',
      name: 'BNB',
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      decimals: 18,
      logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png'
    }
  },
  polygon: {
    chainId: 137,
    native: {
      symbol: 'POL',
      name: 'POL',
      address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      decimals: 18,
      logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png'
    }
  }
};

const EXTRA_PRIORITY_SYMBOLS = [
  'WETH', 'WBTC', 'USDC', 'USDT', 'DAI', 'LINK', 'AAVE', 'UNI',
  'ARB', 'OP', 'MATIC', 'POL', 'PEPE', 'SHIB', 'CRV', 'LDO'
];

function normalizeSymbol(symbol) {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function toIconSlug(symbol) {
  return symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed ${res.status} for ${url}`);
  }
  return res.json();
}

async function downloadSvgIfPossible(symbol, iconDir) {
  const slug = toIconSlug(symbol);
  if (!slug) return null;

  const targetPath = path.join(iconDir, `${slug}.svg`);
  try {
    await fs.access(targetPath);
    return `/token-icons/${slug}.svg`;
  } catch {
    // continue
  }

  const svgUrl = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${slug}.svg`;
  try {
    const response = await fetch(svgUrl);
    if (!response.ok) return null;
    const svg = await response.text();
    if (!svg.includes('<svg')) return null;
    await fs.writeFile(targetPath, svg, 'utf8');
    return `/token-icons/${slug}.svg`;
  } catch {
    return null;
  }
}

function toTokenArray(rawList) {
  return Object.values(rawList ?? {}).filter((token) => {
    if (!token || typeof token !== 'object') return false;
    if (!token.symbol || !token.address || typeof token.decimals !== 'number') return false;
    if (token.decimals < 0 || token.decimals > 30) return false;
    return true;
  });
}

async function main() {
  const rootDir = path.resolve(process.cwd());
  const srcOut = path.join(rootDir, 'src/lib/tokens.generated.ts');
  const iconDir = path.join(rootDir, 'public/token-icons');
  await fs.mkdir(iconDir, { recursive: true });

  const marketRows = await fetchJson(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false'
  );

  const rankedSymbols = marketRows
    .slice(0, TOP_SYMBOL_LIMIT)
    .map((row) => normalizeSymbol(row.symbol))
    .filter(Boolean);

  const rankMap = new Map();
  rankedSymbols.forEach((symbol, index) => {
    if (!rankMap.has(symbol)) rankMap.set(symbol, index + 1);
  });

  for (const extraSymbol of EXTRA_PRIORITY_SYMBOLS) {
    if (!rankMap.has(extraSymbol)) {
      rankMap.set(extraSymbol, TOP_SYMBOL_LIMIT + rankMap.size + 1);
    }
  }

  const generated = {};

  for (const [chainKey, config] of Object.entries(CHAIN_CONFIG)) {
    const oneInchUrl = `https://tokens.1inch.io/v1.2/${config.chainId}`;
    const tokenMap = await fetchJson(oneInchUrl);
    const tokenList = toTokenArray(tokenMap);

    const candidates = tokenList
      .map((token) => {
        const normalized = normalizeSymbol(token.symbol);
        const rank = rankMap.get(normalized);
        return {
          ...token,
          normalized,
          rank: typeof rank === 'number' ? rank : Number.MAX_SAFE_INTEGER
        };
      })
      .filter((token) => token.rank !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => a.rank - b.rank);

    const chainTokens = [config.native];
    const usedSymbols = new Set([normalizeSymbol(config.native.symbol)]);
    const usedAddresses = new Set([config.native.address.toLowerCase()]);

    const pickToken = async (token) => {
      const normalized = normalizeSymbol(token.symbol);
      const lowerAddress = token.address.toLowerCase();
      if (!normalized) return;
      if (usedSymbols.has(normalized) || usedAddresses.has(lowerAddress)) return;
      if (token.symbol.length > 15) return;

      const localSvg = await downloadSvgIfPossible(token.symbol, iconDir);
      chainTokens.push({
        symbol: token.symbol,
        name: token.name ?? token.symbol,
        address: token.address,
        decimals: token.decimals,
        logoURI: localSvg ?? token.logoURI ?? config.native.logoURI
      });
      usedSymbols.add(normalized);
      usedAddresses.add(lowerAddress);
    };

    for (const token of candidates) {
      await pickToken(token);
      if (chainTokens.length >= TOKENS_PER_CHAIN_LIMIT) break;
    }

    if (chainTokens.length < TOKENS_PER_CHAIN_LIMIT) {
      const fallbackCandidates = tokenList
        .filter((token) => token.logoURI && token.symbol && token.address)
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

      for (const token of fallbackCandidates) {
        await pickToken(token);
        if (chainTokens.length >= TOKENS_PER_CHAIN_LIMIT) break;
      }
    }

    generated[chainKey] = chainTokens;
  }

  const fileBody = `/* AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
 * Generated by: npm run sync:top-assets
 */
export const GENERATED_CHAIN_TOKENS = ${JSON.stringify(generated, null, 2)} as const;
`;

  await fs.writeFile(srcOut, fileBody, 'utf8');
  console.log(`Generated token set at ${srcOut}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
