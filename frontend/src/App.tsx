import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpDown, Bot, Check, CheckCircle2, ExternalLink,
  Loader2, Radio, UserRound, X, Zap
} from 'lucide-react';
import {
  DemoWalletConnector, PrivyWalletConnector, usePrivyAuth,
  type PrivyWalletBridge
} from './components/WalletConnector';
import { TokenSelector } from './components/TokenSelector';
import { formatUnits, formatUsd, parseUnits } from './lib/amount';
import { CHAINS, CHAIN_BY_KEY, getDefaultToken, getToken, NATIVE_TOKEN_ADDRESS, type ChainKey } from './lib/chains';
import { getSwapQuote, type QuoteResult } from './services/quoteService';
import { getTokenPrices, computeUsdValue } from './services/priceService';
import { fetchSingleTokenBalance, fetchTokenBalancesForChain } from './services/balanceService';
import { fetchUserTransactionHistory, type UserTransactionRecord } from './services/transactionHistoryService';
import { pollTransactionStatus, stageToProgress, type TxStage as StatusTxStage, type TxStatusResult } from './services/transactionStatusService';

const HAS_PRIVY = Boolean(import.meta.env.VITE_PRIVY_APP_ID);

type EntryView = 'landing' | 'human' | 'agent';

interface SwapDraft {
  fromChain: ChainKey;
  toChain: ChainKey;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  amount: string;
}

const DEFAULT_DRAFT: SwapDraft = {
  fromChain: 'base',
  toChain: 'bsc',
  fromTokenSymbol: 'ETH',
  toTokenSymbol: 'BNB',
  amount: ''
};

const DEBOUNCE_MS = 1000;

const BLOCK_EXPLORER: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  bsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/'
};

type TxStage = StatusTxStage;

interface TxStatus {
  hash: string;
  stage: TxStage;
  progress: number;
  substatus?: string;
  receivingTxHash?: string;
  explorerLink?: string;
}

const TX_STAGES: { key: TxStage; label: string }[] = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'bridging', label: 'Bridging' },
  { key: 'completed', label: 'Complete' }
];

type ProviderKey = 'lifi' | 'relay' | 'debridge';
const LIVE_PROVIDERS: ProviderKey[] = ['lifi', 'relay', 'debridge'];
const HISTORY_LIMIT = 50;

function makeBalanceKey(chain: ChainKey, tokenAddress: string): string {
  return `${chain}:${tokenAddress.toLowerCase()}`;
}

function toProviderLabel(provider?: string): string {
  if (!provider) return 'Unknown';
  return provider.replace(/-api$/i, '').replace(/^./, (char) => char.toUpperCase());
}

function getAnotherChain(chain: ChainKey): ChainKey {
  const allKeys = CHAINS.map((c) => c.key);
  const idx = allKeys.indexOf(chain);
  return allKeys[(idx + 1) % allKeys.length];
}

function resolveToken(chain: ChainKey, preferred?: string, fallback?: string): string {
  if (preferred && getToken(chain, preferred)) return preferred;
  if (fallback && getToken(chain, fallback)) return fallback;
  return getDefaultToken(chain).symbol;
}

function toHexQuantity(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('0x')) return value;
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return undefined;
  }
}

function isValidSwapInput(draft: SwapDraft): boolean {
  if (draft.fromChain === draft.toChain) return false;
  const amount = Number(draft.amount);
  return Number.isFinite(amount) && amount > 0;
}

// ERC-20 allowance selector: allowance(owner, spender)
const ALLOWANCE_SELECTOR = '0xdd62ed3e';
// ERC-20 approve selector: approve(spender, amount)
const APPROVE_SELECTOR = '0x095ea7b3';
const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

function encodeAllowanceCall(owner: string, spender: string): string {
  const o = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return `${ALLOWANCE_SELECTOR}${o}${s}`;
}

function encodeApproveCall(spender: string): string {
  const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = MAX_UINT256.replace(/^0x/, '').padStart(64, '0');
  return `${APPROVE_SELECTOR}${s}${amount}`;
}

function isNativeToken(address: string): boolean {
  const lower = address.toLowerCase();
  return lower === NATIVE_TOKEN_ADDRESS.toLowerCase()
    || lower === '0x0000000000000000000000000000000000000000';
}

