import type { Db } from 'mongodb';
import {
  countInteractionResults,
  interactionCollections,
  interactionPhase,
  type InteractionDoc,
  type InteractionResults,
} from '@saar/db';
import {
  DEFAULT_INTERACTION_SPACING,
  interactionForSlot,
  interactionSlotsForPage,
} from '@saar/shared';
import type { InteractionCardDto, InteractionResultsDto, Language } from '@saar/schemas';

/**
 * Interactions for readers: which are live, where they go in the feed, and
 * their results — cached briefly, because every reader of the feed asks.
 */

/** Long enough to spare the database a query per feed page; short enough that
 *  a newly published vote appears within seconds. */
const LIVE_CACHE_MS = 10_000;
/** Results are what readers watch move after voting; a few seconds stale is fine. */
const RESULTS_CACHE_MS = 5_000;

let liveCache: { at: number; docs: InteractionDoc[] } | null = null;
const resultsCache = new Map<string, { at: number; results: InteractionResults }>();

/** For tests, and for the moment an answer is recorded. */
export function forgetInteractionCaches(id?: string): void {
  if (id === undefined) {
    liveCache = null;
    resultsCache.clear();
  } else {
    resultsCache.delete(id);
  }
}

/** Live and open now, newest first. */
async function openInteractions(db: Db, now: Date): Promise<InteractionDoc[]> {
  if (liveCache === null || now.getTime() - liveCache.at > LIVE_CACHE_MS) {
    const docs = await interactionCollections(db)
      .interactions.find({ status: 'live' })
      .sort({ opensAt: -1, _id: -1 })
      .limit(50)
      .toArray();
    liveCache = { at: now.getTime(), docs };
  }
  return liveCache.docs.filter((d) => interactionPhase(d, now) === 'open');
}

/**
 * The ones a feed shows: in the reader's languages, and — in a section — the
 * ones tagged with it; in the top feed, all of them.
 */
export async function interactionsForFeed(
  db: Db,
  opts: { languages: Language[]; categorySlug: string; now?: Date },
): Promise<InteractionCardDto[]> {
  const now = opts.now ?? new Date();
  const top = opts.categorySlug === 'top' || opts.categorySlug === 'all';
  return (await openInteractions(db, now))
    .filter((d) => opts.languages.includes(d.language))
    .filter((d) => top || d.categorySlug === opts.categorySlug)
    .map(toInteractionCard);
}

export function toInteractionCard(d: InteractionDoc): InteractionCardDto {
  return {
    kind: 'interaction',
    id: String(d._id),
    type: d.type,
    language: d.language,
    title: d.title,
    options: d.options.map((o) => ({
      id: o.id,
      name: o.name,
      detail: o.detail,
      image:
        o.image === null
          ? null
          : { credit: o.image.credit, blurHash: o.image.blurHash, urls: o.image.urls },
    })),
    closesAt: d.closesAt === null ? null : d.closesAt.toISOString(),
  };
}

/**
 * Put Interaction cards into a page of feed entries.
 *
 * After the stories and ads are placed, by the absolute position of the
 * stories (`pageOffset`, as for ads). A full-card ad's place is read off the
 * entries themselves, so an Interaction is never put beside one.
 */
export function injectInteractions<E extends { kind?: string }>(
  entries: E[],
  pageOffset: number,
  cards: readonly InteractionCardDto[],
): Array<E | InteractionCardDto> {
  if (cards.length === 0) return entries;

  let content = 0;
  const adAfter: number[] = [];
  for (const e of entries) {
    if (e.kind === 'ad') adAfter.push(content - 1);
    else content += 1;
  }
  const slots = new Set(interactionSlotsForPage(content, pageOffset, adAfter));
  if (slots.size === 0) return entries;

  const out: Array<E | InteractionCardDto> = [];
  let i = -1;
  for (const e of entries) {
    out.push(e);
    if (e.kind === 'ad') continue;
    i += 1;
    if (!slots.has(i)) continue;
    const pick = interactionForSlot(pageOffset + i + 1, cards.length, DEFAULT_INTERACTION_SPACING);
    const card = cards[pick];
    if (card) out.push(card);
  }
  return out;
}

/** Counted from the answers, held for a few seconds. */
export async function resultsOf(db: Db, d: InteractionDoc, now = new Date()): Promise<InteractionResults> {
  const key = String(d._id);
  const hit = resultsCache.get(key);
  if (hit && now.getTime() - hit.at <= RESULTS_CACHE_MS) return hit.results;
  const results = await countInteractionResults(db, d);
  resultsCache.set(key, { at: now.getTime(), results });
  return results;
}

/** One shape for both kinds, as the app receives it. */
export function toResultsDto(r: InteractionResults): InteractionResultsDto {
  if (r.type === 'vote') {
    return {
      type: 'vote',
      total: r.total,
      options: r.options.map((o) => ({ id: o.id, votes: o.votes, percent: o.percent, ratings: 0, average: null })),
    };
  }
  return {
    type: 'rating',
    total: r.total,
    options: r.options.map((o) => ({ id: o.id, votes: 0, percent: 0, ratings: o.ratings, average: o.average })),
  };
}
