import { collections, getDb } from '@saar/db';
import { AppError } from '@saar/shared';
import { Source, type LicenceStatus } from '@saar/schemas';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Changing a publisher's licence.  Spec Ch. 3.5, Ch. 15.5.
 *
 * -- Why this is a service and the rest of the CRUD is not -------------------
 *
 * Everything else about a publisher is a form: a name, a logo, a feed URL. This
 * one field is the legal position, and it behaves like `publishArticle` rather
 * than like a form — several guards that must hold together, a compare-and-swap
 * so a concurrent edit cannot be overwritten, and an audit line that is the
 * evidence we held an agreement on a given date.
 *
 * -- What it deliberately does NOT do ----------------------------------------
 *
 * Withdrawing a licence does not touch articles already published under it.
 * Retraction requires a per-article reason and is an editorial act with its own
 * audited path; bulk-retracting a catalogue from a dropdown is exactly the kind
 * of irreversible convenience that should need its own screen and its own
 * review. What the system already guarantees is that new work stops
 * immediately — `POST /cms/articles` refuses at creation and `publishArticle`
 * re-checks at publication. The count of what is already live is returned, and
 * written into the audit line, so the decision is made with it in view.
 */

export interface SetLicenceInput {
  slug: string;
  status: LicenceStatus;
  agreementRef?: string | null;
  agreedAt?: Date | null;
  contactEmail?: string | null;
  /** Required when the licence LEAVES `agreed`. Not stored — it is the audit line. */
  note?: string | undefined;
  actorId: string;
  actorEmail: string;
  ip: string | null;
}

export interface SourceLicenceValue {
  status: LicenceStatus;
  agreementRef: string | null;
  agreedAt: Date | null;
  contactEmail: string | null;
}

export interface SetLicenceResult {
  licence: SourceLicenceValue;
  /** Articles already live under the old licence. Zero unless it was downgraded. */
  publishedArticles: number;
  wasDowngraded: boolean;
}

/** Minimum length of the reason for withdrawing a licence. Matches the
 *  rejection-note rule in transition.service.ts — same idea, same number. */
const NOTE_MIN = 10;

export async function setSourceLicence(input: SetLicenceInput): Promise<SetLicenceResult> {
  const c = collections(getDb());
  const before = await c.sources.findOne({ slug: input.slug });
  if (!before) throw new AppError('NOT_FOUND', 'No such publisher.');

  const wasAgreed = before.licence?.status === 'agreed';
  const wasDowngraded = wasAgreed && input.status !== 'agreed';

  /*
   * A reason is required to take a licence away, and not to grant one.
   *
   * That asymmetry is deliberate: granting is evidenced by `agreementRef` and
   * `agreedAt`, which are fields. Withdrawing is evidenced by nothing at all
   * unless we ask for it here — and "why did we stop using them in March" is
   * exactly the question somebody asks a year later.
   */
  if (wasDowngraded && (input.note ?? '').trim().length < NOTE_MIN) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Withdrawing a licence needs a reason of at least ${NOTE_MIN} characters.`,
      { field: 'note' },
    );
  }

  const now = new Date();
  const next: SourceLicenceValue = {
    status: input.status,
    agreementRef:
      input.agreementRef !== undefined ? input.agreementRef : (before.licence?.agreementRef ?? null),
    /*
     * Becoming agreed stamps the date if the caller did not supply one. Leaving
     * agreed KEEPS the old date rather than clearing it: the fact that we held
     * an agreement, and from when, is a record we may need long after the
     * arrangement ends. Nulling it destroys evidence to tidy a field.
     */
    agreedAt:
      input.agreedAt !== undefined
        ? input.agreedAt
        : input.status === 'agreed'
          ? (before.licence?.agreedAt ?? now)
          : (before.licence?.agreedAt ?? null),
    contactEmail:
      input.contactEmail !== undefined ? input.contactEmail : (before.licence?.contactEmail ?? null),
  };

  /*
   * Re-validate the WHOLE document against the shared schema rather than
   * re-implementing its rules here. This is what enforces "contactEmail is
   * required once a licence is agreed" — the rule lives in exactly one place
   * (packages/schemas/src/source.ts) and this is its first enforcement point.
   */
  const check = Source.safeParse({
    slug: before.slug,
    displayName: before.displayName,
    homepageUrl: before.homepageUrl,
    logoUrl: before.logoUrl ?? null,
    language: before.language,
    licence: next,
    ingest: before.ingest,
    priority: before.priority,
    isActive: before.isActive,
  });
  if (!check.success) {
    throw new AppError('VALIDATION_FAILED', 'This licence is not storable.', {
      issues: check.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  /* Counted BEFORE the write, so the number describes what the decision is
     actually stranding rather than what it stranded. Served by `by_source`. */
  const publishedArticles = wasDowngraded
    ? await c.articles.countDocuments({ sourceId: before._id, status: 'published' })
    : 0;

  /*
   * COMPARE-AND-SWAP on the status we made the checks against, exactly as
   * publishArticle does. Two admins on the licence screen at once is rare and
   * the consequence of losing one of their writes is legal, not cosmetic.
   *
   * Dot-notated rather than `$set: { licence: next }`: replacing the whole
   * sub-document would silently drop any licence field a later version of the
   * schema adds.
   */
  const write = await c.sources.updateOne(
    { _id: before._id, 'licence.status': before.licence?.status },
    {
      $set: {
        'licence.status': next.status,
        'licence.agreementRef': next.agreementRef,
        'licence.agreedAt': next.agreedAt,
        'licence.contactEmail': next.contactEmail,
        updatedAt: now,
      },
    },
  );

  if (write.matchedCount === 0) {
    throw new AppError(
      'INVALID_TRANSITION',
      'This publisher’s licence changed while you were editing it. Reload and try again.',
      { from: before.licence?.status ?? null, to: next.status },
    );
  }

  await writeAudit({
    action: 'source.setLicence',
    entityType: 'source',
    entityId: before._id.toString(),
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    before: { licence: before.licence ?? null },
    after: {
      licence: next,
      note: input.note?.trim() ?? null,
      publishedArticles,
    },
    ip: input.ip,
  });

  return { licence: next, publishedArticles, wasDowngraded };
}