async function ensureTokenApproval(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  requiredAmount: bigint
): Promise<void> {
  // Native tokens don't need approval
  if (isNativeToken(tokenAddress)) return;

  // Check current allowance
  const data = encodeAllowanceCall(ownerAddress, spenderAddress);
  const allowanceHex = (await provider.request({
    method: 'eth_call',
    params: [{ to: tokenAddress, data }, 'latest']
  })) as string;

  const currentAllowance = BigInt(allowanceHex || '0x0');
  if (currentAllowance >= requiredAmount) return;

  // Send approval transaction
  const approveData = encodeApproveCall(spenderAddress);
  await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: ownerAddress,
      to: tokenAddress,
      data: approveData,
      value: '0x0'
    }]
  });

  // Wait for approval to be mined by polling allowance
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const updatedHex = (await provider.request({
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest']
    })) as string;
    if (BigInt(updatedHex || '0x0') >= requiredAmount) return;
  }

  throw new Error('Token approval was not confirmed in time. Please try again.');
}

function App() {
  const [view, setView] = useState<EntryView>('landing');
  const pendingLogin = useRef(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBridge, setWalletBridge] = useState<PrivyWalletBridge | null>(null);
  const [draft, setDraft] = useState<SwapDraft>(DEFAULT_DRAFT);
  const [quotes, setQuotes] = useState<Partial<Record<ProviderKey, QuoteResult | null>>>({});
  const [quotingProviders, setQuotingProviders] = useState<Set<ProviderKey>>(new Set());
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | null>(null);
  const [error, setError] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0);
  const [balanceError, setBalanceError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRecords, setHistoryRecords] = useState<UserTransactionRecord[]>([]);

  // Selected quote: user pick > auto-best (lowest fee)
  const bestQuote: QuoteResult | null = (() => {
    if (selectedProvider && quotes[selectedProvider]) return quotes[selectedProvider]!;
    const available = LIVE_PROVIDERS
      .map((p) => quotes[p])
      .filter((q): q is QuoteResult => q != null);
    if (!available.length) return null;
    return available.reduce((best, q) => (q.feeUsd < best.feeUsd ? q : best));
  })();

  const isQuoting = quotingProviders.size > 0;

  // Privy auth state — always call hook unconditionally
  const privyAuth = usePrivyAuth();

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const quoteAbortRefs = useRef<Partial<Record<ProviderKey, AbortController>>>({});

  const fromChain = CHAIN_BY_KEY[draft.fromChain];
  const toChain = CHAIN_BY_KEY[draft.toChain];
  const fromTokenOptions = useMemo(() => fromChain.tokens, [fromChain]);
  const sortedFromTokenOptions = useMemo(() => {
    const indexedTokens = fromTokenOptions.map((token, index) => ({
      token,
      index,
      balance: tokenBalances[makeBalanceKey(draft.fromChain, token.address)] ?? null
    }));

    indexedTokens.sort((left, right) => {
      const leftHasNonZero = left.balance != null && left.balance > 0n;
      const rightHasNonZero = right.balance != null && right.balance > 0n;
      if (leftHasNonZero !== rightHasNonZero) return leftHasNonZero ? -1 : 1;
      return left.index - right.index;
    });

    return indexedTokens.map((entry) => entry.token);
  }, [draft.fromChain, fromTokenOptions, tokenBalances]);
  const toTokenOptions = useMemo(() => toChain.tokens, [toChain]);
  const selectedFromToken = fromTokenOptions.find((t) => t.symbol === draft.fromTokenSymbol) ?? fromTokenOptions[0];
  const selectedToToken = toTokenOptions.find((t) => t.symbol === draft.toTokenSymbol) ?? toTokenOptions[0];
  const activeWalletAddress = walletBridge?.address ?? walletAddress;
  const hasConnectedWallet = Boolean(activeWalletAddress);
  const selectedBalanceKey = makeBalanceKey(draft.fromChain, selectedFromToken.address);
  const selectedSourceBalanceRaw = tokenBalances[selectedBalanceKey];
  const selectedSourceBalance = selectedSourceBalanceRaw != null
    ? formatUnits(selectedSourceBalanceRaw, selectedFromToken.decimals, 6)
    : null;
  const requestedAmountRaw = useMemo(() => {
    const amount = draft.amount.trim();
    if (!amount) return null;
    try {
      return parseUnits(amount, selectedFromToken.decimals);
    } catch {
      return null;
    }
  }, [draft.amount, selectedFromToken.decimals]);
  const isAmountInsufficient =
    hasConnectedWallet
    && requestedAmountRaw != null
    && selectedSourceBalanceRaw != null
    && requestedAmountRaw > selectedSourceBalanceRaw;
  const isBalanceUnknown = hasConnectedWallet && selectedSourceBalanceRaw == null;
  const shouldGateForBalanceCheck = hasConnectedWallet && !balanceError && (isRefreshingBalances || isBalanceUnknown);

  // Build formatted balance map for source chain token selector
  const formattedSourceBalances = useMemo(() => {
    const map: Record<string, string> = {};
    for (const token of fromTokenOptions) {
      const raw = tokenBalances[makeBalanceKey(draft.fromChain, token.address)];
      if (raw != null) {
        map[token.address.toLowerCase()] = formatUnits(raw, token.decimals, 4);
      }
    }
    return map;
  }, [draft.fromChain, fromTokenOptions, tokenBalances]);

  const fromUsd = computeUsdValue(prices, draft.fromTokenSymbol, draft.amount);
  const toUsd = bestQuote?.destinationAmount
    ? computeUsdValue(prices, draft.toTokenSymbol, bestQuote.destinationAmount)
    : null;

  // Fetch prices on mount and on token change
  useEffect(() => {
    getTokenPrices().then(setPrices).catch(() => {});
  }, [draft.fromTokenSymbol, draft.toTokenSymbol]);

  useEffect(() => {
    const interval = setInterval(() => {
      getTokenPrices().then(setPrices).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch balances for all source-chain assets before quoting
  useEffect(() => {
    if (!activeWalletAddress) {
      setBalanceError('');
      return;
    }

    let cancelled = false;

    const refreshBalances = async () => {
      try {
        setIsRefreshingBalances(true);
        setBalanceError('');

        const balances = await fetchTokenBalancesForChain(
          draft.fromChain,
          activeWalletAddress,
          CHAIN_BY_KEY[draft.fromChain].tokens
        );

        if (cancelled) return;

        setTokenBalances((prev) => {
          const next = { ...prev };
          for (const [tokenAddress, rawBalance] of Object.entries(balances)) {
            next[makeBalanceKey(draft.fromChain, tokenAddress)] = rawBalance;
          }
          return next;
        });
      } catch (caughtError) {
        if (cancelled) return;
        setBalanceError(caughtError instanceof Error ? caughtError.message : 'Failed to fetch wallet balances.');
      } finally {
        if (!cancelled) {
          setIsRefreshingBalances(false);
        }
      }
    };

    refreshBalances().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeWalletAddress, draft.fromChain, balanceRefreshTick]);

  // Ensure selected token balance is fetched with RPC fallback/retry.
  useEffect(() => {
    if (!activeWalletAddress) return;

    let cancelled = false;

    const refreshSelectedTokenBalance = async () => {
      const balance = await fetchSingleTokenBalance(
        draft.fromChain,
        activeWalletAddress,
        selectedFromToken
      );

      if (cancelled) return;

      if (balance == null) {
        setBalanceError(`Could not load ${selectedFromToken.symbol} balance right now.`);
        return;
      }

      setTokenBalances((prev) => ({
        ...prev,
        [makeBalanceKey(draft.fromChain, selectedFromToken.address)]: balance
      }));
      setBalanceError('');
    };

    refreshSelectedTokenBalance().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeWalletAddress, draft.fromChain, selectedFromToken.address, selectedFromToken.symbol]);

  // ── Gate navigation: require Privy login before entering Human view ──
  const handleHumanClick = () => {
    if (HAS_PRIVY && !privyAuth.authenticated) {
      pendingLogin.current = true;
      privyAuth.login();
      return;
    }
    setView('human');
  };

  const hasInsufficientAmountForDraft = useCallback((currentDraft: SwapDraft): boolean => {
    if (!activeWalletAddress) return false;

    const sourceToken = getToken(currentDraft.fromChain, currentDraft.fromTokenSymbol);
    if (!sourceToken) return false;

    const knownBalance = tokenBalances[makeBalanceKey(currentDraft.fromChain, sourceToken.address)];
    if (knownBalance == null) return false;

    try {
      return parseUnits(currentDraft.amount, sourceToken.decimals) > knownBalance;
    } catch {
      return false;
    }
  }, [activeWalletAddress, tokenBalances]);

  // ── Debounced auto-quote (fetches from all live providers in parallel) ──
  const fetchQuote = useCallback(async (currentDraft: SwapDraft) => {
    if (!isValidSwapInput(currentDraft) || shouldGateForBalanceCheck || hasInsufficientAmountForDraft(currentDraft)) {
      setQuotes({}); setSelectedProvider(null);
      return;
    }

    // Abort any in-flight requests
    LIVE_PROVIDERS.forEach((p) => {
      quoteAbortRefs.current[p]?.abort();
      quoteAbortRefs.current[p] = new AbortController();
    });

    setQuotingProviders(new Set(LIVE_PROVIDERS));
    setError('');

    const walletAddr = activeWalletAddress;

    LIVE_PROVIDERS.forEach(async (provider) => {
      try {
        const result = await getSwapQuote(
          { ...currentDraft, walletAddress: walletAddr },
          provider
        );
        setQuotes((prev) => ({ ...prev, [provider]: result }));
      } catch {
        setQuotes((prev) => ({ ...prev, [provider]: null }));
      } finally {
        setQuotingProviders((prev) => {
          const next = new Set(prev);
          next.delete(provider);
          return next;
        });
      }
    });
  }, [activeWalletAddress, hasInsufficientAmountForDraft, shouldGateForBalanceCheck]);

  useEffect(() => {
    setQuotes({}); setSelectedProvider(null);
    if (!isValidSwapInput(draft)) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(draft), DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft.amount, draft.fromChain, draft.toChain, draft.fromTokenSymbol, draft.toTokenSymbol, fetchQuote]);

  // ── Auto-refresh quotes every 30s while on the swap view ──
  useEffect(() => {
    if (view !== 'human') return;
    const interval = setInterval(() => {
      if (isValidSwapInput(draft) && !isExecuting) {
        fetchQuote(draft);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [view, draft, isExecuting, fetchQuote]);

  // Load user's transaction history when panel is opened
  useEffect(() => {
    if (!historyOpen) return;

    if (!activeWalletAddress) {
      setHistoryRecords([]);
      setHistoryError('Connect wallet to view transaction history.');
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError('');
        const records = await fetchUserTransactionHistory(activeWalletAddress, HISTORY_LIMIT);
        if (!cancelled) {
          setHistoryRecords(records);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setHistoryError(caughtError instanceof Error ? caughtError.message : 'Failed to load transaction history.');
          setHistoryRecords([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    loadHistory().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [historyOpen, activeWalletAddress, txStatus?.hash]);

  // ── If user actively logs in via Privy (not session restore), enter human view ──
  useEffect(() => {
    if (HAS_PRIVY && privyAuth.authenticated && pendingLogin.current) {
      pendingLogin.current = false;
      setView('human');
    }
  }, [privyAuth.authenticated]);

  // ── Real transaction status polling ─────────────────
  const statusPollerRef = useRef<{ stop: () => void } | null>(null);

  // Cleanup poller on unmount
  useEffect(() => {
    return () => { statusPollerRef.current?.stop(); };
  }, []);

  const startStatusPolling = (hash: string, provider: string, fromChain: ChainKey) => {
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
  };

  // ── Swap execution (Privy-only, never MetaMask) ─────
  const API_BASE_URL = import.meta.env.VITE_HOPFAST_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8080/api';

  const recordSwap = async (txHash: string) => {
    if (!walletBridge?.address || !bestQuote?.id) return;
    try {
      await fetch(`${API_BASE_URL}/swaps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: walletBridge.address,
          quoteId: bestQuote.id,
          fromChain: draft.fromChain, toChain: draft.toChain,
          fromTokenSymbol: draft.fromTokenSymbol, toTokenSymbol: draft.toTokenSymbol,
          amount: draft.amount, status: 'submitted',
          txHash,
          provider: bestQuote.provider,
          metadata: { txHash, provider: bestQuote.provider }
        })
      });
    } catch { /* non-critical */ }
  };

  const executeSwap = async () => {
    // Strictly require Privy wallet — never fallback to browser wallets
    if (!walletBridge) {
      if (HAS_PRIVY && !privyAuth.authenticated) {
        privyAuth.login();
      } else {
        setError('Please connect your wallet first.');
      }
      return;
    }

    if (isAmountInsufficient) {
      setError(`Insufficient ${selectedFromToken.symbol} balance for this swap amount.`);
      return;
    }

    if (!bestQuote?.transactionRequest) {
      setError('No executable transaction found in this quote.');
      return;
    }

    try {
      setIsExecuting(true);
      setError('');
      setTxStatus(null);

      await walletBridge.switchChain(fromChain.chainId);
      const provider = await walletBridge.getEthereumProvider();

      // Ensure ERC-20 approval before executing the swap
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

      // EIP-1559 (Relay) vs legacy (LI.FI) gas params
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
      await recordSwap(txHash);

      // Refresh wallet balances after a short delay so the new on-chain state is reflected
      setTimeout(() => setBalanceRefreshTick((t) => t + 1), 4000);
    } catch (caughtError) {
      setTxStatus((p) => p ? { ...p, stage: 'failed', progress: p.progress } : null);
      setError(caughtError instanceof Error ? caughtError.message : 'Swap execution failed.');
    } finally {
      setIsExecuting(false);
    }
  };

  // ── Draft helpers ───────────────────────────────────
  const swapDirections = () => {
    setDraft((c) => ({
      ...c,
      fromChain: c.toChain,
      toChain: c.fromChain,
      fromTokenSymbol: resolveToken(c.toChain, c.toTokenSymbol),
      toTokenSymbol: resolveToken(c.fromChain, c.fromTokenSymbol)
    }));
    setQuotes({}); setSelectedProvider(null);
    setTxStatus(null);
  };

  const updateFromChain = (chain: ChainKey) => {
    setDraft((c) => {
      const next = c.toChain === chain ? getAnotherChain(chain) : c.toChain;
      return { ...c, fromChain: chain, toChain: next,
        fromTokenSymbol: resolveToken(chain, undefined, c.fromTokenSymbol),
        toTokenSymbol: resolveToken(next, undefined, c.toTokenSymbol) };
    });
    setQuotes({}); setSelectedProvider(null);
  };

  const updateToChain = (chain: ChainKey) => {
    setDraft((c) => {
      const next = c.fromChain === chain ? getAnotherChain(chain) : c.fromChain;
      return { ...c, fromChain: next, toChain: chain,
        fromTokenSymbol: resolveToken(next, undefined, c.fromTokenSymbol),
        toTokenSymbol: resolveToken(chain, undefined, c.toTokenSymbol) };
    });
    setQuotes({}); setSelectedProvider(null);
  };

  const stageIdx = (stage: TxStage | undefined) =>
    TX_STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="hf-app">
      {/* ── Header ───────────────────────── */}
      <header className="hf-header">
        <div className="hf-logo" onClick={() => { setView('landing'); setTxStatus(null); }} style={{ cursor: 'pointer' }}>
          <div className="hf-logo-icon">⚡</div>
          <span className="hf-logo-text">HopFast</span>
        </div>

        {HAS_PRIVY ? (
          <PrivyWalletConnector onWalletAddress={setWalletAddress} onWalletBridge={setWalletBridge} />
        ) : (
          <DemoWalletConnector />
        )}
      </header>

      {/* ── Main Content ─────────────────── */}
      <AnimatePresence mode="wait">
        {/* ── LANDING ─────────────────── */}
        {view === 'landing' && (
          <motion.main
            key="landing"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="hf-content"
          >
            <div className="hf-hero">
              <h1>
                Move assets
                <br />
                <span>at light speed.</span>
              </h1>
              <p className="hf-hero-sub">
                Cross-chain swaps powered by the fastest liquidity routes. Bridge any token across 4+ chains in seconds by comparing quotes from LI.FI, Relay, deBridge &amp; more.
              </p>
            </div>

            <div className="hf-role-list">
              <button className="hf-role-card" onClick={handleHumanClick}>
                <div>
                  <p className="hf-role-title">Human</p>
                  <p className="hf-role-sub">Instant cross-chain bridging</p>
                </div>
                <span className="hf-role-icon">
                  <UserRound size={18} />
                </span>
              </button>

              <button className="hf-role-card hf-role-card-muted" onClick={() => setView('agent')}>
                <div>
                  <p className="hf-role-title">Agent</p>
                  <p className="hf-role-sub">
                    <span className="hf-soon-pill">Coming soon</span>
                  </p>
                </div>
                <span className="hf-role-icon hf-role-icon-muted">
                  <Bot size={18} />
                </span>
              </button>
            </div>

            <div className="hf-chain-logos">
              {CHAINS.slice(0, 4).map((chain) => (
                <img key={chain.key} className="hf-chain-logo-icon" src={chain.logoURI} alt={chain.name} />
              ))}
              <span className="hf-chain-more-label">+ more</span>
            </div>

            <div className="hf-stats-bar">
              <div className="hf-stat">
                <div className="hf-stat-value">4+</div>
                <div className="hf-stat-label">Chains</div>
              </div>
              <div className="hf-stat">
                <div className="hf-stat-value">20+</div>
                <div className="hf-stat-label">Tokens</div>
              </div>
              <div className="hf-stat">
                <div className="hf-stat-value">&lt;30s</div>
                <div className="hf-stat-label">Avg Swap</div>
              </div>
            </div>
          </motion.main>
        )}

        {/* ── AGENT ──────────────────── */}
        {view === 'agent' && (
          <motion.main
            key="agent"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.24 }}
            className="hf-content"
            style={{ justifyContent: 'center' }}
          >
            <div className="hf-agent-placeholder">
              <p className="hf-kicker">HopFast Agent</p>
              <h2>Autonomous mode is being built.</h2>
              <p>Human mode is live right now for prompt-to-swap and manual routing.</p>
              <button className="hf-btn hf-btn-secondary" onClick={() => setView('landing')}>
                Back
              </button>
            </div>
          </motion.main>
        )}

        {/* ── HUMAN / SWAP ───────────── */}
        {view === 'human' && (
          <motion.main
            key="human"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.24 }}
            className="hf-content"
          >
            {/* Top bar */}
            <div className="hf-human-topbar">
              <button className="hf-link-btn" onClick={() => { setView('landing'); setDraft(DEFAULT_DRAFT); setQuotes({}); setSelectedProvider(null); setTxStatus(null); }}>
                ← Back
              </button>
            </div>

            {/* ── SWAP ─────── */}
            {(
              <div className="hf-fadeup" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem' }}>
                <div className="hf-swap-card">
                  <button
                    className="hf-history-trigger"
                    onClick={() => setHistoryOpen((prev) => !prev)}
                    type="button"
                    aria-label="Toggle transaction history"
                    title="Transaction History"
                  >
                    🕒
                  </button>

                  <h3 className="hf-swap-title">
                    Cross-Chain <span>Swap</span>
                  </h3>
                  <p className="hf-swap-sub">Best routes • Lowest fees • Instant bridging</p>

                  {/* ── You Pay ─────────── */}
                  <div className="hf-field-group">
                    <div className="hf-field-label">
                      <span className="hf-field-kicker">You pay</span>
                      {fromUsd && (
                        <span className="hf-field-usd">≈ ${fromUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      )}
                    </div>
                    <div className="hf-field-row">
                      <input
                        className="hf-amount-input"
                        value={draft.amount}
                        onChange={(e) => {
                          setDraft((c) => ({ ...c, amount: e.target.value }));
                          setQuotes({}); setSelectedProvider(null);
                          setTxStatus(null);
                        }}
                        inputMode="decimal"
                        placeholder="0.0"
                      />
                      <TokenSelector
                        label="source"
                        selectedToken={selectedFromToken}
                        tokens={sortedFromTokenOptions}
                        chain={fromChain}
                        chains={CHAINS}
                        onSelectToken={(s) => { setDraft((c) => ({ ...c, fromTokenSymbol: s })); setQuotes({}); setSelectedProvider(null); }}
                        onSelectChain={(k) => updateFromChain(k as ChainKey)}
                        balances={formattedSourceBalances}
                      />
                    </div>
                    <div className="hf-balance-row">
                      {hasConnectedWallet && selectedSourceBalance != null ? (
                        <>
                          <span className="hf-balance-hint">
                            {selectedSourceBalance} {selectedFromToken.symbol}
                          </span>
                          <div className="hf-balance-actions">
                            {isAmountInsufficient && (
                              <span className="hf-balance-alert">Insufficient</span>
                            )}
                            <button
                              type="button"
                              className="hf-pct-btn"
                              onClick={() => {
                                if (selectedSourceBalanceRaw == null) return;
                                const half = selectedSourceBalanceRaw / 2n;
                                const amount = formatUnits(half, selectedFromToken.decimals, selectedFromToken.decimals);
                                const next = { ...draft, amount };
                                setDraft(next);
                                setQuotes({}); setSelectedProvider(null); setTxStatus(null);
                                if (debounceRef.current) clearTimeout(debounceRef.current);
                                fetchQuote(next);
                              }}
                            >50%</button>
                            <button
                              type="button"
                              className="hf-pct-btn"
                              onClick={() => {
                                if (selectedSourceBalanceRaw == null) return;
                                const amount = formatUnits(selectedSourceBalanceRaw, selectedFromToken.decimals, selectedFromToken.decimals);
                                const next = { ...draft, amount };
                                setDraft(next);
                                setQuotes({}); setSelectedProvider(null); setTxStatus(null);
                                if (debounceRef.current) clearTimeout(debounceRef.current);
                                fetchQuote(next);
                              }}
                            >MAX</button>
                          </div>
                        </>
                      ) : hasConnectedWallet ? (
                        <span className="hf-balance-hint" />
                      ) : null}
                    </div>
                  </div>

                  {/* ── Swap Direction ──── */}
                  <div className="hf-switch-anchor">
                    <button className="hf-switch-btn" onClick={swapDirections} aria-label="Switch direction">
                      <ArrowUpDown size={14} />
                    </button>
                  </div>

                  {/* ── You Receive ─────── */}
                  <div className="hf-field-group">
                    <div className="hf-field-label">
                      <span className="hf-field-kicker">You receive</span>
                      {toUsd && (
                        <span className="hf-field-usd">≈ ${toUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      )}
                    </div>
                    <div className="hf-field-row">
                      <input
                        className="hf-amount-input"
                        readOnly
                        value={bestQuote?.destinationAmount ?? ''}
                        placeholder={isQuoting ? 'Fetching...' : '0.0'}
                        style={isQuoting ? { opacity: 0.5 } : undefined}
                      />
                      <TokenSelector
                        label="destination"
                        selectedToken={selectedToToken}
                        tokens={toTokenOptions}
                        chain={toChain}
                        chains={CHAINS}
                        onSelectToken={(s) => { setDraft((c) => ({ ...c, toTokenSymbol: s })); setQuotes({}); setSelectedProvider(null); }}
                        onSelectChain={(k) => updateToChain(k as ChainKey)}
                      />
                    </div>
                  </div>

                  {/* ── Providers Section ── */}
                  <div className="hf-providers-section">
                    <p className="hf-providers-label">Route Providers</p>
                    <div className="hf-providers-list">
                      {([
                        { key: 'lifi' as ProviderKey, label: 'LI.FI', logo: '/providers/lifi.png' },
                        { key: 'relay' as ProviderKey, label: 'Relay', logo: '/providers/relay.png' },
                        { key: 'debridge' as ProviderKey, label: 'deBridge', logo: '/providers/debridge.png' }
                      ]).map(({ key, label, logo }) => {
                        const pQuote = quotes[key];
                        const pQuoting = quotingProviders.has(key);
                        const isSelected = bestQuote != null && pQuote != null && pQuote.id === bestQuote.id;
                        const canSelect = pQuote != null && !pQuoting;
                        return (
                          <div
                            key={key}
                            className={`hf-provider-row ${isSelected ? 'hf-provider-row-active' : ''} ${canSelect ? 'hf-provider-row-clickable' : ''}`}
                            onClick={() => { if (canSelect) setSelectedProvider(key); }}
                          >
                            <div className={`hf-provider-check ${isSelected ? '' : 'hf-provider-check-upcoming'}`}>
                              <Check size={10} strokeWidth={3} />
                            </div>
                            <div className="hf-provider-info">
                              <span className="hf-provider-name">
                                <img src={logo} alt={label} style={{ width: 14, height: 14, borderRadius: '4px', marginRight: '6px', verticalAlign: 'middle' }} />
                                {label}
                                <span className="hf-live-dot" />
                              </span>
                              {pQuoting ? (
                                <span className="hf-provider-meta">
                                  <Loader2 size={10} className="hf-spin" /> Quoting…
                                </span>
                              ) : pQuote ? (
                                <span className="hf-provider-meta">
                                  {formatUsd(pQuote.feeUsd)} fee • ~{pQuote.etaSeconds}s
                                  {isSelected && <span className="hf-best-badge">selected</span>}
                                </span>
                              ) : (
                                <span className="hf-provider-meta">
                                  {isValidSwapInput(draft) ? 'Ready' : 'Enter amount'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Inline Quote Details ── */}
                  {bestQuote && !isQuoting && (
                    <div className="hf-quote-details hf-fadeup">
                      <div className="hf-quote-metrics">
                        <div className="hf-quote-metric">
                          <div className="hf-quote-metric-label">Best fee</div>
                          <div className="hf-quote-metric-value">{formatUsd(bestQuote.feeUsd)}</div>
                        </div>
                        <div className="hf-quote-metric">
                          <div className="hf-quote-metric-label">Time</div>
                          <div className="hf-quote-metric-value">~{bestQuote.etaSeconds}s</div>
                        </div>
                        <div className="hf-quote-metric">
                          <div className="hf-quote-metric-label">Min out</div>
                          <div className="hf-quote-metric-value">
                            {bestQuote.destinationAmountMin ?? bestQuote.destinationAmount}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Action Button ──── */}
                  {bestQuote && !isQuoting ? (
                    <button
                      className="hf-btn hf-btn-primary hf-btn-wide"
                      onClick={executeSwap}
                      disabled={isExecuting || isAmountInsufficient || shouldGateForBalanceCheck}
                    >
                      {isExecuting ? (
                        <><Loader2 size={14} className="hf-spin" /> Executing</>
                      ) : !walletBridge ? (
                        <>Connect Wallet to Swap</>
                      ) : (
                        <><Zap size={14} /> Execute Swap</>
                      )}
                    </button>
                  ) : (
                    <button
                      className="hf-btn hf-btn-primary hf-btn-wide"
                      disabled={isQuoting || !isValidSwapInput(draft) || isAmountInsufficient || shouldGateForBalanceCheck}
                      onClick={() => fetchQuote(draft)}
                    >
                      {isQuoting ? (
                        <><Loader2 size={14} className="hf-spin" /> Getting quote</>
                      ) : (
                        <><Zap size={14} /> Get Quote</>
                      )}
                    </button>
                  )}

                  {/* ── Transaction Progress ── */}
                  {txStatus && (
                    <div className="hf-tx-progress hf-fadeup">
                      <div className="hf-tx-progress-header">
                        <span className="hf-tx-progress-title">
                          {txStatus.stage === 'completed' ? '✅ Swap Complete' :
                           txStatus.stage === 'failed' ? '❌ Swap Failed' :
                           '🔄 Transaction in progress'}
                        </span>
                        <a
                          href={`${BLOCK_EXPLORER[draft.fromChain]}${txStatus.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hf-tx-hash"
                        >
                          {txStatus.hash.slice(0, 8)}…{txStatus.hash.slice(-6)}
                          <ExternalLink size={9} style={{ marginLeft: '0.2rem', verticalAlign: 'middle' }} />
                        </a>
                      </div>

                      <div className="hf-progress-track">
                        <div
                          className={`hf-progress-fill ${txStatus.stage !== 'completed' && txStatus.stage !== 'failed' ? 'hf-progress-fill-animated' : ''}`}
                          style={{ width: `${txStatus.progress}%` }}
                        />
                      </div>

                      <div className="hf-tx-steps">
                        {TX_STAGES.map((step, i) => {
                          const currentIdx = stageIdx(txStatus.stage);
                          const isDone = i < currentIdx || txStatus.stage === 'completed';
                          const isActive = i === currentIdx && txStatus.stage !== 'completed';

                          return (
                            <div key={step.key} className="hf-tx-step">
                              <div className={`hf-tx-step-dot ${
                                isDone ? 'hf-tx-step-dot-done' :
                                isActive ? 'hf-tx-step-dot-active' :
                                'hf-tx-step-dot-pending'
                              }`}>
                                {isDone ? <CheckCircle2 size={10} /> :
                                 isActive ? <Radio size={10} /> :
                                 <span>{i + 1}</span>}
                              </div>
                              <span className={`hf-tx-step-label ${isActive ? 'hf-tx-step-label-active' : ''}`}>
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Inline messages ── */}
                  {bestQuote?.warning && (
                    <p className="hf-note hf-note-warning" style={{ marginTop: '0.7rem', width: '100%' }}>{bestQuote.warning}</p>
                  )}
                  {balanceError && (
                    <p className="hf-note hf-note-warning" style={{ marginTop: '0.7rem', width: '100%' }}>
                      Balance check warning: {balanceError}
                    </p>
                  )}
                  {error && (
                    <p className="hf-note hf-note-error" style={{ marginTop: '0.7rem', width: '100%' }}>{error}</p>
                  )}
                </div>
              </div>
            )}
          </motion.main>
        )}
      </AnimatePresence>

      {/* ── Transaction History Modal ───── */}
      {historyOpen && (
        <div className="hf-dropdown-overlay" onClick={() => setHistoryOpen(false)}>
          <div
            className="hf-dropdown-panel hf-history-modal hf-fadeup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-dropdown-header">
              <h3>Transaction History</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {activeWalletAddress && (
                  <span className="hf-history-address">
                    {activeWalletAddress.slice(0, 6)}…{activeWalletAddress.slice(-4)}
                  </span>
                )}
                <button
                  className="hf-dropdown-close"
                  onClick={() => setHistoryOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="hf-history-modal-body">
              {historyLoading ? (
                <p className="hf-history-empty"><Loader2 size={14} className="hf-spin" style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'middle' }} />Loading transactions…</p>
              ) : historyError ? (
                <p className="hf-history-empty">{historyError}</p>
              ) : historyRecords.length === 0 ? (
                <p className="hf-history-empty">No transactions yet for this wallet.</p>
              ) : (
                <div className="hf-history-list">
                  {historyRecords.map((record) => {
                    const chainKey = record.fromChain in BLOCK_EXPLORER
                      ? (record.fromChain as ChainKey)
                      : undefined;
                    const explorerUrl = chainKey
                      ? `${BLOCK_EXPLORER[chainKey]}${record.txHash}`
                      : undefined;
                    const timestamp = record.createdAt
                      ? new Date(record.createdAt).toLocaleString()
                      : 'Unknown time';

                    return (
                      <div className="hf-history-item" key={`${record.txHash}-${record.createdAt ?? 'na'}`}>
                        <div className="hf-history-row">
                          <span className="hf-history-provider">{toProviderLabel(record.provider)}</span>
                          <span className="hf-history-status">{record.status ?? 'submitted'}</span>
                        </div>
                        <div className="hf-history-row">
                          <span className="hf-history-route">
                            {record.amount} {record.fromTokenSymbol} → {record.toTokenSymbol}
                          </span>
                          <span className="hf-history-chain">
                            {record.fromChain} → {record.toChain}
                          </span>
                        </div>
                        <div className="hf-history-row">
                          <span className="hf-history-time">{timestamp}</span>
                          {explorerUrl ? (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hf-history-link"
                            >
                              View on Explorer
                            </a>
                          ) : (
                            <span className="hf-history-link hf-history-link-muted">Explorer N/A</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ──────────────────────── */}
      <footer className="hf-footer">
        <div>
          <a href="#">Docs</a>
          <a href="#">Support</a>
          <a href="#">Privacy</a>
        </div>
        <p>© 2025 HopFast</p>
      </footer>
    </div>
  );
}

export default App;
