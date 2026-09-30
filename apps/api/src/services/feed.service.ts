import { ObjectId, type Filter } from 'mongodb';
import { collections, getDb, type ArticleDoc } from '@saar/db';
import { decodeCursor, encodeCursor, CursorError, AppError } from '@saar/shared';
import { isVirtualCategory, type ArticleCardDto, type Language } from '@saar/schemas';
import { reorderForDiversity } from './diversity.js';
import { toArticleCard } from '../dto/articleCard.dto.js';

/**
 * The feed query.  Spec Ch. 6.5.
 *
 * The hottest path in the product and the one users judge us on. Deliberately
 * the simplest thing in the system: no personalisation, no join, no fan-out.
 */

export interface FeedParams {
  languages: Language[];
  categorySlug: string;
  cursor?: string | undefined;
  limit: number;
  cursorSecret: string;
}

export interface FeedResult {
  items: ArticleCardDto[];
  nextCursor: string | null;
  hasMore: boolean;
  /**
   * Stories on this page that must not carry a small ad: marked "no ads" by an
   * editor, or from a publisher whose agreement does not allow them.
   *
   * Returned beside the cards rather than on them. The card DTO is a public
   * whitelist, and whether an editor judged a story too grave for an ad is
   * not something to publish. The route strips this before responding.
   */
  inlineBlocked: Set<string>;
}

/**
 * Publishers whose stories take no small ads, cached for a minute.
 *
 * Read on every feed request that could carry one, and it changes when an
 * admin flips a switch on a publisher — rarely. A minute of staleness is the
 * price of not querying `sources` on the hottest path in the product.
 */
let noInlineSources: { at: number; ids: Set<string> } | null = null;
const NO_INLINE_TTL_MS = 60_000;

async function sourcesWithoutInlineAds(): Promise<Set<string>> {
  if (noInlineSources && Date.now() - noInlineSources.at < NO_INLINE_TTL_MS) {
    return noInlineSources.ids;
  }
  const rows = await collections(getDb())
    .sources.find({ inlineAds: false }, { projection: { _id: 1 } })
    .toArray();
  noInlineSources = { at: Date.now(), ids: new Set(rows.map((r) => r._id.toString())) };
  return noInlineSources.ids;
}

/** Test seam: the cache above is process-wide by design. */
export function __resetInlineSourceCache(): void {
  noInlineSources = null;
}

export async function getFeed(params: FeedParams): Promise<FeedResult> {
  const c = collections(getDb());

  const filter: Filter<ArticleDoc> = {
    status: 'published',
    language: { $in: params.languages },
  };

  if (!isVirtualCategory(params.categorySlug)) {
    filter.categorySlug = params.categorySlug;
  }

  // Resume from the cursor with a strict inequality on the COMPOUND key.
  // The $or is what makes same-millisecond publishes safe: without the _id
  // tiebreak one card is shown twice and another skipped at the boundary.
  if (params.cursor) {
    try {
      const { p, i } = decodeCursor(params.cursor, params.cursorSecret);
      filter.$or = [
        { publishedAt: { $lt: new Date(p) } },
        { publishedAt: new Date(p), _id: { $lt: new ObjectId(i) } },
      ];
    } catch (e) {
      if (e instanceof CursorError) {
        throw new AppError('INVALID_CURSOR', undefined, { reason: e.reason });
      }
      throw e;
    }
  }

  // Fetch limit + 1. The extra document tells us whether a next page exists
  // without a second count query, and is never returned to the client.
  const docs = await c.articles
    .find(filter)
    .sort({ publishedAt: -1, _id: -1 })
    .limit(params.limit + 1)
    .toArray();

  const hasMore = docs.length > params.limit;
  const window = hasMore ? docs.slice(0, params.limit) : docs;

  // The cursor is taken BEFORE reordering, from the last document in sort
  // order. Diversity only permutes this window, so the sort-order boundary is
  // unaffected and pagination cannot duplicate or skip.
  const lastInSortOrder = window[window.length - 1];

  const display = reorderForDiversity(
    window.map((d) => ({ doc: d, sourceId: d.sourceId.toString() })),
  );

  const nextCursor =
    hasMore && lastInSortOrder?.publishedAt
      ? encodeCursor(
          lastInSortOrder.publishedAt,
          lastInSortOrder._id.toString(),
          params.cursorSecret,
        )
      : null;

  const blockedSources = await sourcesWithoutInlineAds();
  const inlineBlocked = new Set(
    window
      .filter((d) => d.adsSuppressed === true || blockedSources.has(d.sourceId.toString()))
      .map((d) => d._id.toString()),
  );

  return {
    items: display.map((d) => toArticleCard(d.doc)),
    nextCursor,
    hasMore: nextCursor !== null,
    inlineBlocked,
  };
}

export async function getArticleBySlug(slug: string): Promise<ArticleDoc | null> {
  return collections(getDb()).articles.findOne({ slug });
}
