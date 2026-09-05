import { describe, it, expect } from 'vitest';
import { can, checkReviewGuards, PERMISSIONS } from '../permissions.js';

describe('role matrix', () => {
  it('lets only admin change a source licence — the legal gate', () => {
    expect(can('admin', 'source.setLicence')).toBe(true);
    expect(can('reviewer', 'source.setLicence')).toBe(false);
    expect(can('author', 'source.setLicence')).toBe(false);
  });

  it('does not let an author publish or retract', () => {
    expect(can('author', 'article.publish')).toBe(false);
    expect(can('author', 'article.retract')).toBe(false);
    expect(can('author', 'notification.send')).toBe(false);
  });

  it('lets an author write and submit', () => {
    expect(can('author', 'article.write')).toBe(true);
    expect(can('author', 'article.submit')).toBe(true);
  });

  it('grants admin every permission', () => {
    for (const p of Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>) {
      expect(can('admin', p)).toBe(true);
    }
  });
});

describe('review guards', () => {
  const base = {
    authoredBy: 'staff-1',
    reviewerId: 'staff-2',
    activeStaffCount: 2,
    articleLanguage: 'ne' as const,
    reviewerLanguages: ['ne', 'en'],
  };

  it('allows a different reviewer', () => {
    expect(checkReviewGuards(base)).toEqual({ ok: true, selfApproved: false });
  });

  it('blocks self-approval once a second editor is active', () => {
    const r = checkReviewGuards({ ...base, reviewerId: 'staff-1', activeStaffCount: 2 });
    expect(r).toEqual({ ok: false, reason: 'same_author' });
  });

  it('permits self-approval while there is exactly one active editor, and stamps it', () => {
    const r = checkReviewGuards({ ...base, reviewerId: 'staff-1', activeStaffCount: 1 });
    expect(r).toEqual({ ok: true, selfApproved: true });
  });

  it('the sole-editor exception expires by itself when a second editor arrives', () => {
    const solo = { ...base, reviewerId: 'staff-1', activeStaffCount: 1 };
    expect(checkReviewGuards(solo).ok).toBe(true);
    // No code change, no config change — only the staff count moved.
    expect(checkReviewGuards({ ...solo, activeStaffCount: 2 }).ok).toBe(false);
  });

  it('blocks a reviewer approving in a language they do not read', () => {
    const r = checkReviewGuards({ ...base, reviewerLanguages: ['en'], articleLanguage: 'ne' });
    expect(r).toEqual({ ok: false, reason: 'language_not_competent' });
  });

  it('checks language competence before authorship — a reviewer who cannot read it is blocked even alone', () => {
    const r = checkReviewGuards({
      ...base,
      reviewerId: 'staff-1',
      activeStaffCount: 1,
      reviewerLanguages: ['en'],
      articleLanguage: 'ne',
    });
    expect(r).toEqual({ ok: false, reason: 'language_not_competent' });
  });
});
