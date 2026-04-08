import { Router } from 'express';
import { z } from 'zod';
import { SwapRecord } from '../models/SwapRecord.js';
import { isDatabaseReady } from '../config/db.js';

const router = Router();

const createSwapSchema = z.object({
  userAddress: z.string().min(8),
  quoteId: z.string().min(2),
  fromChain: z.string().min(2),
  toChain: z.string().min(2),
  fromTokenSymbol: z.string().min(2),
  toTokenSymbol: z.string().min(2),
  amount: z.string().min(1),
  status: z.string().optional(),
  metadata: z.unknown().optional()
});

router.post('/swaps', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable. Add MONGODB_URI and retry.' });
  }

  const parsed = createSwapSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid swap payload.' });
  }

  const created = await SwapRecord.create(parsed.data);
  return res.status(201).json(created);
});

router.get('/swaps', async (req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ error: 'Database unavailable. Add MONGODB_URI and retry.' });
  }

  const limit = Math.min(Number(req.query.limit ?? 25), 100);
  const records = await SwapRecord.find().sort({ createdAt: -1 }).limit(limit);

  return res.json({
    count: records.length,
    records
  });
});

export default router;
