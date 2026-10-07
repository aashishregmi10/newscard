import { z } from 'zod';
import { LOG_LEVELS } from '@saar/shared';

/**
 * Environment parsing for the CMS.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The public API has parsed and validated its environment at boot since it was
 * written: a missing or malformed value fails startup with a message naming the
 * variable. The CMS read `process.env` inline —
 *
 *   const PORT = Number(process.env.CMS_PORT ?? 3001);
 *
 * — and found out about problems later, as `NaN` somewhere unhelpful, or as a
 * connection to a database nobody meant to use. The asymmetry was accidental
 * rather than a decision: the right approach was already written next door and
 * nobody ported it.
 *
 * A symptom of the same laxity, now removed: `SESSION_SECRET` was documented in
 * .env.example as a required secret and read by no code at all. Session tokens
 * are 32 random bytes each, which is correct — but a required-looking secret
 * that does nothing teaches people to skim the file it lives in, and the next
 * variable they skim past will matter.
 */

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required — copy .env.example to .env'),
  CMS_PORT: z.coerce.number().int().positive().default(3001),
  /**
   * The exact origin the editorial SPA is served from.
   *
   * Never a wildcard: the CORS policy allows credentials, and a wildcard cannot
   * carry cookies — so a mistake here does not fail loudly, it produces a CMS
   * that silently cannot sign anyone in.
   */
  CMS_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Where uploads are written; the reader API serves the same folder. */
  MEDIA_ROOT: z.string().optional(),
}).superRefine((env, ctx) => {
  /* In production: a persistent media folder, and a site served over HTTPS —
     the session cookie is Secure there, and a browser drops it over http. */
  if (env.NODE_ENV !== 'production') return;
  if (!env.MEDIA_ROOT) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MEDIA_ROOT'], message: 'required in production — a persistent folder for uploads' });
  }
  if (!env.CMS_ORIGIN.startsWith('https://')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CMS_ORIGIN'], message: 'must be the https:// address of the site in production' });
  }
});

export type CmsEnv = z.infer<typeof EnvSchema>;

let cached: CmsEnv | undefined;

export function loadCmsEnv(source: NodeJS.ProcessEnv = process.env): CmsEnv {
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
export function resetCmsEnvCache(): void {
  cached = undefined;
}
