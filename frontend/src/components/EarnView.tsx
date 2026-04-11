import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown, ExternalLink, Loader2, Search,
  Shield, TrendingUp, Wallet, Zap, CheckCircle2, X,
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Trash2, Info,
} from 'lucide-react';
import { useEarnVaults } from '../hooks/useEarnVaults';
import { useEarnDeposit } from '../hooks/useEarnDeposit';
import { useEarnPortfolio } from '../hooks/useEarnPortfolio';
import { EarnOnboarding } from './EarnOnboarding';
import { fetchPreferences, savePreferences } from '../services/earnService';
import { parseUnits } from '../lib/amount';
import type { EarnVault, EarnPositionRecord, EarnPreference, EarnFilters } from '../types';
import type { PrivyWalletBridge } from './WalletConnector';

/* ─── Constants ── */
const EARN_CHAINS = [
  { id: 0, label: 'All Chains' },
  { id: 1, label: 'Ethereum' },
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum' },
  { id: 10, label: 'Optimism' },
  { id: 137, label: 'Polygon' },
  { id: 56, label: 'BNB Chain' },
  { id: 534352, label: 'Scroll' },
  { id: 59144, label: 'Linea' },
  { id: 146, label: 'Sonic' },
];

const EARN_PROTOCOLS = [
  { value: null, label: 'All Protocols' },
  { value: 'aave-v3', label: 'Aave V3' },
  { value: 'morpho-v1', label: 'Morpho' },
  { value: 'euler-v2', label: 'Euler V2' },
  { value: 'ethena-usde', label: 'Ethena' },
  { value: 'fluid', label: 'Fluid' },
  { value: 'pendle', label: 'Pendle' },
  { value: 'spark', label: 'Spark' },
  { value: 'maple', label: 'Maple' },
  { value: 'kelp', label: 'Kelp' },
];

const EARN_ASSETS = [
  { value: null, label: 'All Assets' },
  { value: 'USDC', label: 'USDC' },
  { value: 'USDT', label: 'USDT' },
  { value: 'ETH', label: 'ETH' },
  { value: 'WBTC', label: 'WBTC' },
  { value: 'DAI', label: 'DAI' },
];

const CHAIN_EXPLORER: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
  56: 'https://bscscan.com/tx/',
  534352: 'https://scrollscan.com/tx/',
  59144: 'https://lineascan.build/tx/',
  146: 'https://sonicscan.org/tx/',
};

const CHAIN_NAME: Record<number, string> = {
  1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism',
  137: 'Polygon', 56: 'BNB Chain', 534352: 'Scroll', 59144: 'Linea', 146: 'Sonic',
};

type EarnSubTab = 'vaults' | 'positions';

/* ─── Props ── */
interface EarnViewProps {
  walletBridge: PrivyWalletBridge | null;
  activeWalletAddress: string | null;
  onBack: () => void;
}

/** Match vault/token name to a local icon based on keywords */
function getTokenIcon(symbol: string): string | null {
  const s = symbol.toUpperCase();
  if (s === 'USDC' || s === 'USDC.E' || s === 'USDCE') return '/token-icons/usdc.svg';
  if (s === 'USDT') return '/token-icons/usdt.svg';
  if (s === 'DAI' || s === 'XDAI') return '/token-icons/dai.svg';
  if (s === 'WBTC' || s === 'BTC' || s === 'CBBTC' || s === 'TBTC') return '/token-icons/wbtc.png';
  if (s === 'ETH' || s === 'WETH' || s === 'STETH' || s === 'WSTETH') return '/token-icons/eth.svg';
  return null;
}

/* ─── Helpers ── */
function formatTvl(usd: string): string {
  const n = Number(usd);
  if (!Number.isFinite(n)) return '$—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatApy(val: number | null): string {
  if (val == null) return '—';
  return `${val.toFixed(2)}%`;
}

