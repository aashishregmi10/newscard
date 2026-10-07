import express, { type Express } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { requestId, sanitizeMongo, errorHandler, notFoundHandler } from './middleware/index.js';
import { v1 } from './routes/index.js';
import { mediaRoot } from '@saar/shared';
import { publicReadLimit } from './middleware/rateLimit.js';

/**
 * One definition, shared with the CMS that writes here and the seed scripts
 * that generate the corpus. Each used to compute `../../../media` from its own
 * file, which agreed by coincidence — and the first deployment putting the API
 * and the CMS on different paths would have separated them silently, the
 * symptom being uploaded images that 404 only in production.
 */
const MEDIA_DIR = mediaRoot();

/**
 * Middleware order is load-bearing:
 *
 *   requestId    first, so every later log line and error carries it
 *   helmet       security headers before anything can respond
 *   compression  br/gzip — matters more than usual on a metered connection
 *   json         body parsing, with a small cap; we accept no large payloads
 *   sanitizeMongo BEFORE any handler touches the body or query
 *   routes
 *   notFound     for anything unrouted
 *   errorHandler LAST — Express only treats 4-arg middleware as an error
 *                handler, and only if it is registered after the routes
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  /*
   * How many proxies sit in front: Caddy alone is 1; a CDN in front of Caddy
   * makes 2. Too few and every reader shares the proxy's address — and so one
   * rate limit for everyone.
   */
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.use(requestId);
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '64kb' }));
  app.use(sanitizeMongo);

  /**
   * Development image host. In production these objects sit behind a CDN and
   * this route does not exist — the API must never proxy images, or it falls
   * over under load and doubles the egress bill (Ch. 2.2).
   *
   * Keys are content-hashed and the files are immutable, so a one-year
   * immutable cache is safe and invalidation is never needed.
   *
   * crossOriginResourcePolicy is relaxed because the app and the images are on
   * different origins in development; helmet's default would block them.
   */
  app.use(
    '/media',
    express.static(MEDIA_DIR, {
      immutable: true,
      maxAge: '365d',
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  /*
   * The advertiser report page used to be served from here, as static files
   * out of apps/api/public. It lives on the editorial site now, because every
   * page a person opens should be at one address — see the proxy note in
   * apps/cms-web/vite.config.ts. This service is an API again, and the only
   * bytes it serves that are not JSON are the media above.
   */
  // Applied to the whole read surface. Deliberately generous: carrier-grade NAT
  // means one apparent IP can be a whole mobile cell (Ch. 6.10).
  app.use('/v1', publicReadLimit, v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
