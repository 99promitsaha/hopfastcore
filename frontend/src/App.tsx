import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpDown, Bot, Check, CheckCircle2, ExternalLink,
  Info, Loader2, Radio, RefreshCw, UserRound, X, Zap
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
const QUOTE_REFRESH_INTERVAL_S = 30;

const BLOCK_EXPLORER: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  bsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  monad: 'https://monadscan.com/tx/'
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

type ProviderKey = 'lifi' | 'relay' | 'debridge' | 'squid';
const IS_PROD = import.meta.env.PROD;
const LIVE_PROVIDERS: ProviderKey[] = IS_PROD
  ? ['lifi', 'squid', 'debridge']
  : ['lifi', 'squid', 'debridge', 'relay'];
const HISTORY_LIMIT = 50;
const API_BASE_URL = (import.meta.env.VITE_HOPFAST_API_BASE_URL ?? '').replace(/\/$/, '') || 'http://localhost:8080/api';

const PROVIDER_META: { key: ProviderKey; label: string; logo: string; issues: boolean }[] = [
  { key: 'lifi',     label: 'LI.FI',    logo: '/providers/lifi.png',     issues: false },
  { key: 'squid',    label: 'Squid',    logo: '/providers/squid.ico',    issues: false },
  { key: 'debridge', label: 'deBridge', logo: '/providers/debridge.png', issues: false },
  { key: 'relay',    label: 'Relay',    logo: '/providers/relay.png',    issues: true  },
];

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

/** Returns a different token symbol on the same chain, avoiding the excluded symbol. */
function getDifferentToken(chain: ChainKey, excludeSymbol: string): string {
  const tokens = CHAIN_BY_KEY[chain].tokens;
  const other = tokens.find((t) => t.symbol !== excludeSymbol);
  return other?.symbol ?? tokens[0].symbol;
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
  // Same chain + same token = nothing to swap
  if (draft.fromChain === draft.toChain && draft.fromTokenSymbol === draft.toTokenSymbol) return false;
  const amount = Number(draft.amount);
  return Number.isFinite(amount) && amount > 0;
}

// ERC-20 allowance selector: allowance(owner, spender)
const ALLOWANCE_SELECTOR = '0xdd62ed3e';
// ERC-20 approve selector: approve(spender, amount)
const APPROVE_SELECTOR = '0x095ea7b3';

function encodeAllowanceCall(owner: string, spender: string): string {
  const o = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return `${ALLOWANCE_SELECTOR}${o}${s}`;
}

