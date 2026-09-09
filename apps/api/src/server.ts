import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The single .env lives at the repository ROOT, and it is resolved from this
 * file rather than from process.cwd().
 *
 * `import 'dotenv/config'` reads .env relative to wherever the process happened
 * to start, so the server booted fine from the repository root and failed with
 * "MONGO_URI is not set" when started from its own directory — the same command
 * working or not depending on which folder the terminal was in.
 */
loadDotenv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });
import { connect, close, warnIfNoTransactions } from '@newscard/db';
import { loadEnv } from './config/index.js';
import { createApp } from './app.js';
import { ensureRateLimitIndexes } from './middleware/rateLimit.js';

async function main(): Promise<void> {
  const env = loadEnv();

  await connect({ uri: env.MONGO_URI });
  // The read API never opens a transaction, so a standalone MongoDB is fine
  // here — warn and carry on. The CMS asserts instead, because it publishes.
  await warnIfNoTransactions();
  await ensureRateLimitIndexes();

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    console.log(`api listening on http://localhost:${env.API_PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} — shutting down`);
    server.close();
    await close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (e) => {
  console.error('\nfailed to start:\n' + (e instanceof Error ? e.message : String(e)));
  await close();
  process.exit(1);
});
