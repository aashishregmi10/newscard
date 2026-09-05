import { ObjectId } from 'mongodb';
import { collections, getDb } from '@newscard/db';
import { AppError } from '@newscard/shared';
import { canTransition, type ArticleStatus } from '@newscard/schemas';
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
