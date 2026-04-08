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
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

interface DebridgeTokenEstimation {
  amount?: string;
  approximateUsdValue?: number;
  recommendedAmount?: string;
  recommendedApproximateUsdValue?: number;
}

interface DebridgeCreateTxResponse {
  orderId?: string;
  tx?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: number | string;
  };
  order?: {
    approximateFulfillmentDelay?: number;
  };
  estimation?: {
    srcChainTokenIn?: DebridgeTokenEstimation & {
      originApproximateUsdValue?: number;
    };
    dstChainTokenOut?: DebridgeTokenEstimation;
  };
  estimatedTransactionFee?: {
    details?: {
      gasLimit?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    };
  };
}

function parseChainId(value?: string): number {
  if (!value) {
    throw new Error('Missing chain key for deBridge quote.');
  }

  if (value in CHAIN_ID_BY_KEY) {
    return CHAIN_ID_BY_KEY[value as ChainKey];
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Unsupported chain key for deBridge: ${value}`);
  }

  return numeric;
}

function normalizeTokenAddress(address?: string): string {
  if (!address) {
    throw new Error('Missing token address for deBridge quote.');
  }

  if (address.toLowerCase() === NATIVE_EEE) {
    return ZERO_ADDRESS;
  }

  return address;
}

function normalizeAddress(address?: string): string | undefined {
  if (!address) return undefined;
  if (!EVM_ADDRESS_REGEX.test(address)) return undefined;
  if (address.toLowerCase() === ZERO_ADDRESS) return undefined;
  return address;
}

function resolveFeeUsd(raw: DebridgeCreateTxResponse): number {
  const srcUsdRaw = raw.estimation?.srcChainTokenIn?.approximateUsdValue
    ?? raw.estimation?.srcChainTokenIn?.originApproximateUsdValue;
  const dstUsdRaw = raw.estimation?.dstChainTokenOut?.approximateUsdValue
    ?? raw.estimation?.dstChainTokenOut?.recommendedApproximateUsdValue;

  const srcUsd = Number(srcUsdRaw ?? 0);
  const dstUsd = Number(dstUsdRaw ?? 0);

  if (!Number.isFinite(srcUsd) || !Number.isFinite(dstUsd)) {
    return 0;
  }

  return Math.max(0, srcUsd - dstUsd);
}

export async function requestDebridgeQuote(payload: UnifiedQuotePayload): Promise<{
  provider: 'debridge';
  quotes: Array<{
    id: string;
    provider: 'debridge';
    routeSteps: Array<{ type: string }>;
    feeUsd: string;
    feePercent: string;
    duration: { estimated: string };
    dstAmount: string;
    dstAmountMin: string;
    userSteps: Array<{
      type: 'TRANSACTION';
      action: string;
      transaction: {
        to?: string;
        data?: string;
        value?: string;
        gasLimit?: string;
        gasPrice?: string;
        maxFeePerGas?: string;
        maxPriorityFeePerGas?: string;
      };
    }>;
    raw: DebridgeCreateTxResponse;
  }>;
  raw: DebridgeCreateTxResponse;
}> {
  const srcChainId = parseChainId(payload.srcChainKey);
  const dstChainId = parseChainId(payload.dstChainKey);

  if (!payload.amount) {
    throw new Error('Missing amount for deBridge quote.');
  }

  const srcAuthority = normalizeAddress(payload.srcWalletAddress);
  const dstRecipient = normalizeAddress(payload.dstWalletAddress) ?? srcAuthority;

  const params = new URLSearchParams({
    srcChainId: String(srcChainId),
    srcChainTokenIn: normalizeTokenAddress(payload.srcTokenAddress),
    srcChainTokenInAmount: payload.amount,
    dstChainId: String(dstChainId),
    dstChainTokenOut: normalizeTokenAddress(payload.dstTokenAddress),
    dstChainTokenOutAmount: 'auto',
    prependOperatingExpenses: 'true'
  });

  if (srcAuthority) {
    params.set('srcChainOrderAuthorityAddress', srcAuthority);
    params.set('senderAddress', srcAuthority);
  }

  if (dstRecipient) {
    params.set('dstChainOrderAuthorityAddress', dstRecipient);
    params.set('dstChainTokenOutRecipient', dstRecipient);
  }

  if (env.DEBRIDGE_ACCESS_TOKEN) {
    params.set('accesstoken', env.DEBRIDGE_ACCESS_TOKEN);
  }

  if (typeof env.DEBRIDGE_REFERRAL_CODE === 'number' && Number.isFinite(env.DEBRIDGE_REFERRAL_CODE)) {
    params.set('referralCode', String(env.DEBRIDGE_REFERRAL_CODE));
  }

  const response = await fetch(`${env.DEBRIDGE_API_BASE_URL}/v1.0/dln/order/create-tx?${params.toString()}`, {
    method: 'GET'
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`deBridge quote failed (${response.status}): ${text}`);
  }

  const raw = JSON.parse(text) as DebridgeCreateTxResponse;

  const dstAmount =
    raw.estimation?.dstChainTokenOut?.amount
    ?? raw.estimation?.dstChainTokenOut?.recommendedAmount;

  if (!dstAmount) {
    throw new Error('deBridge quote response is missing destination amount.');
  }

  const feeUsd = resolveFeeUsd(raw);
  const etaSeconds = Number(raw.order?.approximateFulfillmentDelay ?? 90);
  const etaMs = Math.max(1_000, Math.round(etaSeconds * 1_000));
  const txGasLimit = raw.tx?.gasLimit != null
    ? String(raw.tx.gasLimit)
    : raw.estimatedTransactionFee?.details?.gasLimit;
  const txData = raw.tx?.to
    ? {
      to: raw.tx.to,
      data: raw.tx.data,
      value: raw.tx.value,
      gasLimit: txGasLimit,
      gasPrice: raw.estimatedTransactionFee?.details?.gasPrice,
      maxFeePerGas: raw.estimatedTransactionFee?.details?.maxFeePerGas,
      maxPriorityFeePerGas: raw.estimatedTransactionFee?.details?.maxPriorityFeePerGas
    }
    : undefined;
  const srcUsd = Number(
    raw.estimation?.srcChainTokenIn?.approximateUsdValue
      ?? raw.estimation?.srcChainTokenIn?.originApproximateUsdValue
      ?? 0
  );
  const feePercent = srcUsd > 0 ? (feeUsd / srcUsd) * 100 : 0;

  return {
    provider: 'debridge',
    quotes: [
      {
        id: raw.orderId ?? `debridge-${Date.now()}`,
        provider: 'debridge',
        routeSteps: [{ type: 'DEBRIDGE_DLN' }],
        feeUsd: feeUsd.toFixed(6),
        feePercent: feePercent.toFixed(4),
        duration: { estimated: String(etaMs) },
        dstAmount,
        dstAmountMin: dstAmount,
        userSteps: txData
          ? [{ type: 'TRANSACTION', action: 'Submit deBridge DLN transaction from wallet.', transaction: txData }]
          : [],
        raw
      }
    ],
    raw
  };
}
