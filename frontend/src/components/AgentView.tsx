import { motion } from 'framer-motion';

interface AgentViewProps {
  onBack: () => void;
}

export function AgentView({ onBack }: AgentViewProps) {
  return (
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
        <h2>Work in progress 🤖🔨</h2>
        <p>Agentic swaps, yield opportunities, and integrations with more providers. Expected by end of April.</p>
        <p style={{ fontSize: '0.72rem', color: 'var(--hf-text-muted)', marginTop: '0.25rem' }}>In the meantime, hop over to Human mode to swap and earn.</p>
        <button className="hf-btn hf-btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </motion.main>
  );
}
