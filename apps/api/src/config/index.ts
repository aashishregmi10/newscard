import { z } from 'zod';

/**
 * Environment parsing.
 *
 * Parsed once at boot and validated. A missing or malformed value fails startup
 * with a readable message, rather than surfacing an hour later as `undefined`
 * in a database URI or an unsigned cursor.
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required — copy .env.example to .env'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CURSOR_SECRET: z
    .string()
    .min(32, 'CURSOR_SECRET must be at least 32 characters — generate with: openssl rand -base64 32'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /**
   * The Google OAuth Web client ID(s) a reader's sign-in token must be issued
   * for, comma-separated. Unset: sign-in is refused with a message saying so,
   * and everything else works.
   */
  GOOGLE_WEB_CLIENT_ID: z.string().default(''),
  /**
   * The key that turns a Google account number into a reader id. Its own
   * secret, not CURSOR_SECRET: rotating this would make every reader new, and
   * every vote castable again. Unset in development: CURSOR_SECRET stands in.
   */
  READER_ID_SECRET: z.string().min(32, 'READER_ID_SECRET must be at least 32 characters').optional(),
  /** Ch. 10.9 — defaults to false everywhere. Only production sets it true. */
  NOTIFICATIONS_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test helper — the module-level cache would otherwise leak between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}
