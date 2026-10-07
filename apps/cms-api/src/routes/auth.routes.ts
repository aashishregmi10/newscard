import { Router } from 'express';
import { z } from 'zod';
import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { equalisePasswordTiming, hashPassword, verifyPassword } from '../auth/password.js';
import {
  createSession,
  destroyAllSessionsFor,
  destroySession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../auth/session.js';
import { asyncRoute } from '../middleware/index.js';
import { clearLoginAttempts, loginLimit } from '../middleware/rateLimit.js';

export const authRoutes = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

authRoutes.post(
  '/auth/login',
  // Per-IP, on top of the per-account lockout below. The lockout stops one
  // password being ground against one account; it does nothing about the same
  // password being sprayed across every account, and nothing about the CPU an
  // unbounded queue of Argon2id verifications costs.
  loginLimit,
  asyncRoute(async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Email and password are required.');

    const c = collections(getDb());
    const staff = await c.staff.findOne({ email: parsed.data.email.toLowerCase() });

    // One generic message for every failure path. Distinguishing "no such
    // account" from "wrong password" turns the login form into an account
    // enumerator.
    const reject = () => new AppError('UNAUTHENTICATED', 'Email or password is incorrect.');

    if (!staff || !staff.isActive) {
      // Spend the same time we would have spent verifying, so the response
      // time does not answer a question the error message refuses to.
      await equalisePasswordTiming(parsed.data.password);
      throw reject();
    }

    // Locked: the same answer, in the same time, as any other failure. Saying
    // "temporarily locked" was only ever true of real accounts, so it told
    // anyone which emails exist. Fifteen minutes later it opens again.
    if (staff.lockedUntil && staff.lockedUntil.getTime() > Date.now()) {
      await equalisePasswordTiming(parsed.data.password);
      throw reject();
    }

    const ok = await verifyPassword(staff.passwordHash, parsed.data.password);
    if (!ok) {
      const failed = (staff.failedLoginCount ?? 0) + 1;
      await c.staff.updateOne(
        { _id: staff._id },
        {
          $set: {
            failedLoginCount: failed,
            ...(failed >= LOCKOUT_THRESHOLD
              ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS), failedLoginCount: 0 }
              : {}),
          },
        },
      );
      throw reject();
    }

    await c.staff.updateOne(
      { _id: staff._id },
      { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
    );

    // A person who mistyped twice and then got it right should not carry
    // those attempts for the rest of the window.
    await clearLoginAttempts(req);

    const token = await createSession({ _id: staff._id, email: staff.email });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    res.json({
      staff: {
        id: staff._id.toString(),
        email: staff.email,
        name: staff.name,
      },
    });
  }),
);

authRoutes.post(
  '/auth/logout',
  asyncRoute(async (req, res) => {
    await destroySession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

const PasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12, 'At least 12 characters.').max(200),
});

/**
 * Change one's own password. The current one must be given — a session left
 * open on a shared computer must not be enough to take the account. Every
 * other session ends (a password change is what someone does when they think
 * it was seen), and this one is replaced, so the person stays signed in here.
 */
authRoutes.post(
  '/auth/password',
  loginLimit,
  asyncRoute(async (req, res) => {
    if (!req.staff) throw new AppError('UNAUTHENTICATED');
    const parsed = PasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('BAD_REQUEST', parsed.error.issues[0]?.message ?? 'Give the current and the new password.');
    }
    if (parsed.data.newPassword === parsed.data.currentPassword) {
      throw new AppError('BAD_REQUEST', 'The new password must differ from the current one.');
    }

    const c = collections(getDb());
    const staff = await c.staff.findOne({ email: req.staff.email });
    if (!staff || !staff.isActive) throw new AppError('UNAUTHENTICATED');
    if (!(await verifyPassword(staff.passwordHash, parsed.data.currentPassword))) {
      throw new AppError('UNAUTHENTICATED', 'The current password is not right.');
    }

    await c.staff.updateOne(
      { _id: staff._id },
      { $set: { passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() } },
    );
    await destroyAllSessionsFor(staff._id.toString());
    const token = await createSession({ _id: staff._id, email: staff.email });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    res.json({ ok: true });
  }),
);

authRoutes.get(
  '/auth/me',
  asyncRoute(async (req, res) => {
    if (!req.staff) throw new AppError('UNAUTHENTICATED');
    res.json({ staff: req.staff });
  }),
);
