import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestLiFiQuote } from '../lib/lifiClient.js';
import { requestDebridgeQuote } from '../lib/debridgeClient.js';
import { requestSquidQuote } from '../lib/squidClient.js';
import { QuoteLog } from '../models/QuoteLog.js';
import { isDatabaseReady } from '../config/db.js';
import { env } from '../config/env.js';

const router = Router();

// 30 requests / minute per IP — only enforced outside development
const quoteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'development',
  message: { error: 'Too many quote requests. Please wait a moment before trying again.' }
});

router.post('/quotes', quoteLimiter, async (req, res) => {
  const requestedProvider = typeof req.query.provider === 'string' ? req.query.provider.toLowerCase() : undefined;
  const supportedProviders = ['lifi', 'debridge', 'squid'] as const;

  if (requestedProvider && !supportedProviders.includes(requestedProvider as (typeof supportedProviders)[number])) {
    return res.status(400).json({
      error: `Unsupported provider "${requestedProvider}". Use one of: ${supportedProviders.join(', ')}.`
    });
  }

  const provider = requestedProvider ?? 'lifi';

  // Basic schema validation
  const { srcChainKey, dstChainKey, srcTokenAddress, dstTokenAddress, amount } = req.body ?? {};
  if (!srcTokenAddress || !dstTokenAddress || !amount) {
    return res.status(400).json({ error: 'Missing required fields: srcTokenAddress, dstTokenAddress, amount.' });
  }
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) {
    return res.status(400).json({ error: 'Amount must be a numeric string in smallest token units.' });
  }

  try {
    let quote:
      | Awaited<ReturnType<typeof requestLiFiQuote>>
      | Awaited<ReturnType<typeof requestDebridgeQuote>>
      | Awaited<ReturnType<typeof requestSquidQuote>>;

    if (provider === 'debridge') {
      quote = await requestDebridgeQuote(req.body);
    } else if (provider === 'squid') {
      quote = await requestSquidQuote(req.body);
    } else {
      quote = await requestLiFiQuote(req.body);
    }

    const topQuote = quote.quotes?.[0];

    if (isDatabaseReady()) {
      await QuoteLog.create({
        requestPayload: req.body,
        quoteId: topQuote?.id,
        route: topQuote?.routeSteps?.map((step) => step.type).filter(Boolean).join(' + '),
        provider,
        responsePayload: quote
      });
    }

    return res.json(quote);
  } catch (error) {
    const isClient = error instanceof Error && /missing|invalid|unsupported/i.test(error.message);
    return res.status(isClient ? 400 : 502).json({
      error: isClient
        ? error.message
        : `Quote request to ${provider} failed. Please try again.`
    });
  }
});

export default router;
