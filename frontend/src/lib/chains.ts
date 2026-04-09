export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export type ChainKey = 'base' | 'bsc' | 'ethereum' | 'polygon' | 'monad';

export interface TokenOption {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoURI: string;
}

export interface ChainOption {
  key: ChainKey;
  name: string;
  chainId: number;
  logoURI: string;
  tokens: TokenOption[];
}

// ── Ethereum ─────────────────────────────────────────────
const ETHEREUM_TOKENS: TokenOption[] = [
  {
    symbol: 'ETH',
    name: 'Ether',
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    logoURI: '/token-icons/eth.svg'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    logoURI: '/token-icons/usdc.svg'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    logoURI: '/token-icons/usdt.svg'
  },
  {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    decimals: 18,
    logoURI: '/token-icons/dai.svg'
  },
  {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    decimals: 8,
    logoURI: '/token-icons/wbtc.png'
  },
  {
    symbol: 'BUSD',
    name: 'Binance USD',
    address: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
    decimals: 18,
    logoURI: '/token-icons/busd.png'
  }
];

// ── Base ──────────────────────────────────────────────────
const BASE_TOKENS: TokenOption[] = [
  {
    symbol: 'ETH',
    name: 'Ether',
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    logoURI: '/token-icons/eth.svg'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    logoURI: '/token-icons/usdc.svg'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xfde4C96c8593536e31F229EA8f37b2Ada2699bb2',
    decimals: 6,
    logoURI: '/token-icons/usdt.svg'
  },
  {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    decimals: 18,
    logoURI: '/token-icons/dai.svg'
  },
  {
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    decimals: 8,
    logoURI: '/token-icons/cbbtc.png'
  },
  {
    symbol: 'VIRTUAL',
    name: 'Virtuals Protocol',
    address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    decimals: 18,
    logoURI: '/token-icons/virtual.png'
  }
];

// ── BNB Chain ─────────────────────────────────────────────
const BSC_TOKENS: TokenOption[] = [
  {
    symbol: 'BNB',
    name: 'BNB',
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    logoURI: '/token-icons/bnb.svg'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    logoURI: '/token-icons/usdt.svg'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
    logoURI: '/token-icons/usdc.svg'
  },
  {
    symbol: 'ETH',
    name: 'Ethereum Token',
    address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
    decimals: 18,
    logoURI: '/token-icons/eth.svg'
  },
  {
    symbol: 'BTCB',
    name: 'Binance-Peg BTCB Token',
    address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    decimals: 18,
    logoURI: '/token-icons/btcb.png'
  }
];

// ── Polygon ───────────────────────────────────────────────
const POLYGON_TOKENS: TokenOption[] = [
  {
    symbol: 'POL',
    name: 'POL',
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    logoURI: '/token-icons/matic.svg'
  },
  {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    decimals: 18,
    logoURI: '/token-icons/eth.svg'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    decimals: 6,
    logoURI: '/token-icons/usdc.svg'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    decimals: 6,
    logoURI: '/token-icons/usdt.svg'
  }
];

// ── Monad ─────────────────────────────────────────────────
const MONAD_TOKENS: TokenOption[] = [
  {
    symbol: 'MON',
    name: 'Monad',
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    logoURI: '/token-icons/mon.png'
  },
  {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
    decimals: 8,
    logoURI: '/token-icons/wbtc.png'
  }
];

export const CHAINS: ChainOption[] = [
  {
    key: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    logoURI: '/token-icons/eth.svg',
    tokens: ETHEREUM_TOKENS
  },
  {
    key: 'base',
    name: 'Base',
    chainId: 8453,
    logoURI: '/base-logo.svg',
    tokens: BASE_TOKENS
  },
  {
    key: 'bsc',
    name: 'BNB Chain',
    chainId: 56,
    logoURI: '/token-icons/bnb.svg',
    tokens: BSC_TOKENS
  },
  {
    key: 'polygon',
    name: 'Polygon',
    chainId: 137,
    logoURI: '/token-icons/matic.svg',
    tokens: POLYGON_TOKENS
  },
  {
    key: 'monad',
    name: 'Monad',
    chainId: 143,
    logoURI: '/monad-logo.png',
    tokens: MONAD_TOKENS
  }
];

export const CHAIN_BY_KEY: Record<ChainKey, ChainOption> = Object.fromEntries(
  CHAINS.map((chain) => [chain.key, chain])
) as Record<ChainKey, ChainOption>;

export function getToken(chainKey: ChainKey, symbol: string): TokenOption | undefined {
  return CHAIN_BY_KEY[chainKey]?.tokens.find((token) => token.symbol === symbol);
}

export function getDefaultToken(chainKey: ChainKey): TokenOption {
  return CHAIN_BY_KEY[chainKey].tokens[0];
}
