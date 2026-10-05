import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { Db, ObjectId } from 'mongodb';
import { getDb, interactionCollections } from '@saar/db';
import { AppError, createLogger } from '@saar/shared';
import { loadEnv } from '../config/index.js';

/**
 * Readers who sign in — with Google, only to vote and rate.
 *
 * ── What is kept ────────────────────────────────────────────────────────────
 *
 * Google's account number for the reader (`sub`), and only as an HMAC under a
 * server secret: the same account always maps to the same reader, so it gets
 * one vote, but the stored value cannot be turned back into an account or
 * matched against anyone else's data. No name, no email, no photo. The app
 * shows the reader their own name from the sign-in on the phone; it never
 * comes here.
 *
 * ── The session ─────────────────────────────────────────────────────────────
 *
 * Google's ID token proves who the reader is once, at sign-in, and expires in
 * an hour. The app is given its own random token for 180 days, sent as
 * `Authorization: Reader <token>`; only its SHA-256 is stored, so a copy of
 * the database is not a copy of everyone's sign-in.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      readerId?: ObjectId;
    }
  }
}

const log = createLogger({ service: 'readers' });
const SESSION_DAYS = 180;

/** What a verified Google ID token tells us that we use: the account number. */
export type GoogleVerifier = (idToken: string, audiences: string[]) => Promise<{ sub: string }>;

let googleClient: OAuth2Client | null = null;

const verifyWithGoogle: GoogleVerifier = async (idToken, audiences) => {
  googleClient ??= new OAuth2Client();
  const ticket = await googleClient.verifyIdToken({ idToken, audience: audiences });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('The token names no account.');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
    throw new Error('The token was not issued by Google.');
  }
  return { sub: payload.sub };
};

let verifier: GoogleVerifier = verifyWithGoogle;

/** Tests stand in for Google; nothing else should call this. */
export function setGoogleVerifierForTests(v: GoogleVerifier | null): void {
  verifier = v ?? verifyWithGoogle;
}

let warnedNoReaderSecret = false;

function readerKey(): string {
  const env = loadEnv();
  if (env.READER_ID_SECRET) return env.READER_ID_SECRET;
  if (env.NODE_ENV === 'production') {
    throw new AppError('INTERNAL', 'Reader sign-in is not configured on the server (READER_ID_SECRET).');
  }
  if (!warnedNoReaderSecret) {
    warnedNoReaderSecret = true;
    log.warn('READER_ID_SECRET is not set; using CURSOR_SECRET for reader ids. Set it before production.');
  }
  return env.CURSOR_SECRET;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Verify a Google ID token and start a session. */
export async function signInWithGoogle(
  idToken: string,
  db: Db = getDb(),
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const audiences = loadEnv()
    .GOOGLE_WEB_CLIENT_ID.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (audiences.length === 0) {
    throw new AppError('INTERNAL', 'Google sign-in is not set up on the server yet (GOOGLE_WEB_CLIENT_ID).');
  }

  let sub: string;
  try {
    ({ sub } = await verifier(idToken, audiences));
  } catch (e) {
    log.info('google sign-in refused', { reason: e instanceof Error ? e.message : String(e) });
    throw new AppError('UNAUTHENTICATED', 'Google did not confirm that sign-in. Please try again.');
  }

  const subHash = createHmac('sha256', readerKey()).update(`google:${sub}`).digest('hex');
  const c = interactionCollections(db);
  const reader = await c.readers.findOneAndUpdate(
    { subHash },
    { $setOnInsert: { subHash, createdAt: now }, $set: { lastSeenAt: now } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!reader) throw new AppError('INTERNAL', 'Could not record the sign-in.');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await c.readerSessions.insertOne({
    tokenHash: sha256(token),
    readerId: reader._id,
    createdAt: now,
    expiresAt,
  } as never);
  return { token, expiresAt };
}

function tokenFrom(req: Request): string | null {
  const h = req.header('authorization') ?? '';
  const m = /^Reader\s+([A-Za-z0-9_-]{20,100})$/.exec(h.trim());
  return m ? m[1]! : null;
}

/** For a signed-in reader only. Sets `req.readerId`. */
export async function requireReader(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = tokenFrom(req);
    if (token === null) throw new AppError('UNAUTHENTICATED', 'Sign in with Google to vote or rate.');
    const session = await interactionCollections(getDb()).readerSessions.findOne({
      tokenHash: sha256(token),
      expiresAt: { $gt: new Date() },
    });
    if (!session) throw new AppError('UNAUTHENTICATED', 'Your sign-in has ended. Please sign in again.');
    req.readerId = session.readerId;
    next();
  } catch (e) {
    next(e);
  }
}

/** Sign out: this session only. */
export async function signOut(req: Request): Promise<void> {
  const token = tokenFrom(req);
  if (token === null) return;
  await interactionCollections(getDb()).readerSessions.deleteOne({ tokenHash: sha256(token) });
}
