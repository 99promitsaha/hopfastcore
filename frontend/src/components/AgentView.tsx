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
        <h2>Autonomous mode is being built.</h2>
        <p>Human mode is live right now for prompt-to-swap and manual routing.</p>
        <button className="hf-btn hf-btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </motion.main>
  );
}
