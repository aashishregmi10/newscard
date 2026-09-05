import type { NextFunction, Request, Response } from 'express';
import { AppError, can, type Permission, type StaffRole } from '@newscard/shared';

/**
 * RBAC middleware.  Spec Ch. 5.7, plan §8.
 *
 * Routes declare the PERMISSION they need, never the roles that happen to have
 * it. The role→permission mapping lives in one table in @newscard/shared, so
 * the whole authorisation surface can be audited by reading one file instead of
 * grepping twelve handlers for `role === 'admin'`.
 */

export interface StaffSession {
  staffId: string;
  email: string;
  role: StaffRole;
  languages: string[];
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

export function requireRole(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.staff) {
      next(new AppError('UNAUTHENTICATED'));
      return;
    }
    if (!can(req.staff.role, permission)) {
      next(
        new AppError('FORBIDDEN', `Your role (${req.staff.role}) cannot ${permission}.`, {
          permission,
        }),
      );
      return;
    }
    next();
  };
}
