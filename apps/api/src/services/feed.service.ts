import { ObjectId, type Filter } from 'mongodb';
import { collections, getDb, type ArticleDoc } from '@newscard/db';
import { decodeCursor, encodeCursor, CursorError, AppError } from '@newscard/shared';
import { isVirtualCategory, type ArticleCardDto, type Language } from '@newscard/schemas';
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

  return {
    items: display.map((d) => toArticleCard(d.doc)),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export async function getArticleBySlug(slug: string): Promise<ArticleDoc | null> {
  return collections(getDb()).articles.findOne({ slug });
}
