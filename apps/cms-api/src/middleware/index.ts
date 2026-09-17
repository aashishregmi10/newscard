import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@saar/shared';
import { readSession, SESSION_COOKIE } from '../auth/session.js';

/**
 * CMS-specific middleware.
 *
 * The generic plumbing — request ids, Mongo sanitisation, the error envelope —
 * is re-exported from @saar/http rather than defined again here. It used to be
 * defined twice, and the copies had already drifted.
 *
 * What remains below is genuinely specific to an authenticated admin tool.
 */
export {
  requestId,
  sanitizeMongo,
  errorHandler,
  notFoundHandler,
  asyncRoute,
} from '@saar/http';

/** Attach the session, if any. Does not reject — requireAuth does that. */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  readSession(req.cookies?.[SESSION_COOKIE])
    .then((s) => {
      if (s) req.staff = s;
      next();
    })
    .catch(next);
}

/**
 * CSRF: a state-changing request must carry a header the browser will not add
 * on a cross-site form post. Combined with SameSite=Strict on the session
 * cookie this is sufficient for a same-origin admin tool (Ch. 15.4).
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'newscard-cms') {
    next(new AppError('FORBIDDEN', 'Missing CSRF header.'));
    return;
  }
  next();
}
