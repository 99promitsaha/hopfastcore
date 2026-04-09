import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  DemoWalletConnector, PrivyWalletConnector, usePrivyAuth,
  type PrivyWalletBridge
} from './components/WalletConnector';
import { parseUnits } from './lib/amount';
import { makeBalanceKey } from './lib/swap';
import { computeUsdValue } from './services/priceService';
import { LandingView } from './components/LandingView';
import { AgentView } from './components/AgentView';
import { SwapView } from './components/SwapView';
import { TransactionHistoryModal } from './components/TransactionHistoryModal';
import { CHAIN_BY_KEY } from './lib/chains';
import { usePrices } from './hooks/usePrices';
import { useTokenBalances } from './hooks/useTokenBalances';
import { useSwapQuotes } from './hooks/useSwapQuotes';
import { useSwapExecution } from './hooks/useSwapExecution';
import { useTransactionHistory } from './hooks/useTransactionHistory';
import { DEFAULT_DRAFT, HAS_PRIVY } from './constants';
import type { EntryView, SwapDraft } from './types';

function App() {
  const [view, setView] = useState<EntryView>('landing');
  const pendingLogin = useRef(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBridge, setWalletBridge] = useState<PrivyWalletBridge | null>(null);
  const [draft, setDraft] = useState<SwapDraft>(DEFAULT_DRAFT);
  const [historyOpen, setHistoryOpen] = useState(false);

  const privyAuth = usePrivyAuth();
  const activeWalletAddress = walletBridge?.address ?? walletAddress;
  const fromChain = CHAIN_BY_KEY[draft.fromChain];
  const selectedFromToken = fromChain.tokens.find((t) => t.symbol === draft.fromTokenSymbol) ?? fromChain.tokens[0];

  // ── Hooks ──
  const prices = usePrices(draft.fromTokenSymbol, draft.toTokenSymbol);

  const {
    tokenBalances, isRefreshingBalances, balanceError,
    formattedSourceBalances, scheduleBalanceRefresh,
  } = useTokenBalances(activeWalletAddress, draft.fromChain, selectedFromToken);

  const {
    quotes, quotingProviders, retryingProviders, selectedProvider, setSelectedProvider,
    quoteCountdown, isQuoting, bestQuote,
    fetchQuote, triggerFetchImmediate, setupAmountDebounce, clearDebounce,
    setIsExecuting: setQuoteIsExecuting, clearQuotes, draftRef,
  } = useSwapQuotes(activeWalletAddress);

  const onPostSwap = useCallback(() => {
    setDraft((c) => ({ ...c, amount: '' }));
    clearQuotes();
    scheduleBalanceRefresh();
  }, [clearQuotes, scheduleBalanceRefresh]);

  const {
    isExecuting, txStatus, error,
    executeSwap: doExecuteSwap, clearTxStatus,
  } = useSwapExecution(walletBridge, fromChain.chainId, onPostSwap);

  // Keep quote hook aware of execution state (prevents auto-refresh during swap)
  useEffect(() => {
    setQuoteIsExecuting(isExecuting);
  }, [isExecuting, setQuoteIsExecuting]);

  // Keep draftRef in sync for countdown auto-refresh
  useEffect(() => {
    draftRef.current = draft;
  }, [draft, draftRef]);

  const { historyRecords, historyLoading, historyError } =
    useTransactionHistory(historyOpen, activeWalletAddress, txStatus?.hash);

  // ── Amount debounce ──
  useEffect(() => {
    setupAmountDebounce(draft);
    return () => clearDebounce();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amount]);

  // ── Gate navigation: require Privy login before entering Human view ──
  const handleHumanClick = () => {
    if (HAS_PRIVY && !privyAuth.authenticated) {
      pendingLogin.current = true;
      privyAuth.login();
      return;
    }
    setView('human');
  };

  useEffect(() => {
    if (HAS_PRIVY && privyAuth.authenticated && pendingLogin.current) {
      pendingLogin.current = false;
      setView('human');
    }
  }, [privyAuth.authenticated]);

  // ── Scroll to top on view change ──
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view]);

  // ── Swap execution wrapper ──
  const handleExecuteSwap = useCallback(() => {
    if (!bestQuote) return;
    const requestedAmountRaw = (() => {
      const amount = draft.amount.trim();
      if (!amount) return null;
      try {
        return parseUnits(amount, selectedFromToken.decimals);
      } catch {
        return null;
      }
    })();
    const selectedSourceBalanceRaw = tokenBalances[makeBalanceKey(draft.fromChain, selectedFromToken.address)];
    const isAmountInsufficient =
      Boolean(activeWalletAddress)
      && requestedAmountRaw != null
      && selectedSourceBalanceRaw != null
      && requestedAmountRaw > selectedSourceBalanceRaw;

    const volumeUsd = computeUsdValue(prices, draft.fromTokenSymbol, draft.amount)?.value;

    doExecuteSwap(
      draft, bestQuote, selectedFromToken,
      requestedAmountRaw,
      () => privyAuth.login(),
      HAS_PRIVY, privyAuth.authenticated,
      isAmountInsufficient,
      volumeUsd
    );
  }, [draft, bestQuote, selectedFromToken, tokenBalances, activeWalletAddress, prices, doExecuteSwap, privyAuth]);

  const handleBack = useCallback(() => {
    setView('landing');
    setDraft(DEFAULT_DRAFT);
    clearQuotes();
    clearTxStatus();
  }, [clearQuotes, clearTxStatus]);

  return (
    <div className="hf-app">
      {/* Header */}
      <header className="hf-header">
        <div className="hf-logo" onClick={() => { setView('landing'); clearTxStatus(); }} style={{ cursor: 'pointer' }}>
          <div className="hf-logo-icon">🐰</div>
          <span className="hf-logo-text">HopFast</span>
        </div>
        {HAS_PRIVY ? (
          <PrivyWalletConnector onWalletAddress={setWalletAddress} onWalletBridge={setWalletBridge} />
        ) : (
          <DemoWalletConnector />
        )}
      </header>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {view === 'landing' && (
          <LandingView
            onHumanClick={handleHumanClick}
            onAgentClick={() => setView('agent')}
          />
        )}

        {view === 'agent' && (
          <AgentView onBack={() => setView('landing')} />
        )}

        {view === 'human' && (
          <SwapView
            draft={draft}
            setDraft={setDraft}
            quotes={quotes}
            quotingProviders={quotingProviders}
            retryingProviders={retryingProviders}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            quoteCountdown={quoteCountdown}
            isQuoting={isQuoting}
            bestQuote={bestQuote}
            fetchQuote={fetchQuote}
            triggerFetchImmediate={triggerFetchImmediate}
            prices={prices}
            tokenBalances={tokenBalances}
            formattedSourceBalances={formattedSourceBalances}
            balanceError={balanceError}
            isRefreshingBalances={isRefreshingBalances}
            walletBridge={walletBridge}
            activeWalletAddress={activeWalletAddress}
            isExecuting={isExecuting}
            txStatus={txStatus}
            error={error}
            executeSwap={handleExecuteSwap}
            onBack={handleBack}
            onToggleHistory={() => setHistoryOpen((prev) => !prev)}
            onTxStatusClear={clearTxStatus}
          />
        )}
      </AnimatePresence>

      {/* Transaction History Modal */}
      {historyOpen && (
        <TransactionHistoryModal
          activeWalletAddress={activeWalletAddress}
          historyRecords={historyRecords}
          historyLoading={historyLoading}
          historyError={historyError}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Footer */}
      <footer className="hf-footer">
        <div>
          <a href="https://t.me/PersistenceOneChat" target="_blank" rel="noopener noreferrer">Support</a>
          <a href="https://persistence.one/privacy?lang=en" target="_blank" rel="noopener noreferrer">Privacy</a>
        </div>
        <p>© 2026 HopFast</p>
      </footer>
    </div>
  );
}

export default App;
