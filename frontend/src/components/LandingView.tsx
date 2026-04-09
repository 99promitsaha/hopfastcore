import { motion } from 'framer-motion';
import { Bot, UserRound } from 'lucide-react';
import { CHAINS } from '../lib/chains';

interface LandingViewProps {
  onHumanClick: () => void;
  onAgentClick: () => void;
}

export function LandingView({ onHumanClick, onAgentClick }: LandingViewProps) {
  return (
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
          Hop assets
          <br />
          <span>at light speed 🐰</span>
        </h1>
        <p className="hf-hero-sub">
          Go Hop across 5 chains in seconds by comparing quotes from LI.FI, Squid, deBridge &amp; more.
        </p>
      </div>

      <div className="hf-role-list">
        <button className="hf-role-card" onClick={onHumanClick}>
          <div>
            <p className="hf-role-title">Human</p>
            <p className="hf-role-sub">Instant cross-chain bridging</p>
          </div>
          <span className="hf-role-icon">
            <UserRound size={18} />
          </span>
        </button>

        <button className="hf-role-card hf-role-card-muted" onClick={onAgentClick}>
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
  );
}