function encodeApproveCall(spender: string, approveAmount: bigint): string {
  const s = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amount = approveAmount.toString(16).padStart(64, '0');
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

  // Approve only the exact amount needed for this swap
  const approveData = encodeApproveCall(spenderAddress, requiredAmount);
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
  const [quoteCountdown, setQuoteCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval>>();
  const [historyRecords, setHistoryRecords] = useState<UserTransactionRecord[]>([]);

  const bestQuote = useMemo((): QuoteResult | null => {
    if (selectedProvider && quotes[selectedProvider]) return quotes[selectedProvider]!;
    const available = LIVE_PROVIDERS
      .map((p) => quotes[p])
      .filter((q): q is QuoteResult => q != null);
    if (!available.length) return null;
    return available.reduce((best, q) => (q.feeUsd < best.feeUsd ? q : best));
  }, [selectedProvider, quotes]);

  const isQuoting = quotingProviders.size > 0;

  const privyAuth = usePrivyAuth();

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const quoteAbortRefs = useRef<Partial<Record<ProviderKey, AbortController>>>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;

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

  // Warn when spending ≥95% of the native gas token — leaves nothing for the tx fee
  const isGasTokenRisk =
    hasConnectedWallet
    && isNativeToken(selectedFromToken.address)
    && requestedAmountRaw != null
    && selectedSourceBalanceRaw != null
    && selectedSourceBalanceRaw > 0n
    && requestedAmountRaw * 100n >= selectedSourceBalanceRaw * 95n;

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

  const fetchQuote = useCallback(async (currentDraft: SwapDraft) => {
    if (!isValidSwapInput(currentDraft)) {
      setQuotes({}); setSelectedProvider(null);
      return;
    }

    LIVE_PROVIDERS.forEach((p) => {
      quoteAbortRefs.current[p]?.abort();
      quoteAbortRefs.current[p] = new AbortController();
    });

    setQuotingProviders(new Set(LIVE_PROVIDERS));
    setError('');
    // Reset countdown while quoting
    setQuoteCountdown(null);

    const walletAddr = activeWalletAddress;
    let resolvedCount = 0;

    LIVE_PROVIDERS.forEach(async (provider) => {
      try {
        const result = await getSwapQuote({ ...currentDraft, walletAddress: walletAddr }, provider);
        setQuotes((prev) => ({ ...prev, [provider]: result }));
      } catch {
        setQuotes((prev) => ({ ...prev, [provider]: null }));
      } finally {
        resolvedCount++;
        setQuotingProviders((prev) => {
          const next = new Set(prev);
          next.delete(provider);
          // Start countdown when all providers have resolved
          if (next.size === 0 && resolvedCount === LIVE_PROVIDERS.length) {
            setQuoteCountdown(QUOTE_REFRESH_INTERVAL_S);
          }
          return next;
        });
      }
    });
  }, [activeWalletAddress]);

  // Debounce only for amount typing — chain/token changes trigger fetchQuote directly
  useEffect(() => {
    if (!isValidSwapInput(draft)) {
      setQuotes({}); setSelectedProvider(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(draft), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amount]);

  // Re-quote when wallet connects so quotes include the wallet address
  useEffect(() => {
    if (activeWalletAddress && isValidSwapInput(draftRef.current)) {
      fetchQuote(draftRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWalletAddress]);

  // Countdown timer — ticks every second after quotes are fetched
  useEffect(() => {
    if (quoteCountdown == null || quoteCountdown <= 0) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    countdownRef.current = setInterval(() => {
      setQuoteCountdown((prev) => {
        if (prev == null || prev <= 1) {
          // Time's up — trigger a refresh
          if (isValidSwapInput(draftRef.current) && !isExecuting) {
            fetchQuote(draftRef.current);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [quoteCountdown, isExecuting, fetchQuote]);

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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view]);

  const statusPollerRef = useRef<{ stop: () => void } | null>(null);

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
      await recordSwap(txHash);

      // Clear the form so the old amount doesn't linger and trigger auto-requotes
      setDraft((c) => ({ ...c, amount: '' }));
      setQuotes({});
      setSelectedProvider(null);

      // Refresh balance at 8s, 20s, 45s — spread to catch confirmation on any chain speed
      [8000, 20000, 45000].forEach((delay) => {
        setTimeout(() => setBalanceRefreshTick((t) => t + 1), delay);
      });
    } catch (caughtError) {
      setTxStatus((p) => p ? { ...p, stage: 'failed', progress: p.progress } : null);
      setError(caughtError instanceof Error ? caughtError.message : 'Swap execution failed.');
    } finally {
      setIsExecuting(false);
    }
  };

  const triggerFetchImmediate = (next: SwapDraft) => {
    setQuotes({}); setSelectedProvider(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isValidSwapInput(next)) fetchQuote(next);
  };

  const swapDirections = () => {
    const next: SwapDraft = {
      ...draft,
      fromChain: draft.toChain,
      toChain: draft.fromChain,
      fromTokenSymbol: resolveToken(draft.toChain, draft.toTokenSymbol),
      toTokenSymbol: resolveToken(draft.fromChain, draft.fromTokenSymbol),
    };
    setDraft(next);
    setTxStatus(null);
    triggerFetchImmediate(next);
  };

  const updateFromChain = (chain: ChainKey) => {
    const isSameChain = draft.toChain === chain;
    // If switching to same chain as destination, pick a different to-token to avoid same-token swap
    const fromTokenSymbol = resolveToken(chain, undefined, draft.fromTokenSymbol);
    const toTokenSymbol = isSameChain
      ? getDifferentToken(chain, fromTokenSymbol)
      : resolveToken(draft.toChain, undefined, draft.toTokenSymbol);
    const next: SwapDraft = {
      ...draft,
      fromChain: chain,
      fromTokenSymbol,
      toTokenSymbol,
    };
    setDraft(next);
    triggerFetchImmediate(next);
  };

  const updateToChain = (chain: ChainKey) => {
    const isSameChain = draft.fromChain === chain;
    // If switching to same chain as source, pick a different to-token to avoid same-token swap
    const fromTokenSymbol = resolveToken(draft.fromChain, undefined, draft.fromTokenSymbol);
    const toTokenSymbol = isSameChain
      ? getDifferentToken(chain, fromTokenSymbol)
      : resolveToken(chain, undefined, draft.toTokenSymbol);
    const next: SwapDraft = {
      ...draft,
      toChain: chain,
      fromTokenSymbol,
      toTokenSymbol,
    };
    setDraft(next);
    triggerFetchImmediate(next);
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
                Cross-chain swaps powered by the fastest liquidity routes. Bridge any token across 4+ chains in seconds by comparing quotes from LI.FI, Squid, deBridge &amp; more.
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

            <div className="hf-chain-live-row">
              <span className="hf-chain-live-label">Live on</span>
              <div className="hf-chain-avatars">
                {CHAINS.map((chain) => (
                  <img key={chain.key} className="hf-chain-avatar" src={chain.logoURI} alt={chain.name} title={chain.name} />
                ))}
              </div>
              <span className="hf-chain-more-text">& more 🔜</span>
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

            <div className="hf-fadeup hf-swap-wrap">
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

                  <h3 className="hf-swap-title">Hop. <span>At Light Speed.</span></h3>
                  <p className="hf-swap-sub">
                    {draft.fromChain === draft.toChain
                      ? 'Swap tokens on the same chain. Best DEX route, zero extra fees.'
                      : 'We show you the best ones. You just hit swap. At zero extra fees.'}
                  </p>

                  {/* ── Dynamic Island: Quote Refresh Countdown ── */}
                  <AnimatePresence>
                    {quoteCountdown != null && quoteCountdown > 0 && !isQuoting && (
                      <motion.div
                        className="hf-quote-island"
                        initial={{ opacity: 0, y: -8, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      >
                        <svg className="hf-quote-island-ring" viewBox="0 0 24 24">
                          <circle
                            className="hf-quote-island-ring-track"
                            cx="12" cy="12" r="10"
                            fill="none" strokeWidth="2"
                          />
                          <circle
                            className="hf-quote-island-ring-fill"
                            cx="12" cy="12" r="10"
                            fill="none" strokeWidth="2.5"
                            strokeDasharray={2 * Math.PI * 10}
                            strokeDashoffset={2 * Math.PI * 10 * (1 - quoteCountdown / QUOTE_REFRESH_INTERVAL_S)}
                            strokeLinecap="round"
                          />
                        </svg>
                        <RefreshCw size={10} className="hf-quote-island-icon" />
                        <span className="hf-quote-island-text">
                          Quotes refresh in <strong>{quoteCountdown}s</strong>
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── You Pay ─────────── */}
                  <div className="hf-field-group">
                    <span className="hf-field-kicker">You pay</span>
                    <div className="hf-field-row">
                      <input
                        className="hf-amount-input"
                        value={draft.amount}
                        onChange={(e) => {
                          setDraft((c) => ({ ...c, amount: e.target.value }));
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
                        onSelectToken={(s) => {
                          const next = { ...draft, fromTokenSymbol: s };
                          setDraft(next);
                          triggerFetchImmediate(next);
                        }}
                        onSelectChain={(k) => updateFromChain(k as ChainKey)}
                        balances={formattedSourceBalances}
                      />
                    </div>
                    <div className="hf-field-foot">
                      {fromUsd ? (
                        <span className="hf-field-usd-main">≈ ${fromUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : <span />}
                      {hasConnectedWallet && selectedSourceBalance != null && (
                        <div className="hf-balance-actions">
                          {isAmountInsufficient && <span className="hf-balance-alert">Insufficient</span>}
                          <span className="hf-balance-hint">{selectedSourceBalance} {selectedFromToken.symbol}</span>
                          <button type="button" className="hf-pct-btn" onClick={() => {
                            if (selectedSourceBalanceRaw == null) return;
                            const next = { ...draft, amount: formatUnits(selectedSourceBalanceRaw / 2n, selectedFromToken.decimals, selectedFromToken.decimals) };
                            setDraft(next); triggerFetchImmediate(next); setTxStatus(null);
                          }}>50%</button>
                          <button type="button" className="hf-pct-btn" onClick={() => {
                            if (selectedSourceBalanceRaw == null) return;
                            const next = { ...draft, amount: formatUnits(selectedSourceBalanceRaw, selectedFromToken.decimals, selectedFromToken.decimals) };
                            setDraft(next); triggerFetchImmediate(next); setTxStatus(null);
                          }}>MAX</button>
                        </div>
                      )}
                    </div>
                    {isGasTokenRisk && (
                      <p className="hf-gas-warning">
                        ⚠ You're spending nearly all your {selectedFromToken.symbol}. Keep some for gas or this transaction will fail.
                      </p>
                    )}
                  </div>

                  {/* ── Swap Direction ──── */}
                  <div className="hf-switch-anchor">
                    <button className="hf-switch-btn" onClick={swapDirections} aria-label="Switch direction">
                      <ArrowUpDown size={14} />
                    </button>
                  </div>

                  {/* ── You Receive ─────── */}
                  <div className="hf-field-group">
                    <span className="hf-field-kicker">You receive</span>
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
                        onSelectToken={(s) => {
                          const next = { ...draft, toTokenSymbol: s };
                          setDraft(next);
                          triggerFetchImmediate(next);
                        }}
                        onSelectChain={(k) => updateToChain(k as ChainKey)}
                      />
                    </div>
                    <div className="hf-field-foot">
                      {toUsd ? (
                        <span className="hf-field-usd-main">≈ ${toUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : <span />}
                    </div>
                  </div>

                  {/* ── Providers Section ── */}
                  <div className="hf-providers-section">
                    <p className="hf-providers-label">Route Providers</p>
                    <div className="hf-providers-list">
                      {PROVIDER_META.map(({ key, label, logo, issues }) => {
                        const isDisabled = IS_PROD && key === 'relay';
                        const pQuote = quotes[key];
                        const pQuoting = quotingProviders.has(key);
                        const isSelected = bestQuote != null && pQuote != null && pQuote.id === bestQuote.id;
                        const canSelect = pQuote != null && !pQuoting && !isDisabled;
                        return (
                          <div
                            key={key}
                            className={`hf-provider-row ${isSelected ? 'hf-provider-row-active' : ''} ${canSelect ? 'hf-provider-row-clickable' : ''} ${isDisabled ? 'hf-provider-row-disabled' : ''}`}
                            onClick={() => { if (canSelect) setSelectedProvider(key); }}
                          >
                            <div className={`hf-provider-check ${isSelected ? '' : 'hf-provider-check-upcoming'}`}>
                              <Check size={10} strokeWidth={3} />
                            </div>
                            <div className="hf-provider-info">
                              <span className="hf-provider-name">
                                <img src={logo} alt={label} style={{ width: 14, height: 14, borderRadius: '4px', marginRight: '6px', verticalAlign: 'middle' }} />
                                {label}
                                <span className={issues ? 'hf-live-dot hf-live-dot-warning' : 'hf-live-dot'} />
                                {issues && (
                                  <span className="hf-provider-issues-hint" title="Experiencing issues. Back shortly.">
                                    <Info size={12} />
                                  </span>
                                )}
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
                              ) : isDisabled ? (
                                <span className="hf-provider-meta">Unavailable</span>
                              ) : key in quotes && quotes[key] === null ? (
                                <span className="hf-provider-meta hf-provider-meta-noroute">
                                  No route found · retrying in {quoteCountdown ?? '—'}s
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

                  {/* ── Fee summary + action ── */}
                  {bestQuote && !isQuoting ? (
                    <>
                      <div className="hf-fee-summary hf-fadeup">
                        <div className="hf-fee-row">
                          <span className="hf-fee-label">Network &amp; route fee</span>
                          <span className="hf-fee-value">{formatUsd(bestQuote.feeUsd)}</span>
                        </div>
                        <div className="hf-fee-row">
                          <span className="hf-fee-label">HopFast fee</span>
                          <span className="hf-fee-value hf-fee-free">Free <Check size={10} strokeWidth={3} /></span>
                        </div>
                        <div className="hf-fee-row">
                          <span className="hf-fee-label">Min. received</span>
                          <span className="hf-fee-value">{bestQuote.destinationAmountMin ?? bestQuote.destinationAmount} · ~{bestQuote.etaSeconds}s</span>
                        </div>
                      </div>
                      <button
                        className="hf-btn hf-btn-primary hf-btn-wide"
                        onClick={executeSwap}
                        disabled={isExecuting || isAmountInsufficient || shouldGateForBalanceCheck}
                      >
                        {isExecuting ? (
                          <><Loader2 size={14} className="hf-spin" /> Bridging…</>
                        ) : !walletBridge ? (
                          <>Connect wallet to bridge</>
                        ) : (
                          <><Zap size={14} /> Bridge now</>
                        )}
                      </button>
                    </>
                  ) : (
                    <button
                      className="hf-btn hf-btn-primary hf-btn-wide"
                      disabled={isQuoting || !isValidSwapInput(draft) || isAmountInsufficient || shouldGateForBalanceCheck}
                      onClick={() => fetchQuote(draft)}
                    >
                      {isQuoting ? (
                        <><Loader2 size={14} className="hf-spin" /> Finding best route…</>
                      ) : (
                        <><Zap size={14} /> Get quote</>
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

                  {bestQuote?.warning && (
                    <p className="hf-note hf-note-warning">{bestQuote.warning}</p>
                  )}
                  {balanceError && (
                    <p className="hf-note hf-note-warning">Balance check: {balanceError}</p>
                  )}
                  {error && (
                    <p className="hf-note hf-note-error">{error}</p>
                  )}
                </div>
            </div>
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
                            {record.fromChain === record.toChain
                              ? record.fromChain
                              : `${record.fromChain} → ${record.toChain}`}
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
        <p>© 2026 HopFast</p>
      </footer>
    </div>
  );
}

export default App;
