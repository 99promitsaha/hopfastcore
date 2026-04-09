import { Router } from 'express';
import { env } from '../config/env.js';

const router = Router();

type ChainKey = 'ethereum' | 'base' | 'bsc' | 'polygon';

const CHAIN_ID_BY_KEY: Record<ChainKey, number> = {
  ethereum: 1,
  base: 8453,
  bsc: 56,
  polygon: 137
};

interface StatusResult {
  status: 'pending' | 'confirming' | 'bridging' | 'completed' | 'failed';
  substatus?: string;
  receivingTxHash?: string;
  explorerLink?: string;
}

// ── LI.FI status: GET li.quest/v1/status?txHash=...&fromChain=...
async function fetchLiFiStatus(txHash: string, fromChainId: number): Promise<StatusResult> {
  const params = new URLSearchParams({
    txHash,
    fromChain: String(fromChainId)
  });

  const headers: Record<string, string> = {};
  if (env.LIFI_API_KEY) {
    headers['x-lifi-api-key'] = env.LIFI_API_KEY;
  }

  const response = await fetch(`${env.LIFI_API_BASE_URL}/status?${params.toString()}`, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LI.FI status check failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    status?: string;
    substatus?: string;
    receiving?: { txHash?: string; txLink?: string };
    lifiExplorerLink?: string;
  };

  const lifiStatus = data.status?.toUpperCase();

  let status: StatusResult['status'];
  if (lifiStatus === 'DONE') {
    status = 'completed';
  } else if (lifiStatus === 'FAILED') {
    status = 'failed';
  } else if (lifiStatus === 'PENDING') {
    status = 'bridging';
  } else if (lifiStatus === 'NOT_FOUND' || lifiStatus === 'INVALID') {
    status = 'confirming';
  } else {
    status = 'pending';
  }

  return {
    status,
    substatus: data.substatus,
    receivingTxHash: data.receiving?.txHash,
    explorerLink: data.lifiExplorerLink ?? data.receiving?.txLink
  };
}

// ── deBridge status: GET /api/Transaction/{hash}/orderIds → GET /api/Orders/{orderId}
async function fetchDebridgeStatus(txHash: string): Promise<StatusResult> {
  // Step 1: Get order ID from tx hash
  const orderIdsResponse = await fetch(
    `https://dln-api.debridge.finance/api/Transaction/${txHash}/orderIds`
  );

  if (!orderIdsResponse.ok) {
    // Tx not indexed yet
    return { status: 'confirming', substatus: 'Transaction not yet indexed by deBridge.' };
  }

  const orderIdsData = (await orderIdsResponse.json()) as { orderIds?: string[] };
  const orderId = orderIdsData.orderIds?.[0];

  if (!orderId) {
    return { status: 'confirming', substatus: 'Waiting for deBridge to detect the order.' };
  }

  // Step 2: Get order status
  const orderResponse = await fetch(
    `https://dln-api.debridge.finance/api/Orders/${orderId}`
  );

  if (!orderResponse.ok) {
    return { status: 'bridging', substatus: 'Order found, checking status...' };
  }

  const orderData = (await orderResponse.json()) as {
    status?: string;
    fulfilledDstEventMetadata?: { transactionHash?: string };
  };

  const dbStatus = orderData.status;

  let status: StatusResult['status'];
  if (dbStatus === 'Fulfilled' || dbStatus === 'SentUnlock' || dbStatus === 'ClaimedUnlock') {
    status = 'completed';
  } else if (dbStatus === 'Cancelled') {
    status = 'failed';
  } else if (dbStatus === 'Created') {
    status = 'bridging';
  } else {
    status = 'bridging';
  }

  return {
    status,
    substatus: dbStatus,
    receivingTxHash: orderData.fulfilledDstEventMetadata?.transactionHash
  };
}

