import type { Collection, Db, ObjectId } from 'mongodb';
import { averageStars, votePercentages } from '@saar/shared';
import type { Interaction, InteractionOption } from '@saar/schemas';

/**
 * Interactions, their answers, and the readers who give them — the collections
 * and the counting both applications need: the editorial site shows results on
 * every Interaction, and the reader API shows them on the card. One
 * implementation, so the newsroom and the reader see the same number.
 *
 * Results are counted from the answers each time (cached for a few seconds by
 * the caller), never kept as running totals: a total that drifted from the
 * votes it claims to summarise would be a wrong number nobody could explain.
 */

export type InteractionDoc = Interaction & { _id: ObjectId; createdAt: Date; updatedAt: Date };

export interface VoteDoc {
  _id: ObjectId;
  interactionId: ObjectId;
  optionId: string;
  readerId: ObjectId;
  createdAt: Date;
}

export interface RatingDoc {
  _id: ObjectId;
  interactionId: ObjectId;
  optionId: string;
  readerId: ObjectId;
  stars: number;
  createdAt: Date;
}

export interface ReaderDoc {
  _id: ObjectId;
  /** HMAC-SHA256 of Google's account number. Never the number itself. */
  subHash: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface ReaderSessionDoc {
  _id: ObjectId;
  /** SHA-256 of the token the app holds. */
  tokenHash: string;
  readerId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export interface InteractionCollections {
  interactions: Collection<InteractionDoc>;
  votes: Collection<VoteDoc>;
  ratings: Collection<RatingDoc>;
  readers: Collection<ReaderDoc>;
  readerSessions: Collection<ReaderSessionDoc>;
}

export function interactionCollections(db: Db): InteractionCollections {
  return {
    interactions: db.collection<InteractionDoc>('interactions'),
    votes: db.collection<VoteDoc>('votes'),
    ratings: db.collection<RatingDoc>('ratings'),
    readers: db.collection<ReaderDoc>('readers'),
    readerSessions: db.collection<ReaderSessionDoc>('readerSessions'),
  };
}

/**
 * Where an Interaction stands right now, from its status and its dates:
 * a live one whose closing date has passed is closed, without waiting for
 * anyone to press Close, and one whose opening date is ahead is scheduled.
 */
export type InteractionPhase = 'draft' | 'scheduled' | 'open' | 'closed';

export function interactionPhase(
  i: Pick<Interaction, 'status' | 'opensAt' | 'closesAt'>,
  now: Date,
): InteractionPhase {
  if (i.status === 'draft') return 'draft';
  if (i.status === 'closed') return 'closed';
  if (i.closesAt !== null && now.getTime() >= i.closesAt.getTime()) return 'closed';
  if (i.opensAt !== null && now.getTime() < i.opensAt.getTime()) return 'scheduled';
  return 'open';
}

export interface VoteResults {
  type: 'vote';
  total: number;
  /** Votes since midnight in Nepal. For the newsroom; readers are not shown it. */
  today: number;
  options: Array<{ id: string; votes: number; percent: number }>;
}

export interface RatingResults {
  type: 'rating';
  /** Star ratings in all: a reader who rated four options gave four. */
  total: number;
  /** Readers who rated. Each rates every option, once, in one go. */
  respondents: number;
  /** Readers who rated since midnight in Nepal. */
  today: number;
  /** Every star given, averaged: the question's overall score. Null before the first. */
  average: number | null;
  options: Array<{
    id: string;
    ratings: number;
    average: number | null;
    /** How many gave 1, 2, 3, 4 and 5 stars, in that order. */
    breakdown: number[];
  }>;
}

/** Nepal is UTC+5:45 all year (no daylight saving). */
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60_000;

/** The moment today began in Nepal, whatever the server's own time zone. */
export function startOfNepalDay(now: Date = new Date()): Date {
  const local = now.getTime() + NEPAL_OFFSET_MS;
  return new Date(local - (local % 86_400_000) - NEPAL_OFFSET_MS);
}

export type InteractionResults = VoteResults | RatingResults;

/** Count an Interaction's answers, in the order of its options. */
export async function countInteractionResults(
  db: Db,
  i: Pick<InteractionDoc, '_id' | 'type' | 'options'>,
  now: Date = new Date(),
): Promise<InteractionResults> {
  const c = interactionCollections(db);
  const ids = i.options.map((o: InteractionOption) => o.id);
  const sinceToday = { interactionId: i._id, createdAt: { $gte: startOfNepalDay(now) } };

  if (i.type === 'vote') {
    const [rows, today] = await Promise.all([
      c.votes
        .aggregate<{ _id: string; n: number }>([
          { $match: { interactionId: i._id } },
          { $group: { _id: '$optionId', n: { $sum: 1 } } },
        ])
        .toArray(),
      c.votes.countDocuments(sinceToday),
    ]);
    const counts = ids.map((id) => rows.find((r) => r._id === id)?.n ?? 0);
    const percents = votePercentages(counts);
    return {
      type: 'vote',
      total: counts.reduce((a, b) => a + b, 0),
      today,
      options: ids.map((id, k) => ({ id, votes: counts[k]!, percent: percents[k]! })),
    };
  }

  const [rows, respondents, today] = await Promise.all([
    c.ratings
      .aggregate<{ _id: { o: string; s: number }; n: number }>([
        { $match: { interactionId: i._id } },
        { $group: { _id: { o: '$optionId', s: '$stars' }, n: { $sum: 1 } } },
      ])
      .toArray(),
    readersWho(c.ratings, { interactionId: i._id }),
    readersWho(c.ratings, sinceToday),
  ]);
  let allSum = 0;
  let allN = 0;
  const options = ids.map((id) => {
    const breakdown = [1, 2, 3, 4, 5].map((stars) => rows.find((x) => x._id.o === id && x._id.s === stars)?.n ?? 0);
    const n = breakdown.reduce((a, b) => a + b, 0);
    const sum = breakdown.reduce((a, b, k) => a + b * (k + 1), 0);
    allSum += sum;
    allN += n;
    return { id, ratings: n, average: averageStars(sum, n), breakdown };
  });
  return { type: 'rating', total: allN, respondents, today, average: averageStars(allSum, allN), options };
}

/** How many different readers gave the answers that match. */
async function readersWho(answers: Collection<RatingDoc>, match: Record<string, unknown>): Promise<number> {
  const [row] = await answers
    .aggregate<{ n: number }>([{ $match: match }, { $group: { _id: '$readerId' } }, { $count: 'n' }])
    .toArray();
  return row?.n ?? 0;
}
