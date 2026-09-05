import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id. The library exports this as an ambient const enum, which cannot be
 * referenced under `isolatedModules`, so the numeric value is inlined — it is
 * part of the library's public API and stable.
 */
const ARGON2ID = 2;

/**
 * Staff password hashing.  Spec Ch. 13.7.
 *
 * Argon2id with the parameters from the spec: 64 MB memory, 3 iterations,
 * parallelism 4. Memory cost is what makes GPU cracking expensive, and it is the
 * parameter people quietly reduce when hashing feels slow — it should not be
 * reduced, because a CMS login happens a handful of times a day.
 *
 * Readers have no password at all (Ch. 13.1), so this is only ever used for the
 * handful of accounts that can publish.
 */

const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash — a corrupt
 * record must read as "wrong password", never as a 500 that reveals the account
 * exists.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    return false;
  }
}

/** Spec Ch. 13.7: 12 characters minimum. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordPolicyError(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
