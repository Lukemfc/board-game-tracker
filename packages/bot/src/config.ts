import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  // Optional: when set, slash commands register instantly to this guild (dev).
  DISCORD_GUILD_ID: z.string().optional(),
  API_BASE_URL: z.string().url(),
  SERVICE_API_KEY: z.string().min(1, 'SERVICE_API_KEY is required'),
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
