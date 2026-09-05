import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@newscard/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Attach a request id and echo it on every response.  Spec Ch. 6.2.
 *
 * Costs nothing and turns a user report into one line in the logs. It is also
 * shown in the app's diagnostic screen for exactly that reason.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * Strip MongoDB operators from user input.  Spec Ch. 15.4.
 *
 * Without this, a query parameter like `{"$ne": null}` reaches a filter and
 * changes its meaning. Runs before any handler touches the body, and mutates in
 * place because Express 5 makes req.query a getter.
 */
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
  // req.query is a getter in Express 5; scrub the object it returns in place.
  scrub(req.query);
  next();
}

/** The single error envelope. Registered LAST, after every route. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json(err.toEnvelope(req.requestId));
    return;
  }

  // Errors thrown by body-parser and friends carry an HTTP status. They are
  // client mistakes, not server faults, so they belong in the envelope as-is
  // rather than being logged as unhandled and reported as 500 — an oversized
  // body should not look like an outage in the logs.
  const status = (err as { status?: unknown; statusCode?: unknown })?.status ??
    (err as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = status === 413 ? 'BAD_REQUEST' : 'BAD_REQUEST';
    res.status(status).json({
      error: {
        code,
        message:
          status === 413 ? 'Request body is too large.' : 'The request was malformed.',
        requestId: req.requestId,
        details: null,
      },
    });
    return;
  }

  // Genuinely unhandled: log the real error, tell the client nothing about it.
  console.error(`[${req.requestId}] unhandled`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong on our side.',
      requestId: req.requestId,
      details: null,
    },
  });
}

/** 404 for anything unrouted, in the same envelope. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Not found.',
      requestId: req.requestId,
      details: null,
    },
  });
}

/** Wraps an async handler so a rejected promise reaches errorHandler. */
export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
