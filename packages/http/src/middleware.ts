import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError, createLogger, type LogLevel, type Logger } from '@saar/shared';

/**
 * The Express plumbing both servers need.
 *
 * ── Why this package exists ─────────────────────────────────────────────────
 *
 * apps/api and apps/cms-api each carried their own copy of requestId,
 * sanitizeMongo, errorHandler, notFoundHandler and asyncRoute. They were
 * identical on the day they were copied and not afterwards: the API's error
 * handler grew a message for an oversized body and the CMS's did not, and
 * nobody decided that.
 *
 * The duplication that mattered was `sanitizeMongo`, because it is a SECURITY
 * control. Two copies of a security control means a fix applied to one of them,
 * and no test that can tell you which.
 *
 * No app may import another app, so this could not live in either. It is a
 * package for the same reason the rate counter became one.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * The logger these use.
 *
 * Read from the environment at import time rather than injected, because
 * middleware is constructed before any app code runs. `LOG_LEVEL` has already
 * been validated by whichever server loaded its config; this is the same value,
 * read defensively.
 */
const LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);
const envLevel = process.env.LOG_LEVEL;
const log: Logger = createLogger({
  level: LEVELS.has(envLevel ?? '') ? (envLevel as LogLevel) : 'info',
  service: 'http',
});

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
 * changes its meaning. Runs before any handler touches the body.
 *
 * Everything is mutated IN PLACE rather than reassigned. On Express 4 either
 * would work; on Express 5 req.query is a getter and an assignment throws, so
 * in-place scrubbing is what survives the upgrade.
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
  const status =
    (err as { status?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({
      error: {
        code: 'BAD_REQUEST',
        message: status === 413 ? 'Request body is too large.' : 'The request was malformed.',
        requestId: req.requestId,
        details: null,
      },
    });
    return;
  }

  // Genuinely unhandled: log the real error, tell the client nothing about it.
  // The request id is a FIELD, so a user report maps to a query rather than to
  // a grep through interpolated text.
  log.error('unhandled error', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    err,
  });

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
