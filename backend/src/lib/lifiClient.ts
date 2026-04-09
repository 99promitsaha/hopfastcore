import { env } from '../config/env.js';

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon' | 'monad';

interface UnifiedQuotePayload {
  srcChainKey?: string;
  dstChainKey?: string;
  srcTokenAddress?: string;
  dstTokenAddress?: string;
  srcWalletAddress?: string;
  dstWalletAddress?: string;
  amount?: string;
  options?: {
    feeTolerance?: {
      amount?: number;
    };
  };
}

interface LiFiFeeCost {
  amountUSD?: string;
}

interface LiFiQuoteResponse {
  id?: string;
  tool?: {
    name?: string;
    key?: string;
  };
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
    executionDuration?: number;
    feeCosts?: LiFiFeeCost[];
    gasCosts?: LiFiFeeCost[];
  };
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
  };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137,
  monad: 143
};

function normalizeTokenAddress(address?: string): string {
  if (!address) {
    throw new Error('Missing token address for LI.FI fallback quote.');
  }

  if (address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    return ZERO_ADDRESS;
  }

  return address;
}

function parseChainId(value?: string): number {
  if (!value) {
    throw new Error('Missing chain key for LI.FI fallback quote.');
  }

  if (value in CHAIN_ID_BY_KEY) {
    return CHAIN_ID_BY_KEY[value as ChainKey];
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Unsupported chain key for LI.FI fallback: ${value}`);
  }

  return numeric;
}

function calculateFeeUsd(estimate?: LiFiQuoteResponse['estimate']): number {
  const allCosts = [...(estimate?.feeCosts ?? []), ...(estimate?.gasCosts ?? [])];

  return allCosts.reduce((accumulator, item) => {
    const parsed = Number(item.amountUSD ?? 0);
    return accumulator + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
}

function resolveSlippage(payload: UnifiedQuotePayload): number {
  const fallbackFromFeeTolerance = payload.options?.feeTolerance?.amount;
  const fromPayload =
    typeof fallbackFromFeeTolerance === 'number' && Number.isFinite(fallbackFromFeeTolerance)
      ? fallbackFromFeeTolerance / 100
      : undefined;

  return fromPayload ?? env.LIFI_SLIPPAGE;
}

export async function requestLiFiQuote(payload: UnifiedQuotePayload): Promise<{
  provider: 'lifi';
  quotes: Array<{
    id: string;
    provider: 'lifi';
    routeSteps: Array<{ type: string }>;
    feeUsd: string;
    feePercent: string;
    duration: { estimated: string };
    dstAmount: string;
    dstAmountMin: string;
    userSteps: Array<{
      type: 'TRANSACTION';
      action: string;
      transaction: LiFiQuoteResponse['transactionRequest'];
    }>;
    raw: LiFiQuoteResponse;
  }>;
  raw: LiFiQuoteResponse;
}> {
  const srcChainId = parseChainId(payload.srcChainKey);
  const dstChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) {
    throw new Error('Missing amount for LI.FI fallback quote.');
  }

  const fromAddress = payload.srcWalletAddress ?? ZERO_ADDRESS;
  const toAddress = payload.dstWalletAddress ?? payload.srcWalletAddress ?? ZERO_ADDRESS;

  const params = new URLSearchParams({
    fromChain: String(srcChainId),
    toChain: String(dstChainId),
    fromToken: normalizeTokenAddress(payload.srcTokenAddress),
    toToken: normalizeTokenAddress(payload.dstTokenAddress),
    fromAmount: payload.amount,
    fromAddress,
    toAddress,
    slippage: String(resolveSlippage(payload))
  });

  if (env.LIFI_INTEGRATOR) {
    params.set('integrator', env.LIFI_INTEGRATOR);
  }

  if (typeof env.LIFI_FEE === 'number' && Number.isFinite(env.LIFI_FEE)) {
    params.set('fee', String(env.LIFI_FEE));
  }

  const headers: Record<string, string> = {};
  if (env.LIFI_API_KEY) {
    headers['x-lifi-api-key'] = env.LIFI_API_KEY;
  }

  const response = await fetch(`${env.LIFI_API_BASE_URL}/quote?${params.toString()}`, {
    method: 'GET',
    headers
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LI.FI quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as LiFiQuoteResponse;

  if (!raw.estimate?.toAmount) {
    throw new Error('LI.FI quote response is missing destination amount.');
  }

  const feeUsd = calculateFeeUsd(raw.estimate);
  const durationSeconds = Number(raw.estimate.executionDuration ?? 90);
  const durationMilliseconds = Math.max(1000, Math.round(durationSeconds * 1000));

  const routeType = raw.tool?.name ?? raw.tool?.key ?? 'LI.FI_ROUTE';

  return {
    provider: 'lifi',
    quotes: [
      {
        id: raw.id ?? `lifi-${Date.now()}`,
        provider: 'lifi',
        routeSteps: [{ type: `LIFI_${routeType.replace(/\s+/g, '_').toUpperCase()}` }],
        feeUsd: feeUsd.toFixed(6),
        feePercent: '0',
        duration: { estimated: String(durationMilliseconds) },
        dstAmount: raw.estimate.toAmount,
        dstAmountMin: raw.estimate.toAmountMin ?? raw.estimate.toAmount,
        userSteps: [
          {
            type: 'TRANSACTION',
            action: 'Submit LI.FI transaction request from wallet.',
            transaction: raw.transactionRequest
          }
        ],
        raw
      }
    ],
    raw
  };
}
