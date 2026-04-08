import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpDown, Bot, Check, CheckCircle2, ExternalLink,
  Loader2, Radio, UserRound, Zap
} from 'lucide-react';
import {
  DemoWalletConnector, PrivyWalletConnector, usePrivyAuth,
  type PrivyWalletBridge
} from './components/WalletConnector';
import { TokenSelector } from './components/TokenSelector';
import { formatUsd } from './lib/amount';
import { CHAINS, CHAIN_BY_KEY, getDefaultToken, getToken, type ChainKey } from './lib/chains';
import { getSwapQuote, type QuoteResult } from './services/quoteService';
import { getTokenPrices, computeUsdValue } from './services/priceService';

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

type TxStage = 'submitted' | 'confirming' | 'bridging' | 'completed' | 'failed';

interface TxStatus {
  hash: string;
  stage: TxStage;
  progress: number;
}

const TX_STAGES: { key: TxStage; label: string }[] = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'bridging', label: 'Bridging' },
  { key: 'completed', label: 'Complete' }
];

type ProviderKey = 'lifi' | 'relay';

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

function App() {
  const [view, setView] = useState<EntryView>('landing');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBridge, setWalletBridge] = useState<PrivyWalletBridge | null>(null);
  const [draft, setDraft] = useState<SwapDraft>(DEFAULT_DRAFT);
  const [quotes, setQuotes] = useState<Partial<Record<ProviderKey, QuoteResult | null>>>({});
  const [quotingProviders, setQuotingProviders] = useState<Set<ProviderKey>>(new Set());
  const [error, setError] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});

  // Best quote = lowest fee among available results
  const bestQuote: QuoteResult | null = (() => {
    const available = (['lifi', 'relay'] as ProviderKey[])
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
  const toTokenOptions = useMemo(() => toChain.tokens, [toChain]);
  const selectedFromToken = fromTokenOptions.find((t) => t.symbol === draft.fromTokenSymbol) ?? fromTokenOptions[0];
  const selectedToToken = toTokenOptions.find((t) => t.symbol === draft.toTokenSymbol) ?? toTokenOptions[0];

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

  // ── Gate navigation: require Privy login before entering Human view ──
  const handleHumanClick = () => {
    if (HAS_PRIVY && !privyAuth.authenticated) {
      privyAuth.login();
      return;
    }
    setView('human');
  };

  // ── Debounced auto-quote (fetches from all live providers in parallel) ──
  const fetchQuote = useCallback(async (currentDraft: SwapDraft) => {
    if (!isValidSwapInput(currentDraft)) {
      setQuotes({});
      return;
    }

    // Abort any in-flight requests
    (['lifi', 'relay'] as ProviderKey[]).forEach((p) => {
      quoteAbortRefs.current[p]?.abort();
      quoteAbortRefs.current[p] = new AbortController();
    });

    setQuotingProviders(new Set(['lifi', 'relay']));
    setError('');

    const walletAddr = walletBridge?.address ?? walletAddress;

    (['lifi', 'relay'] as ProviderKey[]).forEach(async (provider) => {
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
  }, [walletAddress, walletBridge?.address]);

  useEffect(() => {
    setQuotes({});
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

  // ── If user logs in via Privy while on landing, enter human view ──
  useEffect(() => {
    if (HAS_PRIVY && privyAuth.authenticated && view === 'landing') {
      setView('human');
    }
  }, [privyAuth.authenticated]);

  // ── Transaction progress ────────────────────────────
  const simulateTxProgress = (hash: string) => {
    setTxStatus({ hash, stage: 'submitted', progress: 10 });
    setTimeout(() => setTxStatus((p) => p ? { ...p, stage: 'confirming', progress: 35 } : null), 2500);
    setTimeout(() => setTxStatus((p) => p ? { ...p, stage: 'bridging', progress: 65 } : null), 6000);
    setTimeout(() => setTxStatus((p) => p ? { ...p, stage: 'completed', progress: 100 } : null), 12000);
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

      const txHash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: walletBridge.address,
          to: bestQuote.transactionRequest.to,
          data: bestQuote.transactionRequest.data,
          value: toHexQuantity(bestQuote.transactionRequest.value) ?? '0x0',
          gas: toHexQuantity(bestQuote.transactionRequest.gasLimit),
          gasPrice: toHexQuantity(bestQuote.transactionRequest.gasPrice)
        }]
      })) as string;

      simulateTxProgress(txHash);
      await recordSwap(txHash);
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
    setQuotes({});
    setTxStatus(null);
  };

  const updateFromChain = (chain: ChainKey) => {
    setDraft((c) => {
      const next = c.toChain === chain ? getAnotherChain(chain) : c.toChain;
      return { ...c, fromChain: chain, toChain: next,
        fromTokenSymbol: resolveToken(chain, undefined, c.fromTokenSymbol),
        toTokenSymbol: resolveToken(next, undefined, c.toTokenSymbol) };
    });
    setQuotes({});
  };

  const updateToChain = (chain: ChainKey) => {
    setDraft((c) => {
      const next = c.fromChain === chain ? getAnotherChain(chain) : c.fromChain;
      return { ...c, fromChain: next, toChain: chain,
        fromTokenSymbol: resolveToken(next, undefined, c.fromTokenSymbol),
        toTokenSymbol: resolveToken(chain, undefined, c.toTokenSymbol) };
    });
    setQuotes({});
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
                <div key={chain.key} className="hf-chain-logo-item">
                  <img src={chain.logoURI} alt={chain.name} />
                  <span>{chain.name}</span>
                </div>
              ))}
              <div className="hf-chain-logo-item hf-chain-logo-more">
                <span className="hf-chain-more-label">&amp; more soon</span>
              </div>
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
              <button className="hf-link-btn" onClick={() => setView('landing')}>
                ← Back
              </button>
            </div>

            {/* ── SWAP ─────── */}
            {(
              <div className="hf-fadeup" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem' }}>
                <div className="hf-swap-card">
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
                          setQuotes({});
                          setTxStatus(null);
                        }}
                        inputMode="decimal"
                        placeholder="0.0"
                      />
                      <TokenSelector
                        label="source"
                        selectedToken={selectedFromToken}
                        tokens={fromTokenOptions}
                        chain={fromChain}
                        chains={CHAINS}
                        onSelectToken={(s) => { setDraft((c) => ({ ...c, fromTokenSymbol: s })); setQuotes({}); }}
                        onSelectChain={(k) => updateFromChain(k as ChainKey)}
                      />
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
                        onSelectToken={(s) => { setDraft((c) => ({ ...c, toTokenSymbol: s })); setQuotes({}); }}
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
                        { key: 'relay' as ProviderKey, label: 'Relay', logo: '/providers/relay.png' }
                      ]).map(({ key, label, logo }) => {
                        const pQuote = quotes[key];
                        const pQuoting = quotingProviders.has(key);
                        const isBest = bestQuote != null && pQuote != null && pQuote.id === bestQuote.id;
                        return (
                          <div key={key} className={`hf-provider-row ${isBest ? 'hf-provider-row-active' : ''}`}>
                            <div className={`hf-provider-check ${isBest ? '' : 'hf-provider-check-upcoming'}`}>
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
                                  {isBest && <span className="hf-best-badge">best</span>}
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

                      {/* Upcoming providers */}
                      {([
                        { label: 'Socket', logo: '/providers/socket.png' },
                        { label: 'Squid', logo: '/providers/squid.ico' },
                        { label: 'deBridge', logo: '/providers/debridge.png' }
                      ]).map(({ label, logo }) => (
                        <div key={label} className="hf-provider-row">
                          <div className="hf-provider-check hf-provider-check-upcoming">
                            <Check size={10} strokeWidth={3} />
                          </div>
                          <div className="hf-provider-info">
                            <span className="hf-provider-name" style={{ opacity: 0.4 }}>
                              <img src={logo} alt={label} style={{ width: 14, height: 14, borderRadius: '4px', marginRight: '6px', verticalAlign: 'middle' }} />
                              {label}
                            </span>
                            <span className="hf-provider-upcoming-label">Coming soon</span>
                          </div>
                        </div>
                      ))}
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
                      disabled={isExecuting}
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
                      disabled={isQuoting || !isValidSwapInput(draft)}
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
                  {error && (
                    <p className="hf-note hf-note-error" style={{ marginTop: '0.7rem', width: '100%' }}>{error}</p>
                  )}
                </div>
              </div>
            )}
          </motion.main>
        )}
      </AnimatePresence>

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
