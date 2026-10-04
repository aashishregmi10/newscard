import { ObjectId } from 'mongodb';
import { collections, getDb } from '@saar/db';
import { DEFAULT_CONFIG } from '@saar/schemas';
import { createLogger } from '@saar/shared';
import { summarise, type SummaryResult } from '@saar/summarise';

/**
 * Drafting a summary for a story promoted from a lead, in the background.
 *
 * ── Why in the background ───────────────────────────────────────────────────
 *
 * The AI takes a few seconds, and promoting should not. Promote records the
 * request (`summaryDraft.status: 'pending'`) and returns; the composer opens at
 * once with the photo, shows "Writing a summary…", and checks back until the
 * draft is ready.
 *
 * ── Why the draft never goes into `summary` from here ───────────────────────
 *
 * The composer autosaves what is in its summary box. If this wrote `summary`
 * while the box was open and empty, the next keystroke in the headline would
 * save the empty box over it. So the draft lives in `summaryDraft`, and the
 * composer — which knows whether the editor has typed — decides whether to
 * fill the box or only offer it.
 *
 * ── What is sent, and when nothing is ───────────────────────────────────────
 *
 * The publisher's full article, only when their licence says `fullText`.
 * Without it, nothing is sent anywhere and the draft records why, so the
 * editor writes from the original as before.
 *
 * ── Races ───────────────────────────────────────────────────────────────────
 *
 * Every write is conditional on the `requestedAt` it started with. A Regenerate
 * pressed while an earlier draft is still being written supersedes it, and the
 * earlier one, finishing late, finds nothing to update.
 */

const log = createLogger({ level: 'info', service: 'summary' });

/** A draft still pending after this was interrupted — the process restarted. */
const STALE_AFTER_MS = 2 * 60_000;

type Outcome =
  | { status: 'ready'; result: SummaryResult }
  | { status: 'failed'; error: string };

/** Record the request and start the work. Resolves once recorded, not when done. */
export async function requestSummaryDraft(articleId: ObjectId): Promise<Date> {
  const c = collections(getDb());
  const requestedAt = new Date();
  await c.articles.updateOne(
    { _id: articleId },
    {
      $set: {
        summaryDraft: {
          status: 'pending',
          text: null,
          source: null,
          model: null,
          error: null,
          requestedAt,
          finishedAt: null,
        },
      },
    },
  );
  void writeSummaryDraft(articleId, requestedAt).catch((e: unknown) => {
    log.error('summary draft crashed', {
      articleId: articleId.toString(),
      error: e instanceof Error ? e.message : String(e),
    });
  });
  return requestedAt;
}

/** Exported for tests, which await it rather than the fire-and-forget above. */
export async function writeSummaryDraft(articleId: ObjectId, requestedAt: Date): Promise<void> {
  const outcome = await draftFor(articleId);
  const c = collections(getDb());
  const finishedAt = new Date();

  const set: Record<string, unknown> =
    outcome.status === 'ready'
      ? {
          'summaryDraft.status': 'ready',
          'summaryDraft.text': outcome.result.text,
          'summaryDraft.source': outcome.result.source,
          'summaryDraft.model': outcome.result.model,
          'summaryDraft.error': outcome.result.note,
          'summaryDraft.finishedAt': finishedAt,
        }
      : {
          'summaryDraft.status': 'failed',
          'summaryDraft.error': outcome.error,
          'summaryDraft.finishedAt': finishedAt,
        };

  /* Recorded on the story itself: a summary the AI wrote is an assisted
     draft, whatever the editor goes on to do with it. Measuring how much they
     change is the reason the field was created. */
  if (outcome.status === 'ready' && outcome.result.source === 'gemini') {
    set.draftSource = 'llm_assisted';
  }

  await c.articles.updateOne(
    { _id: articleId, 'summaryDraft.requestedAt': requestedAt },
    { $set: set },
  );

  log.info('summary drafted', {
    articleId: articleId.toString(),
    status: outcome.status,
    source: outcome.status === 'ready' ? outcome.result.source : null,
    model: outcome.status === 'ready' ? outcome.result.model : null,
  });
}

async function draftFor(articleId: ObjectId): Promise<Outcome> {
  const c = collections(getDb());
  const article = await c.articles.findOne(
    { _id: articleId },
    { projection: { language: 1, headline: 1, sourceId: 1 } },
  );
  if (!article) return { status: 'failed', error: 'The story no longer exists.' };

  const lead = await c.leads.findOne(
    { promotedArticleId: articleId },
    { projection: { headline: 1, feedExtract: 1, feedContent: 1 } },
  );
  if (!lead) {
    return {
      status: 'failed',
      error: 'The original has expired (leads are kept for 30 days), so there is nothing to summarise.',
    };
  }

  const source = await c.sources.findOne(
    { _id: article.sourceId },
    { projection: { displayName: 1, 'licence.fullText': 1 } },
  );
  if (source?.licence?.fullText !== true) {
    return {
      status: 'failed',
      error: `${source?.displayName ?? 'This publisher'}'s licence does not cover using their full article, so nothing was sent to the AI. Write the summary from the original.`,
    };
  }

  const text = (lead as { feedContent?: string | null }).feedContent ?? lead.feedExtract ?? '';
  if (text.trim() === '') {
    return { status: 'failed', error: 'Their article text was not collected, so there is nothing to summarise.' };
  }

  const cfg = (await c.config.findOne({})) ?? DEFAULT_CONFIG;
  const limits = cfg.summaryLimits ?? DEFAULT_CONFIG.summaryLimits;
  const band = limits.limits[article.language as 'ne' | 'en'];

  const result = await summarise({
    text,
    title: lead.headline,
    language: article.language as 'ne' | 'en',
    band: { limitType: limits.limitType, min: band.min, max: band.max },
    kind: 'summary',
  });
  if (result.text.trim() === '') {
    return { status: 'failed', error: result.note ?? 'No summary could be drafted.' };
  }
  return { status: 'ready', result };
}

/**
 * Close out drafts a restart interrupted.
 *
 * The work runs inside this process, so a restart mid-draft leaves `pending`
 * behind forever and the composer waiting for it. Marked failed with a reason,
 * so the editor sees Regenerate rather than a spinner.
 */
export async function sweepInterruptedSummaryDrafts(now = new Date()): Promise<number> {
  const c = collections(getDb());
  const res = await c.articles.updateMany(
    {
      'summaryDraft.status': 'pending',
      'summaryDraft.requestedAt': { $lt: new Date(now.getTime() - STALE_AFTER_MS) },
    },
    {
      $set: {
        'summaryDraft.status': 'failed',
        'summaryDraft.error': 'Drafting was interrupted. Press Regenerate to try again.',
        'summaryDraft.finishedAt': now,
      },
    },
  );
  return res.modifiedCount;
}
