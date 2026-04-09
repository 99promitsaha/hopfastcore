import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpDown, Check, CheckCircle2, ChevronDown, ExternalLink,
  History, Loader2, Radio, RefreshCw, X, Zap
} from 'lucide-react';
import { TokenSelector } from './TokenSelector';
import { formatUnits, formatUsd, parseUnits } from '../lib/amount';
import { CHAINS, CHAIN_BY_KEY, type ChainKey } from '../lib/chains';
import { computeUsdValue } from '../services/priceService';
import { isNativeToken } from '../lib/erc20';
import { isValidSwapInput, makeBalanceKey, getDifferentToken, resolveToken } from '../lib/swap';
import {
  BLOCK_EXPLORER, LIVE_PROVIDERS, PROVIDER_META,
  QUOTE_REFRESH_INTERVAL_S, TX_STAGES
} from '../constants';
import type { ProviderKey, SwapDraft, TxStatus, TxStage } from '../types';
import type { QuoteResult } from '../services/quoteService';
import type { PrivyWalletBridge } from './WalletConnector';

interface SwapViewProps {
  draft: SwapDraft;
  setDraft: React.Dispatch<React.SetStateAction<SwapDraft>>;
  quotes: Partial<Record<ProviderKey, QuoteResult | null>>;
  quotingProviders: Set<ProviderKey>;
  retryingProviders: Set<ProviderKey>;
  selectedProvider: ProviderKey | null;
  setSelectedProvider: (p: ProviderKey) => void;
  quoteCountdown: number | null;
  isQuoting: boolean;
  bestQuote: QuoteResult | null;
  fetchQuote: (draft: SwapDraft) => void;
  triggerFetchImmediate: (draft: SwapDraft) => void;
  prices: Record<string, number>;
  tokenBalances: Record<string, bigint>;
  formattedSourceBalances: Record<string, string>;
  balanceError: string;
  isRefreshingBalances: boolean;
  walletBridge: PrivyWalletBridge | null;
  activeWalletAddress: string | null;
  isExecuting: boolean;
  txStatus: TxStatus | null;
  error: string;
  executeSwap: () => void;
  onBack: () => void;
  onToggleHistory: () => void;
  onTxStatusClear: () => void;
}