function protocolLabel(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/\bv(\d)/g, ' V$1')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getExplorerUrl(chainId: number, txHash: string): string {
  const base = CHAIN_EXPLORER[chainId] ?? 'https://etherscan.io/tx/';
  return `${base}${txHash}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}

/* ─── Reusable dropdown ── */
function FilterDropdown({ label, options, value, onChange }: {
  label: string;
  options: Array<{ value: string | null; label: string }>;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? label;

  return (
    <div className="hf-earn-chain-filter" ref={ref}>
      <button className="hf-chain-btn" onClick={() => setOpen(!open)}>
        {selectedLabel}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="hf-earn-chain-dropdown">
          {options.map((o) => (
            <button
              key={o.value ?? '__all'}
              className={`hf-earn-chain-option ${value === o.value ? 'hf-earn-chain-option-active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function prefsToFilters(prefs: EarnPreference): Partial<EarnFilters> {
  const f: Partial<EarnFilters> = {};
  f.sortBy = prefs.riskAppetite === 'high' ? 'apy' : 'tvl';

  if (prefs.preferredAsset === 'USDC') { f.stablecoinOnly = true;  f.asset = 'USDC'; }
  else if (prefs.preferredAsset === 'USDT') { f.stablecoinOnly = true;  f.asset = 'USDT'; }
  else if (prefs.preferredAsset === 'ETH')  { f.stablecoinOnly = false; f.asset = 'ETH'; }
  else if (prefs.preferredAsset === 'WBTC') { f.stablecoinOnly = false; f.asset = 'WBTC'; }
  else { f.stablecoinOnly = false; f.asset = null; }

  // Beginners get stablecoins regardless of asset choice — safety first
  if (prefs.experienceLevel === 'beginner' && !f.stablecoinOnly) {
    f.stablecoinOnly = true;
    f.asset = null;
  }
  return f;
}

function onboardingKey(address: string) {
  return `hf_earn_onboarded_${address.toLowerCase()}`;
}

/* ─── Main Component ── */
export function EarnView({ walletBridge, activeWalletAddress, onBack }: EarnViewProps) {
  const { vaults, loading, error, filters, updateFilters, loadMore, hasMore, allCount } = useEarnVaults();
  const portfolio = useEarnPortfolio(activeWalletAddress);

  const [subTab, setSubTab] = useState<EarnSubTab>('vaults');
  const [selectedVault, setSelectedVault] = useState<EarnVault | null>(null);
  const [inputAmount, setInputAmount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [apyTip, setApyTip] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const prefsChecked = useRef(false);

  // Check for saved preferences when wallet connects
  useEffect(() => {
    if (!activeWalletAddress || prefsChecked.current) return;
    prefsChecked.current = true;

    const key = onboardingKey(activeWalletAddress);
    const cached = localStorage.getItem(key);
    if (cached) {
      // Returning user — apply saved prefs immediately
      try {
        updateFilters(prefsToFilters(JSON.parse(cached)));
      } catch { /* ignore malformed cache */ }
      return;
    }
    // First time — fetch from DB, show modal if nothing found
    fetchPreferences(activeWalletAddress).then((prefs) => {
      if (prefs) {
        localStorage.setItem(key, JSON.stringify(prefs));
        updateFilters(prefsToFilters(prefs));
      } else {
        setShowOnboarding(true);
      }
    }).catch(() => setShowOnboarding(true));
  }, [activeWalletAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = async (prefs: EarnPreference) => {
    setShowOnboarding(false);
    updateFilters(prefsToFilters(prefs));
    if (activeWalletAddress) {
      localStorage.setItem(onboardingKey(activeWalletAddress), JSON.stringify(prefs));
      savePreferences(activeWalletAddress, prefs).catch(() => { /* non-critical */ });
    }
  };

  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
    if (activeWalletAddress) {
      // Mark as seen so it doesn't reappear this session
      localStorage.setItem(onboardingKey(activeWalletAddress), JSON.stringify({ skipped: true }));
    }
  };

  const earnAction = useEarnDeposit(walletBridge, () => {
    setSelectedVault(null);
    setInputAmount('');
    setApyTip(null);
    portfolio.refresh();
  });

  const handleDeposit = async () => {
    if (!selectedVault || !activeWalletAddress || !inputAmount) return;

    const token = selectedVault.underlyingTokens[0];
    let amountRaw: string;
    try {
      amountRaw = parseUnits(inputAmount, token.decimals).toString();
    } catch {
      earnAction.reset();
      return;
    }
    if (amountRaw === '0') return;

    const q = await earnAction.getDepositQuote(selectedVault, amountRaw, activeWalletAddress);
    if (q) {
      await earnAction.executeDeposit(selectedVault, amountRaw, inputAmount, q);
    }
  };

  const openVaultModal = (vault: EarnVault) => {
    setSelectedVault(vault);
    setInputAmount('');
    earnAction.reset();
  };

  const closeModal = () => {
    setSelectedVault(null);
    setInputAmount('');
    setApyTip(null);
    earnAction.reset();
  };

  const tokenSymbol = selectedVault?.underlyingTokens[0]?.symbol ?? 'Token';
  const modalChainId = selectedVault?.chainId ?? 1;

  const chainOptions = EARN_CHAINS.map((c) => ({ value: c.id === 0 ? null : String(c.id), label: c.label }));
  const protocolOptions = EARN_PROTOCOLS.map((p) => ({ value: p.value, label: p.label }));
  const assetOptions = EARN_ASSETS.map((a) => ({ value: a.value, label: a.label }));

  return (
    <motion.div
      key="earn"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="hf-earn-wrap"
    >
      {/* ── Onboarding Modal ── */}
      {showOnboarding && (
        <EarnOnboarding
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      )}

      {/* ── Deposit Modal ── */}
      <AnimatePresence>
        {selectedVault && (
          <motion.div
            className="hf-earn-detail-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={closeModal}
          >
            <motion.div
              className="hf-earn-detail-card"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="hf-earn-detail-close" onClick={closeModal}>
                <X size={16} />
              </button>

              <div className="hf-earn-detail-header">
                <div>
                  <h3 className="hf-earn-detail-name">{selectedVault.name}</h3>
                  <span className="hf-earn-detail-protocol">
                    {protocolLabel(selectedVault.protocol.name)} · {selectedVault.network}
                  </span>
                </div>
                <div className="hf-earn-detail-apy-big">
                  {formatApy(selectedVault.analytics.apy.total)}
                  <span>APY</span>
                </div>
              </div>

              <div className="hf-earn-detail-stats">
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">TVL</span>
                  <span className="hf-earn-stat-value">{formatTvl(selectedVault.analytics.tvl.usd)}</span>
                </div>
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">
                    Base APY
                    <button className="hf-apy-tip-btn" onClick={() => setApyTip(apyTip === 'base' ? null : 'base')}>
                      <Info size={11} />
                    </button>
                  </span>
                  <span className="hf-earn-stat-value">{formatApy(selectedVault.analytics.apy.base)}</span>
                  {apyTip === 'base' && (
                    <p className="hf-apy-tip-text">The core yield from the vault's lending or strategy — e.g. interest paid by borrowers. This is the stable, sustainable part of your return.</p>
                  )}
                </div>
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">
                    Reward APY
                    <button className="hf-apy-tip-btn" onClick={() => setApyTip(apyTip === 'reward' ? null : 'reward')}>
                      <Info size={11} />
                    </button>
                  </span>
                  <span className="hf-earn-stat-value">{formatApy(selectedVault.analytics.apy.reward)}</span>
                  {apyTip === 'reward' && (
                    <p className="hf-apy-tip-text">Extra yield from protocol token incentives (e.g. MORPHO, COMP, OP). Can be volatile — if the reward token price drops or the incentive program ends, this number may fall significantly.</p>
                  )}
                </div>
                <div className="hf-earn-stat">
                  <span className="hf-earn-stat-label">
                    30d APY
                    <button className="hf-apy-tip-btn" onClick={() => setApyTip(apyTip === '30d' ? null : '30d')}>
                      <Info size={11} />
                    </button>
                  </span>
                  <span className="hf-earn-stat-value">{formatApy(selectedVault.analytics.apy30d)}</span>
                  {apyTip === '30d' && (
                    <p className="hf-apy-tip-text">The actual average yield delivered over the last 30 days. Often the most reliable number — it reflects real past performance, not a forward-looking estimate.</p>
                  )}
                </div>
              </div>

              <div className="hf-earn-tags">
                {selectedVault.tags.map((tag) => (
                  <span key={tag} className="hf-earn-tag">{tag}</span>
                ))}
              </div>

              {/* Deposit input */}
              <div className="hf-earn-deposit-section">
                <label className="hf-earn-deposit-label">
                  Deposit {tokenSymbol}
                </label>
                <div className="hf-earn-deposit-input-wrap">
                  <input
                    className="hf-amount-input"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                    disabled={earnAction.loading || earnAction.quoting}
                  />
                  <span className="hf-earn-deposit-token">{tokenSymbol}</span>
                </div>

                {earnAction.stage === 'done' ? (
                  <div className="hf-earn-success">
                    <CheckCircle2 size={18} />
                    <span>Deposit successful!</span>
                    {earnAction.txHash && (
                      <a
                        href={getExplorerUrl(modalChainId, earnAction.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hf-earn-tx-link"
                      >
                        View tx <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                ) : (
                  <button
                    className="hf-btn hf-btn-primary hf-btn-wide"
                    onClick={handleDeposit}
                    disabled={
                      !inputAmount ||
                      !activeWalletAddress ||
                      earnAction.quoting ||
                      earnAction.loading
                    }
                  >
                    {earnAction.quoting ? (
                      <><Loader2 size={14} className="hf-spin" /> Getting quote…</>
                    ) : earnAction.stage === 'approving' ? (
                      <><Loader2 size={14} className="hf-spin" /> Approving…</>
                    ) : earnAction.stage === 'executing' ? (
                      <><Loader2 size={14} className="hf-spin" /> Depositing…</>
                    ) : earnAction.stage === 'confirming' ? (
                      <><Loader2 size={14} className="hf-spin" /> Confirming…</>
                    ) : !activeWalletAddress ? (
                      <>Connect wallet</>
                    ) : (
                      <><Zap size={14} /> Deposit</>
                    )}
                  </button>
                )}

                {earnAction.error && (
                  <p className="hf-note hf-note-error">{earnAction.error}</p>
                )}
              </div>

              <a
                href={selectedVault.protocol.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hf-earn-protocol-link"
              >
                Manage on {protocolLabel(selectedVault.protocol.name)} <ExternalLink size={11} />
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="hf-earn-header">
        <h3 className="hf-swap-title">Earn. <span>While You Sleep</span></h3>
        <div className="hf-earn-powered">
          Powered by
          <img src="/providers/lifi.png" alt="LI.FI" className="hf-earn-powered-logo" />
        </div>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="hf-earn-subtabs">
        <button
          className={`hf-earn-subtab ${subTab === 'vaults' ? 'hf-earn-subtab-active' : ''}`}
          onClick={() => setSubTab('vaults')}
        >
          <Wallet size={13} /> Explore Vaults
        </button>
        <button
          className={`hf-earn-subtab ${subTab === 'positions' ? 'hf-earn-subtab-active' : ''}`}
          onClick={() => setSubTab('positions')}
        >
          <ArrowUpFromLine size={13} /> Your Positions
          {portfolio.positions.length > 0 && (
            <span className="hf-earn-subtab-badge">{portfolio.positions.length}</span>
          )}
        </button>
      </div>

      {/* ══════════ VAULTS TAB ══════════ */}
      {subTab === 'vaults' && (
        <>
          <div className="hf-earn-filters">
            <FilterDropdown
              label="All Chains"
              options={chainOptions}
              value={filters.chainId != null ? String(filters.chainId) : null}
              onChange={(v) => updateFilters({ chainId: v != null ? Number(v) : null })}
            />
            <FilterDropdown
              label="All Protocols"
              options={protocolOptions}
              value={filters.protocol}
              onChange={(v) => updateFilters({ protocol: v })}
            />
            <FilterDropdown
              label="All Assets"
              options={assetOptions}
              value={filters.asset}
              onChange={(v) => updateFilters({ asset: v })}
            />
            <button
              className={`hf-earn-filter-btn ${filters.stablecoinOnly ? 'hf-earn-filter-btn-active' : ''}`}
              onClick={() => updateFilters({ stablecoinOnly: !filters.stablecoinOnly })}
            >
              <Shield size={12} /> Stablecoins
            </button>
            <button
              className={`hf-earn-filter-btn ${filters.sortBy === 'apy' ? 'hf-earn-filter-btn-active' : ''}`}
              onClick={() => updateFilters({ sortBy: filters.sortBy === 'apy' ? 'tvl' : 'apy' })}
            >
              <TrendingUp size={12} /> {filters.sortBy === 'apy' ? 'Top APY' : 'Top TVL'}
            </button>
            <div className="hf-earn-search">
              <Search size={13} />
              <input
                placeholder="Search vaults..."
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
              />
            </div>
            <div className="hf-earn-info-tip">
              <Info size={13} />
              <span className="hf-earn-info-tooltip">
                High APR values are subject to fluctuate. Please do your own due diligence before depositing.
              </span>
            </div>
          </div>

          <div className="hf-earn-count">
            {loading && vaults.length === 0 ? (
              <span>Loading vaults…</span>
            ) : (
              <span>{vaults.length} vault{vaults.length !== 1 ? 's' : ''} found{allCount > 0 ? ` (${allCount} total)` : ''}</span>
            )}
          </div>

          {error && <p className="hf-note hf-note-error">{error}</p>}

          <div className="hf-earn-list">
            {loading && vaults.length === 0 ? (
              <div className="hf-earn-loading">
                <Loader2 size={24} className="hf-spin" />
                <p>Discovering best yields…</p>
              </div>
            ) : vaults.length === 0 ? (
              <div className="hf-earn-empty">
                <Wallet size={32} />
                <p>No vaults found matching your filters.</p>
              </div>
            ) : (
              <>
                {vaults.map((vault) => (
                  <button
                    key={vault.slug}
                    className="hf-earn-vault-row"
                    onClick={() => openVaultModal(vault)}
                  >
                    <div className="hf-earn-vault-main">
                      {(() => { const icon = getTokenIcon(vault.underlyingTokens?.[0]?.symbol ?? vault.name); return icon ? <img src={icon} alt="" className="hf-earn-vault-icon" /> : null; })()}
                      <div className="hf-earn-vault-name-wrap">
                        <span className="hf-earn-vault-name">{vault.name}</span>
                        <span className="hf-earn-vault-protocol">
                          {protocolLabel(vault.protocol.name)}
                        </span>
                      </div>
                      <div className="hf-earn-vault-tokens">
                        {vault.underlyingTokens.map((t) => (
                          <span key={t.address} className="hf-earn-token-badge">
                            {t.symbol}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="hf-earn-vault-metrics">
                      <div className="hf-earn-vault-apy">
                        <span className="hf-earn-vault-apy-value">{formatApy(vault.analytics.apy.total)}</span>
                        <span className="hf-earn-vault-apy-label">APY</span>
                      </div>
                      <div className="hf-earn-vault-tvl">
                        <span className="hf-earn-vault-tvl-value">{formatTvl(vault.analytics.tvl.usd)}</span>
                        <span className="hf-earn-vault-tvl-label">TVL</span>
                      </div>
                      <div className="hf-earn-vault-chain">
                        {vault.network}
                      </div>
                    </div>
                  </button>
                ))}

                {hasMore && (
                  <button className="hf-earn-load-more" onClick={loadMore} disabled={loading}>
                    {loading ? <><Loader2 size={14} className="hf-spin" /> Loading…</> : 'Load more vaults'}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ══════════ POSITIONS TAB ══════════ */}
      {subTab === 'positions' && (
        <div className="hf-earn-positions">
          {!activeWalletAddress ? (
            <div className="hf-earn-empty">
              <Wallet size={32} />
              <p>Connect your wallet to view positions.</p>
            </div>
          ) : portfolio.loading ? (
            <div className="hf-earn-loading">
              <Loader2 size={24} className="hf-spin" />
              <p>Loading your positions…</p>
            </div>
          ) : portfolio.error ? (
            <div>
              <p className="hf-note hf-note-error">{portfolio.error}</p>
              <button className="hf-earn-load-more" onClick={portfolio.refresh} style={{ marginTop: '0.5rem' }}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : portfolio.positions.length === 0 ? (
            <div className="hf-earn-empty">
              <ArrowDownToLine size={32} />
              <p>No positions yet.</p>
              <button
                className="hf-earn-filter-btn hf-earn-filter-btn-active"
                onClick={() => setSubTab('vaults')}
                style={{ marginTop: '0.5rem' }}
              >
                Explore vaults to start earning
              </button>
            </div>
          ) : (
            <>
              {/* Disclaimer */}
              <div className="hf-earn-disclaimer">
                <Info size={14} />
                <span>
                  This page is a work in progress. Balances shown are based on recorded deposits
                  and may not reflect your actual on-chain balance. Use the provider link to manage
                  or withdraw your position. Not in your wallet anymore? Remove it below.
                </span>
              </div>

              {/* Portfolio summary */}
              <div className="hf-earn-portfolio-summary">
                <div className="hf-earn-portfolio-total">
                  <span className="hf-earn-stat-label">Tracked Positions</span>
                  <span className="hf-earn-portfolio-total-value">{portfolio.positions.length}</span>
                </div>
                <button className="hf-earn-refresh-btn" onClick={portfolio.refresh} disabled={portfolio.loading}>
                  <RefreshCw size={13} className={portfolio.loading ? 'hf-spin' : ''} />
                </button>
              </div>

              {/* Position rows */}
              <div className="hf-earn-list">
                {portfolio.positions.map((pos) => (
                  <div
                    key={pos._id}
                    className="hf-earn-vault-row hf-earn-position-row"
                  >
                    <div className="hf-earn-vault-main">
                      {(() => { const icon = getTokenIcon(pos.tokenSymbol || pos.vaultName); return icon ? <img src={icon} alt="" className="hf-earn-vault-icon" /> : null; })()}
                      <div className="hf-earn-vault-name-wrap">
                        <span className="hf-earn-vault-name">{pos.vaultName || pos.tokenSymbol}</span>
                        <span className="hf-earn-vault-protocol">
                          {protocolLabel(pos.protocolName)} · {pos.network || CHAIN_NAME[pos.chainId] || `Chain ${pos.chainId}`}
                        </span>
                      </div>
                      <div className="hf-earn-vault-tokens">
                        <span className="hf-earn-token-badge">{pos.tokenSymbol}</span>
                      </div>
                    </div>
                    <div className="hf-earn-vault-metrics">
                      <div className="hf-earn-vault-apy">
                        <span className="hf-earn-vault-tvl-value">{pos.amount} {pos.tokenSymbol}</span>
                        <span className="hf-earn-vault-tvl-label">Deposited · {formatDate(pos.createdAt)}</span>
                      </div>
                      <div className="hf-earn-position-actions">
                        {/* Manage on provider */}
                        {pos.protocolUrl && (
                          <a
                            href={pos.protocolUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hf-earn-position-link"
                            title={`Manage on ${protocolLabel(pos.protocolName)}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                        {/* View tx */}
                        <a
                          href={getExplorerUrl(pos.chainId, pos.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hf-earn-position-link"
                          title="View transaction"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Search size={13} />
                        </a>
                        {/* Delete */}
                        {confirmDelete === pos._id ? (
                          <span className="hf-earn-confirm-delete">
                            <button
                              className="hf-earn-confirm-yes"
                              onClick={(e) => { e.stopPropagation(); portfolio.removePosition(pos._id); setConfirmDelete(null); }}
                            >
                              Yes, remove
                            </button>
                            <button
                              className="hf-earn-confirm-no"
                              onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="hf-earn-delete-btn"
                            title="Remove from portfolio"
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(pos._id); }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}
