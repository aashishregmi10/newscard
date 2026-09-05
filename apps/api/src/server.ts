import 'dotenv/config';
import { connect, close, warnIfNoTransactions } from '@newscard/db';
import { loadEnv } from './config/index.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();

  await connect({ uri: env.MONGO_URI });
  // The read API never opens a transaction, so a standalone MongoDB is fine
  // here — warn and carry on. The CMS asserts instead, because it publishes.
  await warnIfNoTransactions();

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
