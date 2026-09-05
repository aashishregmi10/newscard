/**
 * Role-based access control.  Spec Ch. 5.7, plan §8.
 *
 * The matrix is DATA, not conditionals scattered through route handlers. A
 * permission check that lives in one table can be audited by reading one file;
 * the same logic spread across twelve handlers cannot.
 */

export const STAFF_ROLES = ['author', 'reviewer', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = {
  'queue.read': ['author', 'reviewer', 'admin'],
  'article.write': ['author', 'reviewer', 'admin'],
  'article.submit': ['author', 'reviewer', 'admin'],
  'article.approve': ['reviewer', 'admin'],
  'article.publish': ['reviewer', 'admin'],
  'article.schedule': ['reviewer', 'admin'],
  'article.spike': ['reviewer', 'admin'],
  'article.retract': ['reviewer', 'admin'],
  'notification.send': ['reviewer', 'admin'],
  'source.read': ['author', 'reviewer', 'admin'],
  'source.write': ['admin'],
  'source.setLicence': ['admin'],
  'staff.manage': ['admin'],
  'config.write': ['admin'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: StaffRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}

/**
 * Entity-level rules that are NOT role checks. These depend on the document and
 * the actor together, so they live in the service layer rather than middleware.
 */

export interface ReviewGuardInput {
  authoredBy: string;
  reviewerId: string;
  /** Count of staff accounts with isActive: true. */
  activeStaffCount: number;
  /** Language of the summary being reviewed. */
  articleLanguage: 'ne' | 'en';
  /** Languages the reviewer is competent in (staff.languages). */
  reviewerLanguages: readonly string[];
}

export type ReviewGuardResult =
  | { ok: true; selfApproved: boolean }
  | { ok: false; reason: 'same_author' | 'language_not_competent' };

/**
 * Ch. 3.2.6 + Ch. 5.7. Self-approval is permitted ONLY while exactly one staff
 * account is active, and it stamps selfApproved so the exception is visible in
 * the audit trail rather than invisible in the code. It stops working by itself
 * the moment a second editor is activated — no code change, nobody to remember.
 */
export function checkReviewGuards(input: ReviewGuardInput): ReviewGuardResult {
  if (!input.reviewerLanguages.includes(input.articleLanguage)) {
    return { ok: false, reason: 'language_not_competent' };
  }

  const isSelf = input.authoredBy === input.reviewerId;
  if (isSelf) {
    if (input.activeStaffCount > 1) return { ok: false, reason: 'same_author' };
    return { ok: true, selfApproved: true };
  }

  return { ok: true, selfApproved: false };
}
