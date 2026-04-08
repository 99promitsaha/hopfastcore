import type { ChainKey } from '../lib/chains';

export type TxStage = 'submitted' | 'confirming' | 'bridging' | 'completed' | 'failed';

export interface TxStatusResult {
  status: TxStage;
  substatus?: string;
  receivingTxHash?: string;
  explorerLink?: string;
}

function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_HOPFAST_API_BASE_URL;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/$/, '');
  }

  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return 'http://localhost:8080/api';
  }

  return '';
}

export async function fetchTransactionStatus(
  txHash: string,
  provider: string,
  fromChain: ChainKey
): Promise<TxStatusResult> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error('Backend API URL unavailable.');
  }

  const params = new URLSearchParams({ txHash, provider, fromChain });
  const response = await fetch(`${base}/status?${params.toString()}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Status check failed (${response.status}).`);
  }

  return response.json() as Promise<TxStatusResult>;
}

const STAGE_PROGRESS: Record<TxStage, number> = {
  submitted: 10,
  confirming: 30,
  bridging: 60,
  completed: 100,
  failed: 0
};

export function stageToProgress(stage: TxStage): number {
  return STAGE_PROGRESS[stage] ?? 10;
}

/**
 * Poll transaction status until a terminal state is reached.
 * Calls onUpdate with each new status. Returns the final status.
 */
export function pollTransactionStatus(
  txHash: string,
  provider: string,
  fromChain: ChainKey,
  onUpdate: (result: TxStatusResult) => void,
  intervalMs = 5000,
  maxAttempts = 120
): { stop: () => void } {
  let stopped = false;
  let attempts = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (stopped) return;
    attempts++;

    try {
      const result = await fetchTransactionStatus(txHash, provider, fromChain);
      if (stopped) return;
      onUpdate(result);

      if (result.status === 'completed' || result.status === 'failed') {
        return; // Terminal — stop polling
      }
    } catch {
      // Non-terminal error — keep polling
    }

    if (attempts < maxAttempts && !stopped) {
      timeoutId = setTimeout(poll, intervalMs);
    }
  };

  // Start after initial delay (tx needs time to propagate)
  timeoutId = setTimeout(poll, 3000);

  return {
    stop: () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
