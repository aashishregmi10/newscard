import { ObjectId } from 'mongodb';
import { collections, getClient, getDb } from '@newscard/db';
import {
  AppError,
  checkReviewGuards,
  measureSummary,
  type LimitType,
} from '@newscard/shared';
import { canTransition, DEFAULT_CONFIG, type ArticleStatus } from '@newscard/schemas';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * Publishing.  Spec Fig. 4.3 and Ch. 4.9.
 *
 * The ONLY code path that makes content visible to readers, and the one place
 * where several checks must all hold together. It runs in a transaction because
 * a half-applied publish — status changed but denormalised source name not
 * copied — renders as a card with a blank publisher, which is precisely the
 * attribution failure the product cannot afford.
 */

export interface PublishInput {
  articleId: string;
  actorId: string;
  actorEmail: string;
  actorRole: string;
  actorLanguages: readonly string[];
  ip: string | null;
  /** Omit to publish now; provide a future date to schedule. */
  scheduledFor?: Date | undefined;
}

export interface PublishResult {
  status: ArticleStatus;
  publishedAt: Date | null;
  selfApproved: boolean;
}

export async function publishArticle(input: PublishInput): Promise<PublishResult> {
  const db = getDb();
  const c = collections(db);
  const session = getClient().startSession();

  const targetStatus: ArticleStatus = input.scheduledFor ? 'scheduled' : 'published';
  let result: PublishResult | undefined;

  try {
    await session.withTransaction(async () => {
      const article = await c.articles.findOne(
        { _id: new ObjectId(input.articleId) },
        { session },
      );
      if (!article) throw new AppError('NOT_FOUND', 'No such article.');

      // ── 1. the state machine ────────────────────────────────────────────
      if (!canTransition(article.status, targetStatus)) {
        throw new AppError(
          'INVALID_TRANSITION',
          `Cannot move from ${article.status} to ${targetStatus}.`,
          { from: article.status, to: targetStatus },
        );
      }

      // ── 2. the source licence, re-checked ───────────────────────────────
      // Ingestion already applied this gate. It is repeated here as defence in
      // depth: a source can be downgraded from `agreed` to `refused` between
      // ingestion and publication, and that is exactly the moment when
      // publishing would be most damaging.
      const source = await c.sources.findOne({ _id: article.sourceId }, { session });
      if (!source) throw new AppError('VALIDATION_FAILED', 'Article has no source.');
      if (source.licence.status !== 'agreed' || !source.isActive) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Cannot publish: ${source.displayName} is not a licensed, active source.`,
          { sourceSlug: source.slug, licenceStatus: source.licence.status },
        );
      }

      // ── 3. image licence ────────────────────────────────────────────────
      // The single highest legal-risk field in the data model. An unlicensed
      // photograph is the most likely cause of a takedown demand against us.
      if (article.image) {
        const valid = ['publisher_licensed', 'agency', 'cc_by', 'own'];
        if (!article.image.licence || !valid.includes(article.image.licence)) {
          throw new AppError('VALIDATION_FAILED', 'Image has no recognised licence.', {
            licence: article.image.licence ?? null,
          });
        }
        if (!article.image.credit) {
          throw new AppError('VALIDATION_FAILED', 'Image has no credit.');
        }
      }

      // ── 4. summary length, per the CURRENT config ───────────────────────
      // Read from config rather than a constant, because Gate 2 may change both
      // the limit and the unit it is measured in.
      const cfg = (await c.config.findOne({}, { session })) ?? DEFAULT_CONFIG;
      const limits = cfg.summaryLimits ?? DEFAULT_CONFIG.summaryLimits;
      const band = limits.limits[article.language];
      const measured = measureSummary(
        article.summary,
        limits.limitType as LimitType,
        article.language,
      );
      if (measured < band.min || measured > band.max) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Summary is ${measured} ${limits.limitType}; allowed ${band.min}–${band.max}.`,
          { measured, min: band.min, max: band.max, unit: limits.limitType },
        );
      }

      // ── 5. reviewer guards ──────────────────────────────────────────────
      // Reviewer must differ from the author, unless this is still a one-person
      // operation; and must be able to read the language they are approving.
      const activeStaffCount = await c.staff.countDocuments({ isActive: true }, { session });
      const guard = checkReviewGuards({
        authoredBy: article.authoredBy.toString(),
        reviewerId: input.actorId,
        activeStaffCount,
        articleLanguage: article.language,
        reviewerLanguages: input.actorLanguages,
      });
      if (!guard.ok) {
        const message =
          guard.reason === 'same_author'
            ? 'You cannot approve your own summary now that another editor is active.'
            : `You are not registered as able to review ${article.language} copy.`;
        throw new AppError('VALIDATION_FAILED', message, { reason: guard.reason });
      }

      const now = new Date();
      const publishedAt = targetStatus === 'published' ? now : null;

      await c.articles.updateOne(
        { _id: article._id },
        {
          $set: {
            status: targetStatus,
            publishedAt,
            scheduledFor: input.scheduledFor ?? null,
            // Denormalise at publish time so the feed needs no lookup per card.
            sourceName: source.displayName,
            sourceLogoUrl: source.logoUrl ?? null,
            reviewedBy: new ObjectId(input.actorId),
            selfApproved: guard.selfApproved,
            updatedAt: now,
          },
        },
        { session },
      );

      result = { status: targetStatus, publishedAt, selfApproved: guard.selfApproved };
    });
  } finally {
    await session.endSession();
  }

  if (!result) throw new AppError('INTERNAL', 'Publish did not complete.');

  // Outside the transaction: audit is append-only and best-effort. A failed
  // audit write must not roll back a correct publish.
  await writeAudit({
    action: input.scheduledFor ? 'article.schedule' : 'article.publish',
    entityType: 'article',
    entityId: input.articleId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    before: null,
    after: { status: result.status, selfApproved: result.selfApproved },
    ip: input.ip,
  });

  return result;
}

/**
 * Retraction.  Spec Ch. 3.3.3.
 *
 * A published article is NEVER hard-deleted — users may have it cached, shared,
 * or bookmarked, and deletion produces broken deep links and empty bookmark
 * cards. Retraction is the correction mechanism and the client understands it.
 */
export async function retractArticle(input: {
  articleId: string;
  reason: string;
  actorId: string;
  actorEmail: string;
  ip: string | null;
}): Promise<void> {
  const c = collections(getDb());

  if (!input.reason || input.reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'A retraction reason of at least 10 characters is required.');
  }

  const article = await c.articles.findOne({ _id: new ObjectId(input.articleId) });
  if (!article) throw new AppError('NOT_FOUND');

  if (!canTransition(article.status, 'retracted')) {
    throw new AppError('INVALID_TRANSITION', `Cannot retract an article that is ${article.status}.`, {
      from: article.status,
      to: 'retracted',
    });
  }

  await c.articles.updateOne(
    { _id: article._id },
    {
      $set: {
        status: 'retracted',
        retractedAt: new Date(),
        retractionReason: input.reason.trim(),
        updatedAt: new Date(),
      },
    },
  );

  await writeAudit({
    action: 'article.retract',
    entityType: 'article',
    entityId: input.articleId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    before: { status: article.status },
    after: { status: 'retracted', retractionReason: input.reason.trim() },
    ip: input.ip,
  });
}
