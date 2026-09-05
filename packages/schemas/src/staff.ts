import { z } from 'zod';
import { LanguageEnum, StaffRoleEnum } from './enums.js';

/** The `staff` collection.  Spec Ch. 3.10. */
export const Staff = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: StaffRoleEnum,
  /** A reviewer must not approve a summary in a language they cannot read
   *  (Ch. 3.10). Enforced by checkReviewGuards in @newscard/shared. */
  languages: z.array(LanguageEnum).min(1),
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
