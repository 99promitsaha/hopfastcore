import type { ChainKey } from './lib/chains';
import type { TxStage as StatusTxStage } from './services/transactionStatusService';

export type EntryView = 'landing' | 'human' | 'agent';

export type ProviderKey = 'lifi' | 'debridge' | 'squid';

export interface SwapDraft {
  fromChain: ChainKey;
  toChain: ChainKey;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amount: string;
}

export type TxStage = StatusTxStage;

export interface TxStatus {
  hash: string;
  stage: TxStage;
  progress: number;
  substatus?: string;
  receivingTxHash?: string;
  explorerLink?: string;
}
