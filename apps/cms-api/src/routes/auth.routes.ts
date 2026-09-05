import { Router } from 'express';
import { z } from 'zod';
import { collections, getDb } from '@newscard/db';
import { AppError } from '@newscard/shared';
import { verifyPassword } from '../auth/password.js';
import { createSession, destroySession, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/session.js';
import { asyncRoute } from '../middleware/index.js';

export const authRoutes = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

authRoutes.post(
  '/auth/login',
  asyncRoute(async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Email and password are required.');

    const c = collections(getDb());
    const staff = await c.staff.findOne({ email: parsed.data.email.toLowerCase() });

    // One generic message for every failure path. Distinguishing "no such
    // account" from "wrong password" turns the login form into an account
    // enumerator.
    const reject = () => new AppError('UNAUTHENTICATED', 'Email or password is incorrect.');

    if (!staff || !staff.isActive) throw reject();

    if (staff.lockedUntil && staff.lockedUntil.getTime() > Date.now()) {
      throw new AppError('FORBIDDEN', 'Account temporarily locked. Try again shortly.');
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

    const token = await createSession({
      _id: staff._id,
      email: staff.email,
      role: staff.role,
      languages: staff.languages,
    });

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
        role: staff.role,
        languages: staff.languages,
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

authRoutes.get(
  '/auth/me',
  asyncRoute(async (req, res) => {
    if (!req.staff) throw new AppError('UNAUTHENTICATED');
    res.json({ staff: req.staff });
  }),
);