// ── Relay status: GET api.relay.link/intents/status/v3?requestId=...
// Relay's requestId comes from the step response; fall back to source tx receipt check
async function fetchRelayStatus(txHash: string, fromChainId: number): Promise<StatusResult> {
  // Try Relay's requests endpoint with the origin tx hash
  // Relay indexes requests by the origin transaction hash
  const response = await fetch(
    `${env.RELAY_API_BASE_URL}/intents/status/v2?originChainId=${fromChainId}&txHash=${txHash}`
  );

  if (response.ok) {
    const data = (await response.json()) as {
      status?: string;
      inTxHashes?: string[];
      txHashes?: string[];
    };

    const relayStatus = data.status?.toLowerCase();

    let status: StatusResult['status'];
    if (relayStatus === 'success') {
      status = 'completed';
    } else if (relayStatus === 'failure') {
      status = 'failed';
    } else if (relayStatus === 'refunded' || relayStatus === 'refund') {
      status = 'failed';
    } else if (relayStatus === 'pending' || relayStatus === 'submitted' || relayStatus === 'delayed') {
      status = 'bridging';
    } else if (relayStatus === 'depositing' || relayStatus === 'waiting') {
      status = 'confirming';
    } else {
      status = 'confirming';
    }

    return {
      status,
      substatus: data.status,
      receivingTxHash: data.txHashes?.[0]
    };
  }

  // Relay hasn't indexed it yet — treat as confirming
  return { status: 'confirming', substatus: 'Waiting for Relay to detect the transaction.' };
}

// ── Squid status: GET v2.api.squidrouter.com/v2/status?transactionId=...&fromChainId=...&toChainId=...
async function fetchSquidStatus(txHash: string, fromChainId: number, toChainId?: number): Promise<StatusResult> {
  const params = new URLSearchParams({
    transactionId: txHash,
    fromChainId: String(fromChainId),
    toChainId: String(toChainId ?? fromChainId)
  });

  const headers: Record<string, string> = {};
  if (env.SQUID_INTEGRATOR_ID) {
    headers['x-integrator-id'] = env.SQUID_INTEGRATOR_ID;
  }

  const response = await fetch(`${env.SQUID_API_BASE_URL}/v2/status?${params.toString()}`, { headers });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 || text.includes('not_found')) {
      return { status: 'confirming', substatus: 'Waiting for Squid to detect the transaction.' };
    }
    throw new Error(`Squid status check failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    squidTransactionStatus?: string;
    toChain?: { transactionId?: string };
  };

  const squidStatus = data.squidTransactionStatus?.toLowerCase();

  let status: StatusResult['status'];
  if (squidStatus === 'success') {
    status = 'completed';
  } else if (squidStatus === 'partial_success' || squidStatus === 'needs_gas') {
    status = 'failed';
  } else if (squidStatus === 'ongoing') {
    status = 'bridging';
  } else if (squidStatus === 'not_found') {
    status = 'confirming';
  } else {
    status = 'confirming';
  }

  return {
    status,
    substatus: data.squidTransactionStatus,
    receivingTxHash: data.toChain?.transactionId
  };
}

router.get('/status', async (req, res) => {
  const txHash = typeof req.query.txHash === 'string' ? req.query.txHash : undefined;
  const provider = typeof req.query.provider === 'string' ? req.query.provider.toLowerCase() : undefined;
  const fromChainKey = typeof req.query.fromChain === 'string' ? req.query.fromChain : undefined;
  const toChainKey = typeof req.query.toChain === 'string' ? req.query.toChain : undefined;

  if (!txHash || !provider) {
    return res.status(400).json({ error: 'Missing required params: txHash, provider.' });
  }

  const fromChainId = fromChainKey && fromChainKey in CHAIN_ID_BY_KEY
    ? CHAIN_ID_BY_KEY[fromChainKey as ChainKey]
    : undefined;

  const toChainId = toChainKey && toChainKey in CHAIN_ID_BY_KEY
    ? CHAIN_ID_BY_KEY[toChainKey as ChainKey]
    : undefined;

  try {
    let result: StatusResult;

    if (provider === 'lifi' || provider === 'lifi-api') {
      result = await fetchLiFiStatus(txHash, fromChainId ?? 1);
    } else if (provider === 'debridge' || provider === 'debridge-api') {
      result = await fetchDebridgeStatus(txHash);
    } else if (provider === 'relay' || provider === 'relay-api') {
      result = await fetchRelayStatus(txHash, fromChainId ?? 1);
    } else if (provider === 'squid' || provider === 'squid-api') {
      result = await fetchSquidStatus(txHash, fromChainId ?? 1, toChainId);
    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    return res.json(result);
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Status check failed.',
      status: 'pending'
    });
  }
});

export default router;
