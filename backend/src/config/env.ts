import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_API_BASE_URL: z.string().default('https://li.quest/v1'),
  LIFI_INTEGRATOR: z.preprocess(emptyToUndefined, z.string().optional()),
  LIFI_FEE: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  LIFI_SLIPPAGE: z.coerce.number().default(0.005),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_API_BASE_URL: z.string().default('https://api.openai.com/v1'),
  RELAY_API_BASE_URL: z.string().default('https://api.relay.link')
});

export const env = schema.parse(process.env);
