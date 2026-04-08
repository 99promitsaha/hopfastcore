import { env } from '../config/env.js';
import type { SwapIntent } from '../types/swap.js';
import { parseIntentHeuristically } from './heuristicIntent.js';

interface OpenAIChatCompletionsOutput {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

type ParsedIntentCandidate = Partial<Omit<SwapIntent, 'source'>>;

const ALLOWED_CHAINS = new Set(['ethereum', 'base', 'bsc', 'polygon', 'arbitrum', 'optimism']);
const ALLOWED_TOKENS = new Set(['ETH', 'BNB', 'USDC', 'USDT', 'DAI', 'WBTC', 'BUSD', 'POL', 'ARB', 'OP', 'WETH']);

function extractJsonFromText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // Remove Markdown fences if model returns ```json ... ```
  const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return null;
  }

  return withoutFences.slice(firstBrace, lastBrace + 1);
}

function normalizeIntent(candidate: ParsedIntentCandidate): Omit<SwapIntent, 'source'> {
  const fromChain =
    typeof candidate.fromChain === 'string' && ALLOWED_CHAINS.has(candidate.fromChain) ? candidate.fromChain : undefined;
  const toChain =
    typeof candidate.toChain === 'string' && ALLOWED_CHAINS.has(candidate.toChain) ? candidate.toChain : undefined;

  const fromTokenSymbol =
    typeof candidate.fromTokenSymbol === 'string' && ALLOWED_TOKENS.has(candidate.fromTokenSymbol.toUpperCase())
      ? candidate.fromTokenSymbol.toUpperCase()
      : undefined;
  const toTokenSymbol =
    typeof candidate.toTokenSymbol === 'string' && ALLOWED_TOKENS.has(candidate.toTokenSymbol.toUpperCase())
      ? candidate.toTokenSymbol.toUpperCase()
      : undefined;

  const confidenceRaw = Number(candidate.confidence ?? 0.65);
  const confidence = Math.min(1, Math.max(0, Number.isFinite(confidenceRaw) ? confidenceRaw : 0.65));

  return {
    amount: typeof candidate.amount === 'string' ? candidate.amount : undefined,
    fromChain: fromChain as SwapIntent['fromChain'],
    toChain: toChain as SwapIntent['toChain'],
    fromTokenSymbol,
    toTokenSymbol,
    confidence,
    reasoning:
      typeof candidate.reasoning === 'string' && candidate.reasoning.trim().length > 0
        ? candidate.reasoning
        : 'Parsed by OpenAI.'
  };
}

export async function inferIntent(prompt: string): Promise<SwapIntent> {
  if (!env.OPENAI_API_KEY) {
    return parseIntentHeuristically(prompt);
  }

  try {
    const response = await fetch(`${env.OPENAI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system' as const,
            content: [
              'You convert a human swap request into a JSON object.',
              'Allowed chains: ethereum, base, bsc, polygon, arbitrum, optimism',
              'Allowed tokens: ETH, BNB, USDC, USDT, DAI, WBTC, BUSD, POL, ARB, OP, WETH',
              'Return only JSON with keys:',
              'amount, fromChain, toChain, fromTokenSymbol, toTokenSymbol, confidence, reasoning',
              'confidence must be 0 to 1'
            ].join('\n')
          },
          {
            role: 'user' as const,
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      return parseIntentHeuristically(prompt);
    }

    const data = (await response.json()) as OpenAIChatCompletionsOutput;
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';

    if (!text) {
      return parseIntentHeuristically(prompt);
    }

    const maybeJson = extractJsonFromText(text);
    if (!maybeJson) {
      return parseIntentHeuristically(prompt);
    }

    const parsed = normalizeIntent(JSON.parse(maybeJson) as ParsedIntentCandidate);

    return {
      ...parsed,
      source: 'openai'
    };
  } catch {
    return parseIntentHeuristically(prompt);
  }
}
