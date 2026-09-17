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
import { createLogger, drainHttpServer } from '@saar/shared';
import { startDeferredSweep, startReceiptReconciliation } from '@saar/worker';
import { ensureSessionIndexes } from './auth/session.js';
import { loadCmsEnv } from './config/index.js';

/**
 * The allowed origin is passed in rather than read from the environment here,
 * so building the app needs no environment at all — which is what lets a test
 * mount it in-process.
 */
export function createCmsApp(ORIGIN = 'http://localhost:5173') {
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
  // Parsed and validated once, failing at boot with the offending variable
  // named — rather than surfacing an hour later as NaN in a port or undefined
  // in a URI.
  const env = loadCmsEnv();
  const log = createLogger({ level: env.LOG_LEVEL, service: 'cms-api' });

  await connect({ uri: env.MONGO_URI });
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

  const server = createCmsApp(env.CMS_ORIGIN).listen(env.CMS_PORT, () => {
    log.info('cms-api listening', {
      url: `http://localhost:${env.CMS_PORT}`,
      allowingOrigin: env.CMS_ORIGIN,
    });
  });

  const shutdown = async (sig: string) => {
    log.info('shutting down', { signal: sig });
    stopSweep();
    stopReceipts();
    // See the note in apps/api/src/server.ts: close() only stops accepting.
    const { drained, waitedMs } = await drainHttpServer(server);
    if (drained) log.info('drained', { waitedMs });
    else log.warn('gave up draining — some requests were cut', { waitedMs });
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
