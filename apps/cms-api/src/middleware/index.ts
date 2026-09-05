import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@newscard/shared';
import { readSession, SESSION_COOKIE } from '../auth/session.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

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

export function sanitizeMongo(req: Request, _res: Response, next: NextFunction): void {
  const scrub = (value: unknown, depth = 0): void => {
    if (depth > 10 || value === null || typeof value !== 'object') return;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete (value as Record<string, unknown>)[key];
        continue;
      }
      scrub((value as Record<string, unknown>)[key], depth + 1);
    }
  };
  scrub(req.body);
  scrub(req.params);
  scrub(req.query);
  next();
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json(err.toEnvelope(req.requestId));
    return;
  }
  const status =
    (err as { status?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({
      error: { code: 'BAD_REQUEST', message: 'The request was malformed.', requestId: req.requestId, details: null },
    });
    return;
  }
  console.error(`[${req.requestId}] unhandled`, err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId: req.requestId, details: null },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Not found.', requestId: req.requestId, details: null },
  });
}

export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
