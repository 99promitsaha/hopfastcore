export interface SwapIntent {
  amount?: string;
  fromChain?: 'ethereum' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';
  toChain?: 'ethereum' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  confidence: number;
  reasoning: string;
  source: 'openai' | 'heuristic';
}
