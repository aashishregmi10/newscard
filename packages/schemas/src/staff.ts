import { z } from 'zod';

/**
 * The `staff` collection.  Spec Ch. 3.10.
 *
 * Every account is an admin of the editorial site, so there is no role, and
 * no per-person language list — that existed only so a reviewer could be
 * refused copy in a language they did not read, and there are no reviewers.
 * Documents written before this keep those two fields; nothing reads them.
 */
export const Staff = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  /** Deactivation preserves the audit trail; deletion would orphan it. */
  isActive: z.boolean().default(true),
  passwordHash: z.string().min(1),
  /** TOTP secret, encrypted at rest with a key from the secret store — not with
   *  a key that lives in the same database. Required for `admin`. */
  mfaSecret: z.string().nullable().optional(),
  lastLoginAt: z.date().nullable().optional(),
  failedLoginCount: z.number().int().nonnegative().default(0),
  lockedUntil: z.date().nullable().optional(),
});
export type Staff = z.infer<typeof Staff>;

/** Audit records are append-only. There is no update or delete path in code. */
export const AuditRecord = z.object({
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  actorId: z.string().nullable(),
  /** Denormalised so the trail survives account deletion. */
  actorEmail: z.string().nullable(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  at: z.date(),
});
export type AuditRecord = z.infer<typeof AuditRecord>;
