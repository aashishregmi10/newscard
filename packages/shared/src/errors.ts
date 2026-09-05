/**
 * The single error envelope.  Spec Ch. 6.2.
 *
 * Clients switch on `code`, never on `message` and never on the HTTP status
 * alone. `requestId` is echoed on every response and shown in the app's
 * diagnostic screen, so a user report maps to one line in the logs.
 */

export const ERROR_CODES = {
  BAD_REQUEST: { status: 400, message: 'The request was malformed.' },
  INVALID_CURSOR: { status: 400, message: 'The pagination cursor is malformed or expired.' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication is required.' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to do that.' },
  NOT_FOUND: { status: 404, message: 'Not found.' },
  INVALID_TRANSITION: { status: 409, message: 'That state change is not allowed.' },
  GONE: { status: 410, message: 'This story was withdrawn.' },
  VALIDATION_FAILED: { status: 422, message: 'The request failed validation.' },
  UPGRADE_REQUIRED: { status: 426, message: 'Please update the app to continue.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests.' },
  INTERNAL: { status: 500, message: 'Something went wrong on our side.' },
  MAINTENANCE: { status: 503, message: 'Down for maintenance.' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    const spec = ERROR_CODES[code];
    super(message ?? spec.message);
    this.name = 'AppError';
    this.code = code;
    this.status = spec.status;
    this.details = details ?? null;
  }

  toEnvelope(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        details: this.details,
      },
    };
  }
}

export const badRequest = (m?: string, d?: unknown) => new AppError('BAD_REQUEST', m, d);
export const notFound = (m?: string) => new AppError('NOT_FOUND', m);
export const forbidden = (m?: string) => new AppError('FORBIDDEN', m);
export const gone = (m?: string) => new AppError('GONE', m, { retracted: true });
export const validationFailed = (d?: unknown) => new AppError('VALIDATION_FAILED', undefined, d);
export const invalidTransition = (from: string, to: string) =>
  new AppError('INVALID_TRANSITION', `Cannot move from ${from} to ${to}.`, { from, to });
