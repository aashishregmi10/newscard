import { randomBytes, createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb } from '@newscard/db';
import type { StaffSession } from './requireRole.js';

/**
 * Server-side sessions.  Spec Ch. 13.7.
 *
 * Deliberately NOT a JWT. Offboarding an editor must revoke access immediately,
 * and a stateless token cannot be revoked before it expires. A row in a
 * collection can be deleted.
 *
 * Only the SHA-256 of the session id is stored, for the same reason passwords
 * are hashed: a database dump must not yield working credentials.
 */

export const SESSION_COOKIE = 'newscard_cms';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface SessionDoc {
  _id: ObjectId;
  tokenHash: string;
  staffId: ObjectId;
  email: string;
  role: string;
  languages: string[];
  expiresAt: Date;
  createdAt: Date;
}

const sessions = () => getDb().collection<SessionDoc>('sessions');

export async function createSession(staff: {
  _id: ObjectId;
  email: string;
  role: string;
  languages: string[];
}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sessions().insertOne({
    _id: new ObjectId(),
    tokenHash: sha256(token),
    staffId: staff._id,
    email: staff.email,
    role: staff.role,
    languages: staff.languages,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    createdAt: new Date(),
  });
  return token;
}

export async function readSession(token: string | undefined): Promise<StaffSession | null> {
  if (!token) return null;
  const doc = await sessions().findOne({ tokenHash: sha256(token) });
  if (!doc) return null;
  if (doc.expiresAt.getTime() < Date.now()) {
    await sessions().deleteOne({ _id: doc._id });
    return null;
  }
  return {
    staffId: doc.staffId.toString(),
    email: doc.email,
    role: doc.role as StaffSession['role'],
    languages: doc.languages,
  };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await sessions().deleteOne({ tokenHash: sha256(token) });
}

/** Revoke every session for one person. Used on deactivation. */
export async function destroyAllSessionsFor(staffId: string): Promise<number> {
  const r = await sessions().deleteMany({ staffId: new ObjectId(staffId) });
  return r.deletedCount;
}

/** TTL index so expired rows disappear without a sweep job. */
export async function ensureSessionIndexes(): Promise<void> {
  await sessions().createIndex({ tokenHash: 1 }, { unique: true, name: 'session_token' });
  await sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'session_ttl' });
}
