import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { TokenOption, ChainOption } from '../lib/chains';

interface TokenSelectorProps {
  label: string;
  selectedToken: TokenOption;
  tokens: TokenOption[];
  chain: ChainOption;
  chains: ChainOption[];
  onSelectToken: (symbol: string) => void;
  onSelectChain: (chainKey: string) => void;
}

export function TokenSelector({
  label,
  selectedToken,
  tokens,
  chain,
  chains,
  onSelectToken,
  onSelectChain
}: TokenSelectorProps) {
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showChainModal, setShowChainModal] = useState(false);

  return (
    <>
      <div className="hf-token-selector">
        <button
          className="hf-token-btn"
          onClick={() => setShowTokenModal(true)}
          aria-label={`Select ${label} token`}
        >
          <img
            src={selectedToken.logoURI}
            alt={selectedToken.symbol}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          {selectedToken.symbol}
          <ChevronDown size={12} />
        </button>

        <button
          className="hf-chain-badge"
          onClick={() => setShowChainModal(true)}
          aria-label={`Select ${label} chain`}
        >
          <img
            src={chain.logoURI}
            alt={chain.name}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          {chain.name}
          <ChevronDown size={10} />
        </button>
      </div>

      {/* Token Selection Modal */}
      {showTokenModal && (
        <div className="hf-dropdown-overlay" onClick={() => setShowTokenModal(false)}>
          <div
            className="hf-dropdown-panel hf-fadeup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-dropdown-header">
              <h3>Select Token</h3>
              <button
                className="hf-dropdown-close"
                onClick={() => setShowTokenModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="hf-dropdown-list">
              {tokens.map((token) => (
                <button
                  key={token.symbol}
                  className={`hf-dropdown-item ${
                    token.symbol === selectedToken.symbol
                      ? 'hf-dropdown-item-active'
                      : ''
                  }`}
                  onClick={() => {
                    onSelectToken(token.symbol);
                    setShowTokenModal(false);
                  }}
                >
                  <img
                    src={token.logoURI}
                    alt={token.symbol}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="hf-dropdown-item-info">
                    <strong>{token.symbol}</strong>
                    <span>{token.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chain Selection Modal */}
      {showChainModal && (
        <div className="hf-dropdown-overlay" onClick={() => setShowChainModal(false)}>
          <div
            className="hf-dropdown-panel hf-fadeup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-dropdown-header">
              <h3>Select Network</h3>
              <button
                className="hf-dropdown-close"
                onClick={() => setShowChainModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="hf-dropdown-list">
              {chains.map((c) => (
                <button
                  key={c.key}
                  className={`hf-dropdown-item ${
                    c.key === chain.key ? 'hf-dropdown-item-active' : ''
                  }`}
                  onClick={() => {
                    onSelectChain(c.key);
                    setShowChainModal(false);
                  }}
                >
                  <img
                    src={c.logoURI}
                    alt={c.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="hf-dropdown-item-info">
                    <strong>{c.name}</strong>
                    <span>Chain ID: {c.chainId}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
