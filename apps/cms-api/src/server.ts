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
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { connect, close, warnIfNoTransactions, ensureRateCounterIndexes } from '@saar/db';
import {
  requestId,
  attachSession,
  requireCsrfHeader,
  sanitizeMongo,
  errorHandler,
  notFoundHandler,
} from './middleware/index.js';
import { authRoutes } from './routes/auth.routes.js';
import { articleRoutes } from './routes/articles.routes.js';
import { notificationRoutes } from './routes/notifications.routes.js';
import { clientErrorRoutes } from './routes/clientErrors.routes.js';
import { drainHttpServer } from '@saar/shared';
import { startDeferredSweep, startReceiptReconciliation } from '@saar/worker';
import { ensureSessionIndexes } from './auth/session.js';

const PORT = Number(process.env.CMS_PORT ?? 3001);
const ORIGIN = process.env.CMS_ORIGIN ?? 'http://localhost:5173';

export function createCmsApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '256kb' }));
  app.use(sanitizeMongo);

  // Same-origin in production (the SPA is served by this process). In dev the
  // Vite server is on another port, so credentials must be allowed explicitly
  // for exactly that origin — never a wildcard, which cannot carry cookies.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(requireCsrfHeader);
  app.use(attachSession);

  app.use('/api', authRoutes);
  app.use('/api', articleRoutes);
  app.use('/api', notificationRoutes);
  app.use('/api', clientErrorRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Copy .env.example to .env first.');

  await connect({ uri });
  // Publishing no longer requires transactions, so a standalone MongoDB is
  // supported. Warn, because a replica set is still the safer deployment.
  await warnIfNoTransactions();
  await ensureSessionIndexes();
  // Shared with the read API — the login limiter writes to the same counters.
  await ensureRateCounterIndexes();

  // Breaking news held for quiet hours is released by this. It lives in the
  // CMS because the CMS is the process that sends; the sweep claims each
  // notification with a compare-and-swap, so running it in more than one
  // process is safe rather than merely unlikely to collide.
  const stopSweep = startDeferredSweep();
  // Turns "Expo accepted it" into "a handset showed it". Until this ran,
  // stats.delivered was the accepted count wearing the delivered name.
  const stopReceipts = startReceiptReconciliation();

  const server = createCmsApp().listen(PORT, () => {
    console.log(`cms-api listening on http://localhost:${PORT} (allowing ${ORIGIN})`);
  });

  const shutdown = async (sig: string) => {
    console.log(`\n${sig} — shutting down`);
    stopSweep();
    stopReceipts();
    // See the note in apps/api/src/server.ts: close() only stops accepting.
    const { drained, waitedMs } = await drainHttpServer(server);
    console.log(
      drained
        ? `drained in ${waitedMs}ms`
        : `gave up draining after ${waitedMs}ms — some requests were cut`,
    );
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test') {
  main().catch(async (e) => {
    console.error('\nfailed to start:\n' + (e instanceof Error ? e.message : String(e)));
    await close();
    process.exit(1);
  });
}
