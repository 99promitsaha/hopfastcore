import type { ParsedIntent } from '../lib/intentParser';
import { parsePromptIntent } from '../lib/intentParser';

/**
 * Resolve the intent API URL.
 * Uses env var first, then localhost fallback for dev.
 */
function resolveIntentUrl(): string {
  const direct = import.meta.env.VITE_HOPFAST_INTENT_PROXY_URL;
  if (direct && direct.trim().length > 0) {
    return direct;
  }

  const base = import.meta.env.VITE_HOPFAST_API_BASE_URL;
  if (base && base.trim().length > 0) {
    return `${base.replace(/\/$/, '')}/intent`;
  }

  // Dev fallback
  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return 'http://localhost:8080/api/intent';
  }

  return '';
}

/**
 * Send the user's prompt to the backend (OpenAI-powered) for intent parsing.
 * Falls back to the local heuristic parser if the backend is unavailable.
 */
export async function inferSwapIntent(prompt: string): Promise<ParsedIntent> {
  const intentUrl = resolveIntentUrl();

  if (!intentUrl) {
    return parsePromptIntent(prompt);
  }

  try {
    const response = await fetch(intentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      return parsePromptIntent(prompt);
    }

    const parsed = (await response.json()) as ParsedIntent;

    // Backend returns the AI-parsed result; trust it over local heuristics
    return {
      amount: parsed.amount,
      fromChain: parsed.fromChain,
      toChain: parsed.toChain,
      fromTokenSymbol: parsed.fromTokenSymbol,
      toTokenSymbol: parsed.toTokenSymbol,
      confidence: parsed.confidence ?? 0.9,
      reasoning: parsed.reasoning ?? 'Parsed by AI via backend.'
    };
  } catch {
    return parsePromptIntent(prompt);
  }
}
