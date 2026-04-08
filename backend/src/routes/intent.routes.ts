import { Router } from 'express';
import { z } from 'zod';
import { inferIntent } from '../lib/openaiIntent.js';
import { IntentLog } from '../models/IntentLog.js';
import { isDatabaseReady } from '../config/db.js';

const router = Router();

const bodySchema = z.object({
  prompt: z.string().min(4)
});

router.post('/intent', async (req, res) => {
  const parsedBody = bodySchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid prompt payload.' });
  }

  const result = await inferIntent(parsedBody.data.prompt);

  if (isDatabaseReady()) {
    await IntentLog.create({
      prompt: parsedBody.data.prompt,
      result,
      source: result.source
    });
  }

  return res.json(result);
});

export default router;
