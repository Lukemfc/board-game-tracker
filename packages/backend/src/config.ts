import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  SERVICE_API_KEY: z.string().min(1, 'SERVICE_API_KEY is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      'Invalid environment configuration:\n',
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
export type Config = typeof config;

export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
