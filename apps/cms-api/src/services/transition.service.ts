import { ObjectId } from 'mongodb';
import { collections, getDb } from '@saar/db';
import { AppError, checkReviewGuards } from '@saar/shared';
import { canTransition, type ArticleStatus } from '@saar/schemas';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Non-publishing state changes.  Spec Ch. 3.3.1.
 *
 * Publishing, scheduling, and retraction live in publish.service.ts because they
 * carry extra preconditions and a transaction. Everything else — submit, reject,
 * spike — is a simple guarded update, and lives here so there is exactly one
 * place that decides whether a move is legal.
 */

export interface TransitionInput {
  articleId: string;
  to: ArticleStatus;
  actorId: string;
  actorEmail: string;
  ip: string | null;
  /** Required when rejecting back to draft (Ch. 3.3.1). */
  note?: string | undefined;
  /** Needed to judge an approval: who is doing it, and in which languages. */
  actorLanguages?: readonly string[] | undefined;
  spikeReason?: 'editorial' | 'clustered' | 'duplicate' | 'stale' | undefined;
}

const HANDLED_ELSEWHERE: ReadonlySet<ArticleStatus> = new Set([
  'published',
  'scheduled',
  'retracted',
]);

export async function transitionArticle(input: TransitionInput): Promise<ArticleStatus> {
  if (HANDLED_ELSEWHERE.has(input.to)) {
    throw new AppError(
      'BAD_REQUEST',
      `Use the publish or retract endpoint to move an article to ${input.to}.`,
    );
  }

  const c = collections(getDb());
  const article = await c.articles.findOne({ _id: new ObjectId(input.articleId) });
  if (!article) throw new AppError('NOT_FOUND');

  if (!canTransition(article.status, input.to)) {
    throw new AppError('INVALID_TRANSITION', `Cannot move from ${article.status} to ${input.to}.`, {
      from: article.status,
      to: input.to,
    });
  }

  /*
   * Approving is a review, and reviews have rules.
   *
   * `checkReviewGuards` ran only inside `publishArticle`, which meant the
   * two-person rule was enforced at the moment of publication and not at the
   * moment of approval — so the approval itself, which is the act the rule is
   * about, was unguarded. The same guard, at the step it names.
   *
   * It self-expires: while exactly one editor is active, approving your own
   * summary is allowed and is stamped as such. It stops being allowed the
   * moment a second account is activated, with no code change.
   */
  if (input.to === 'approved') {
    const activeStaffCount = await c.staff.countDocuments({ isActive: true });
    const guard = checkReviewGuards({
      authoredBy: article.authoredBy.toString(),
      reviewerId: input.actorId,
      activeStaffCount,
      articleLanguage: article.language,
      reviewerLanguages: input.actorLanguages ?? [],
    });
    if (!guard.ok) {
      const message =
        guard.reason === 'same_author'
          ? 'You cannot approve your own summary now that another editor is active.'
          : `You are not registered as able to review ${article.language} copy.`;
      throw new AppError('VALIDATION_FAILED', message, { reason: guard.reason });
    }
  }

  // A rejection with no explanation is a message the author cannot act on.
  if (article.status === 'in_review' && input.to === 'draft') {
    if (!input.note || input.note.trim().length < 10) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A rejection note of at least 10 characters is required.',
      );
    }
  }

  const set: Record<string, unknown> = { status: input.to, updatedAt: new Date() };
  if (input.to === 'approved') {
    /* Recorded on the article so the exception is visible in the trail rather
       than invisible in the code — the same stamp publishing writes. */
    set.reviewedBy = new ObjectId(input.actorId);
    set.selfApproved = article.authoredBy.toString() === input.actorId;
  }
  if (input.to === 'spiked') set.spikeReason = input.spikeReason ?? 'editorial';
  if (input.note) set.editorialNotes = input.note.trim();
  if (input.to === 'draft') set.revisionCount = (article.revisionCount ?? 0) + 1;

  await c.articles.updateOne({ _id: article._id }, { $set: set });

  await writeAudit({
    action: `article.${input.to}`,
    entityType: 'article',
    entityId: input.articleId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    before: { status: article.status },
    after: { status: input.to },
    ip: input.ip,
  });

  return input.to;
}
