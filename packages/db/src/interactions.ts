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
  options: Array<{ id: string; votes: number; percent: number }>;
}

export interface RatingResults {
  type: 'rating';
  options: Array<{ id: string; ratings: number; average: number | null }>;
}

export type InteractionResults = VoteResults | RatingResults;

/** Count an Interaction's answers, in the order of its options. */
export async function countInteractionResults(
  db: Db,
  i: Pick<InteractionDoc, '_id' | 'type' | 'options'>,
): Promise<InteractionResults> {
  const c = interactionCollections(db);
  const ids = i.options.map((o: InteractionOption) => o.id);

  if (i.type === 'vote') {
    const rows = await c.votes
      .aggregate<{ _id: string; n: number }>([
        { $match: { interactionId: i._id } },
        { $group: { _id: '$optionId', n: { $sum: 1 } } },
      ])
      .toArray();
    const counts = ids.map((id) => rows.find((r) => r._id === id)?.n ?? 0);
    const percents = votePercentages(counts);
    return {
      type: 'vote',
      total: counts.reduce((a, b) => a + b, 0),
      options: ids.map((id, k) => ({ id, votes: counts[k]!, percent: percents[k]! })),
    };
  }

  const rows = await c.ratings
    .aggregate<{ _id: string; n: number; sum: number }>([
      { $match: { interactionId: i._id } },
      { $group: { _id: '$optionId', n: { $sum: 1 }, sum: { $sum: '$stars' } } },
    ])
    .toArray();
  return {
    type: 'rating',
    options: ids.map((id) => {
      const r = rows.find((x) => x._id === id);
      return { id, ratings: r?.n ?? 0, average: averageStars(r?.sum ?? 0, r?.n ?? 0) };
    }),
  };
}