export function SwapView({
  draft, setDraft,
  quotes, quotingProviders, retryingProviders, selectedProvider, setSelectedProvider,
  quoteCountdown, isQuoting, bestQuote,
  fetchQuote, triggerFetchImmediate,
  prices, tokenBalances, formattedSourceBalances, balanceError, isRefreshingBalances,
  walletBridge, activeWalletAddress,
  isExecuting, txStatus, error,
  executeSwap, onBack, onToggleHistory, onTxStatusClear,
}: SwapViewProps) {
  const [showFromChainModal, setShowFromChainModal] = useState(false);
  const [showToChainModal, setShowToChainModal] = useState(false);

  const fromChain = CHAIN_BY_KEY[draft.fromChain];
  const toChain = CHAIN_BY_KEY[draft.toChain];
  const fromTokenOptions = useMemo(() => fromChain.tokens, [fromChain]);
  const toTokenOptions = useMemo(() => toChain.tokens, [toChain]);

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

  const selectedFromToken = fromTokenOptions.find((t) => t.symbol === draft.fromTokenSymbol) ?? fromTokenOptions[0];
  const selectedToToken = toTokenOptions.find((t) => t.symbol === draft.toTokenSymbol) ?? toTokenOptions[0];
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

  const isGasTokenRisk =
    hasConnectedWallet
    && isNativeToken(selectedFromToken.address)
    && requestedAmountRaw != null
    && selectedSourceBalanceRaw != null
    && selectedSourceBalanceRaw > 0n
    && requestedAmountRaw * 100n >= selectedSourceBalanceRaw * 95n;

  const fromUsd = computeUsdValue(prices, draft.fromTokenSymbol, draft.amount);
  const toUsd = bestQuote?.destinationAmount
    ? computeUsdValue(prices, draft.toTokenSymbol, bestQuote.destinationAmount)
    : null;

  const swapDirections = () => {
    const next: SwapDraft = {
      ...draft,
      fromChain: draft.toChain,
      toChain: draft.fromChain,
      fromTokenSymbol: resolveToken(draft.toChain, draft.toTokenSymbol),
      toTokenSymbol: resolveToken(draft.fromChain, draft.fromTokenSymbol),
    };
    setDraft(next);
    onTxStatusClear();
    triggerFetchImmediate(next);
  };

  const updateFromChain = (chain: ChainKey) => {
    const isSameChain = draft.toChain === chain;
    const fromTokenSymbol = resolveToken(chain, undefined, draft.fromTokenSymbol);
    const toTokenSymbol = isSameChain
      ? getDifferentToken(chain, fromTokenSymbol)
      : resolveToken(draft.toChain, undefined, draft.toTokenSymbol);
    const next: SwapDraft = { ...draft, fromChain: chain, fromTokenSymbol, toTokenSymbol };
    setDraft(next);
    triggerFetchImmediate(next);
  };

  const updateToChain = (chain: ChainKey) => {
    const isSameChain = draft.fromChain === chain;
    const fromTokenSymbol = resolveToken(draft.fromChain, undefined, draft.fromTokenSymbol);
    const toTokenSymbol = isSameChain
      ? getDifferentToken(chain, fromTokenSymbol)
      : resolveToken(chain, undefined, draft.toTokenSymbol);
    const next: SwapDraft = { ...draft, toChain: chain, fromTokenSymbol, toTokenSymbol };
    setDraft(next);
    triggerFetchImmediate(next);
  };

  const stageIdx = (stage: TxStage | undefined) =>
    TX_STAGES.findIndex((s) => s.key === stage);

  return (
    <motion.div
      key="swap"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
    >
      <div className="hf-fadeup hf-swap-wrap">
        <div className="hf-swap-card">
          {/* Back — top-left */}
          <button
            className="hf-card-corner-btn"
            onClick={onBack}
            type="button"
            aria-label="Back to home"
            title="Back"
          >
            <X size={15} strokeWidth={2.5} />
          </button>

          {/* History — top-right */}
          <button
            className="hf-card-corner-btn hf-card-corner-btn--right"
            onClick={onToggleHistory}
            type="button"
            aria-label="Transaction history"
            title="Transaction History"
          >
            <History size={15} strokeWidth={2} />
          </button>

          <h3 className="hf-swap-title">Hop. <span>At Light Speed 🐰</span></h3>
          <div className="hf-earn-powered">
            Powered by
            <img src="/providers/lifi.png" alt="LI.FI" className="hf-earn-powered-logo" />
            <img src="/providers/squid.ico" alt="Squid" className="hf-earn-powered-logo" />
            <img src="/providers/debridge.png" alt="deBridge" className="hf-earn-powered-logo" />
          </div>

          {/* Quote Refresh Countdown */}
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

          {/* Unified swap fields card */}
          <div className="hf-swap-fields">

            {/* You Pay */}
            <div className="hf-field-group hf-field-group--top">
              <div className="hf-field-header">
                <span className="hf-field-kicker">You pay</span>
                <button
                  className="hf-chain-btn"
                  onClick={() => setShowFromChainModal(true)}
                  aria-label="Select source network"
                >
                  <img
                    src={fromChain.logoURI}
                    alt={fromChain.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {fromChain.name}
                  <ChevronDown size={11} />
                </button>
              </div>
              <div className="hf-field-row">
                <input
                  className="hf-amount-input"
                  value={draft.amount}
                  onChange={(e) => {
                    setDraft((c) => ({ ...c, amount: e.target.value }));
                    onTxStatusClear();
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
                  chainModalOpen={showFromChainModal}
                  onChainModalClose={() => setShowFromChainModal(false)}
                  balances={formattedSourceBalances}
                />
              </div>
              <div className="hf-field-foot">
                {fromUsd ? (
                  <span className="hf-field-usd-main">≈ ${fromUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                ) : <span />}
                {hasConnectedWallet && selectedSourceBalance == null && isBalanceUnknown && (
                  <span className="hf-skeleton hf-balance-skeleton" aria-hidden="true">&nbsp;</span>
                )}
                {hasConnectedWallet && selectedSourceBalance != null && (
                  <div className="hf-balance-actions">
                    {isAmountInsufficient && <span className="hf-balance-alert">Insufficient</span>}
                    <span className="hf-balance-hint">{selectedSourceBalance} {selectedFromToken.symbol}</span>
                    <button type="button" className="hf-pct-btn" onClick={() => {
                      if (selectedSourceBalanceRaw == null) return;
                      const next = { ...draft, amount: formatUnits(selectedSourceBalanceRaw / 2n, selectedFromToken.decimals, selectedFromToken.decimals) };
                      setDraft(next); triggerFetchImmediate(next); onTxStatusClear();
                    }}>50%</button>
                    <button type="button" className="hf-pct-btn" onClick={() => {
                      if (selectedSourceBalanceRaw == null) return;
                      const next = { ...draft, amount: formatUnits(selectedSourceBalanceRaw, selectedFromToken.decimals, selectedFromToken.decimals) };
                      setDraft(next); triggerFetchImmediate(next); onTxStatusClear();
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

            {/* Swap Direction — sits on the divider between the two fields */}
            <div className="hf-switch-anchor">
              <button className="hf-switch-btn" onClick={swapDirections} aria-label="Switch direction">
                <ArrowUpDown size={14} />
              </button>
            </div>

            {/* You Receive */}
            <div className="hf-field-group hf-field-group--bottom">
              <div className="hf-field-header">
                <span className="hf-field-kicker">You receive</span>
                <button
                  className="hf-chain-btn"
                  onClick={() => setShowToChainModal(true)}
                  aria-label="Select destination network"
                >
                  <img
                    src={toChain.logoURI}
                    alt={toChain.name}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {toChain.name}
                  <ChevronDown size={11} />
                </button>
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
                  onSelectToken={(s) => {
                    const next = { ...draft, toTokenSymbol: s };
                    setDraft(next);
                    triggerFetchImmediate(next);
                  }}
                  onSelectChain={(k) => updateToChain(k as ChainKey)}
                  chainModalOpen={showToChainModal}
                  onChainModalClose={() => setShowToChainModal(false)}
                />
              </div>
              <div className="hf-field-foot">
                {toUsd ? (
                  <span className="hf-field-usd-main">≈ ${toUsd.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                ) : <span />}
              </div>
            </div>

          </div>{/* end .hf-swap-fields */}

          {/* Providers */}
          <div className="hf-providers-section">
            <p className="hf-providers-label">Route Providers</p>
            <div className="hf-providers-list">
              {PROVIDER_META.map(({ key, label, logo }) => {
                const pQuote = quotes[key];
                const pQuoting = quotingProviders.has(key);
                const pRetrying = retryingProviders.has(key);
                const pLoading = pQuoting || pRetrying;
                const isSelected = bestQuote != null && pQuote != null && pQuote.id === bestQuote.id;
                const canSelect = pQuote != null && !pLoading;
                const definitivelyFailed = !pLoading && key in quotes && quotes[key] === null;
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
                        <span className="hf-provider-meta hf-skeleton" aria-hidden="true">&nbsp;</span>
                      ) : pRetrying ? (
                        <span className="hf-provider-meta hf-provider-meta-retrying">
                          <Loader2 size={9} className="hf-spin" /> Retrying…
                        </span>
                      ) : pQuote ? (
                        <span className="hf-provider-meta">
                          {formatUsd(pQuote.feeUsd)} fee • ~{pQuote.etaSeconds}s
                          {isSelected && <span className="hf-best-badge">selected</span>}
                        </span>
                      ) : definitivelyFailed ? (
                        <span className="hf-provider-meta hf-provider-meta-noroute">
                          No route · refreshing in {quoteCountdown ?? '—'}s
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

          {/* Fee summary + action */}
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

          {/* Transaction Progress */}
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
    </motion.div>
  );
}
