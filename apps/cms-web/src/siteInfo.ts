/**
 * Who runs SAAR, and how to reach them — every public page (Contact, Privacy,
 * Terms, Delete account) reads it from here, so the real details are one edit.
 *
 * PLACEHOLDERS until the owners supply them (launch plan of 7 Oct 2026, step
 * E4): the registered business name and address, and inboxes someone reads.
 * Google Play's News and privacy rules need a real contact, and the takedown
 * promise on the About page is only as good as the address it points to.
 */
export const SITE = {
  /** The registered business that publishes SAAR, as on the Play listing. */
  operator: 'SAAR',
  address: 'Kathmandu, Nepal',
  emails: {
    publishers: 'publishers@example.invalid',
    advertising: 'advertising@example.invalid',
    legal: 'legal@example.invalid',
    privacy: 'privacy@example.invalid',
  },
  /** When the Privacy Policy and Terms last changed. */
  policyDate: '7 October 2026',
} as const;
