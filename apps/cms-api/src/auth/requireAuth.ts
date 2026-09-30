import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@saar/shared';

/**
 * The one gate on the editorial API: signed in, or not.
 *
 * -- Why there are no roles ---------------------------------------------------
 *
 * There were three — author, reviewer, admin — with a permission table mapping
 * them to fourteen actions, and a check on every route. The product has one
 * kind of user: everyone who can sign in to the editorial site is an admin and
 * may do everything in it. A table in which every row says "admin" decides
 * nothing, and every route that consulted it was one more place for a future
 * change to disagree with the others.
 *
 * What still distinguishes one person from another is the audit trail, which
 * records who did what. That needs identity, not rank, so identity is what the
 * session carries.
 */

export interface StaffSession {
  staffId: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffSession;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.staff) {
    next(new AppError('UNAUTHENTICATED'));
    return;
  }
  next();
}
