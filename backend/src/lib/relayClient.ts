import { env } from '../config/env.js';

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon';

interface UnifiedQuotePayload {
  srcChainKey?: string;
  dstChainKey?: string;
  srcTokenAddress?: string;
  dstTokenAddress?: string;
  srcWalletAddress?: string;
  dstWalletAddress?: string;
  amount?: string;
}

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const NATIVE_EEE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function normalizeRelayTokenAddress(address?: string): string {
  if (!address) throw new Error('Missing token address for Relay quote.');
  // Relay uses zero address for native tokens
  if (address.toLowerCase() === NATIVE_EEE) return ZERO_ADDRESS;
  return address;
}

function parseChainId(value?: string): number {
  if (!value) throw new Error('Missing chain key for Relay quote.');
  if (value in CHAIN_ID_BY_KEY) return CHAIN_ID_BY_KEY[value as ChainKey];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Unsupported chain key for Relay: ${value}`);
  return numeric;
}

interface RelayCurrencyDetail {
  amount?: string;
  amountFormatted?: string;
  amountUsd?: string;
  minimumAmount?: string;
  currency?: { decimals?: number; symbol?: string };
}

interface RelayFeeItem {
  amount?: string;
  amountUsd?: string;
}

interface RelayStep {
  id?: string;
  action?: string;
  kind?: string;
  items?: Array<{
    status?: string;
    data?: {
      to?: string;
      data?: string;
      value?: string;
      gas?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
  }>;
}

interface RelayQuoteResponse {
  steps?: RelayStep[];
  fees?: {
    gas?: RelayFeeItem;
    relayer?: RelayFeeItem;
    relayerGas?: RelayFeeItem;
    relayerService?: RelayFeeItem;
    app?: RelayFeeItem;
  };
  details?: {
    operation?: string;
    timeEstimate?: number;
    currencyIn?: RelayCurrencyDetail;
    currencyOut?: RelayCurrencyDetail;
  };
}

function sumRelayFees(fees?: RelayQuoteResponse['fees']): number {
  if (!fees) return 0;
  const items = [fees.gas, fees.relayer, fees.relayerGas, fees.relayerService, fees.app];
  return items.reduce((sum, item) => {
    const parsed = Number(item?.amountUsd ?? 0);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

interface RelayTransactionData {
  to?: string;
  data?: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export async function requestRelayQuote(payload: UnifiedQuotePayload): Promise<{
  provider: 'relay';
  quotes: Array<{
    id: string;
    provider: 'relay';
    routeSteps: Array<{ type: string }>;
    feeUsd: string;
    feePercent: string;
    duration: { estimated: string };
    dstAmount: string;
    dstAmountMin: string;
    userSteps: Array<{
      type: 'TRANSACTION';
      action: string;
      transaction: RelayTransactionData | undefined;
    }>;
    raw: RelayQuoteResponse;
  }>;
  warnings?: string[];
  raw: RelayQuoteResponse;
}> {
  const originChainId = parseChainId(payload.srcChainKey);
  const destinationChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) throw new Error('Missing amount for Relay quote.');

  const user = payload.srcWalletAddress ?? ZERO_ADDRESS;
  const recipient = payload.dstWalletAddress ?? user;

  const body = {
    originChainId,
    destinationChainId,
    originCurrency: normalizeRelayTokenAddress(payload.srcTokenAddress),
    destinationCurrency: normalizeRelayTokenAddress(payload.dstTokenAddress),
    amount: payload.amount,
    user,
    recipient,
    tradeType: 'EXACT_INPUT'
  };

  let response = await fetch(`${env.RELAY_API_BASE_URL}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let text = await response.text();
  let isFallback = false;

  // If the user's wallet is blocked, try again with a dummy wallet so we at least get quote pricing
  if (!response.ok && response.status === 400 && text.includes('BLOCKED_WALLET_ADDRESS') && user !== '0x1111111111111111111111111111111111111111') {
    body.user = '0x1111111111111111111111111111111111111111';
    body.recipient = '0x1111111111111111111111111111111111111111';

    response = await fetch(`${env.RELAY_API_BASE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    text = await response.text();
    isFallback = true;
  }

  if (!response.ok) {
    throw new Error(`Relay quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as RelayQuoteResponse;

  const dstAmountRaw = raw.details?.currencyOut?.amount;
  const dstAmountMinRaw = raw.details?.currencyOut?.minimumAmount ?? dstAmountRaw;
  if (!dstAmountRaw) {
    throw new Error('Relay quote response is missing destination amount.');
  }

  const feeUsd = sumRelayFees(raw.fees);
  const etaSeconds = raw.details?.timeEstimate ?? 30;
  const etaMs = Math.max(1000, etaSeconds * 1000);

  // Find the first executable transaction step
  const txStep = raw.steps?.find((s) => s.kind === 'transaction' || s.kind === 'deposit');
  // Disable transaction if we fell back to a dummy address (otherwise user routes funds to the dummy!)
  const txData = isFallback ? undefined : txStep?.items?.[0]?.data;

  return {
    provider: 'relay',
    quotes: [
      {
        id: `relay-${Date.now()}`,
        provider: 'relay',
        routeSteps: [{ type: 'RELAY_BRIDGE' }],
        feeUsd: feeUsd.toFixed(6),
        feePercent: '0',
        duration: { estimated: String(etaMs) },
        dstAmount: dstAmountRaw,
        dstAmountMin: dstAmountMinRaw ?? dstAmountRaw,
        userSteps: txData
          ? [{ type: 'TRANSACTION', action: 'Submit Relay transaction from wallet.', transaction: txData }]
          : [],
        raw
      }
    ],
    warnings: isFallback ? ['Wallet blocked by Relay (TRM). Quote provided for reference only, execution disabled.'] : undefined,
    raw
  };
}
