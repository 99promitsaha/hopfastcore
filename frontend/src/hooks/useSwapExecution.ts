import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrivyWalletBridge } from '../components/WalletConnector';
import type { QuoteResult } from '../services/quoteService';
import { pollTransactionStatus, stageToProgress, type TxStatusResult } from '../services/transactionStatusService';
import { parseUnits } from '../lib/amount';
import { ensureTokenApproval, isNativeToken } from '../lib/erc20';
import { toHexQuantity } from '../lib/swap';
import { API_BASE_URL } from '../constants';
import type { ChainKey } from '../lib/chains';
import type { SwapDraft, TxStatus } from '../types';

export function useSwapExecution(
  walletBridge: PrivyWalletBridge | null,
  fromChainId: number,
  onPostSwap: () => void
) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [error, setError] = useState('');

  const statusPollerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    return () => { statusPollerRef.current?.stop(); };
  }, []);

  const startStatusPolling = useCallback((hash: string, provider: string, fromChain: ChainKey) => {
    statusPollerRef.current?.stop();

    setTxStatus({ hash, stage: 'submitted', progress: stageToProgress('submitted') });

    statusPollerRef.current = pollTransactionStatus(
      hash,
      provider,
      fromChain,
      (result: TxStatusResult) => {
        setTxStatus((prev) => {
          if (!prev || prev.hash !== hash) return prev;
          return {
            ...prev,
            stage: result.status,
            progress: stageToProgress(result.status),
            substatus: result.substatus,
            receivingTxHash: result.receivingTxHash,
            explorerLink: result.explorerLink
          };
        });
      }
    );
  }, []);

  const recordSwap = useCallback(async (
    txHash: string,
    address: string,
    quoteId: string,
    draft: SwapDraft,
    provider: string,
    volumeUsd?: number
  ) => {
    try {
      await fetch(`${API_BASE_URL}/swaps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          quoteId,
          fromChain: draft.fromChain,
          toChain: draft.toChain,
          fromTokenSymbol: draft.fromTokenSymbol,
          toTokenSymbol: draft.toTokenSymbol,
          amount: draft.amount,
          ...(volumeUsd != null && { volumeUsd }),
          status: 'submitted',
          txHash,
          provider,
          metadata: { txHash, provider }
        })
      });
    } catch { /* non-critical */ }
  }, []);

  const executeSwap = useCallback(async (
    draft: SwapDraft,
    bestQuote: QuoteResult,
    selectedFromToken: { address: string; decimals: number; symbol: string },
    requestedAmountRaw: bigint | null,
    privyLogin: () => void,
    hasPrivy: boolean,
    isAuthenticated: boolean,
    isAmountInsufficient: boolean,
    volumeUsd?: number
  ) => {
    if (!walletBridge) {
      if (hasPrivy && !isAuthenticated) {
        privyLogin();
      } else {
        setError('Please connect your wallet first.');
      }
      return;
    }

    if (isAmountInsufficient) {
      setError(`Insufficient ${selectedFromToken.symbol} balance for this swap amount.`);
      return;
    }

    if (!bestQuote.transactionRequest) {
      setError('No executable transaction found in this quote.');
      return;
    }

    try {
      setIsExecuting(true);
      setError('');
      setTxStatus(null);

      await walletBridge.switchChain(fromChainId);
      const provider = await walletBridge.getEthereumProvider();

      const spenderAddress = bestQuote.transactionRequest.to;
      if (spenderAddress && !isNativeToken(selectedFromToken.address)) {
        const requiredAmount = requestedAmountRaw ?? parseUnits(draft.amount, selectedFromToken.decimals);
        await ensureTokenApproval(
          provider,
          selectedFromToken.address,
          walletBridge.address,
          spenderAddress,
          requiredAmount
        );
      }

      const txParams: Record<string, unknown> = {
        from: walletBridge.address,
        to: bestQuote.transactionRequest.to,
        data: bestQuote.transactionRequest.data,
        value: toHexQuantity(bestQuote.transactionRequest.value) ?? '0x0',
      };

      if (bestQuote.transactionRequest.maxFeePerGas) {
        txParams.maxFeePerGas = toHexQuantity(bestQuote.transactionRequest.maxFeePerGas);
        txParams.maxPriorityFeePerGas = toHexQuantity(bestQuote.transactionRequest.maxPriorityFeePerGas);
      } else if (bestQuote.transactionRequest.gasPrice) {
        txParams.gasPrice = toHexQuantity(bestQuote.transactionRequest.gasPrice);
      }
      if (bestQuote.transactionRequest.gasLimit) {
        txParams.gas = toHexQuantity(bestQuote.transactionRequest.gasLimit);
      }

      const txHash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams]
      })) as string;

      startStatusPolling(txHash, bestQuote.provider, draft.fromChain);
      await recordSwap(txHash, walletBridge.address, bestQuote.id, draft, bestQuote.provider, volumeUsd);

      onPostSwap();
    } catch (caughtError) {
      setTxStatus((p) => p ? { ...p, stage: 'failed', progress: p.progress } : null);
      setError(caughtError instanceof Error ? caughtError.message : 'Swap execution failed.');
    } finally {
      setIsExecuting(false);
    }
  }, [walletBridge, fromChainId, startStatusPolling, recordSwap, onPostSwap]);

  const clearTxStatus = useCallback(() => setTxStatus(null), []);
  const clearError = useCallback(() => setError(''), []);

  return {
    isExecuting,
    txStatus,
    error,
    executeSwap,
    clearTxStatus,
    clearError,
  };
}
