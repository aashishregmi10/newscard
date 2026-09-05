import { contentTokens, properNounCandidates } from './devanagari.js';

/**
 * Cross-source story clustering.  Plan §2a.
 *
 * The problem this solves: Rastriya Samachar Samiti copy is republished close to
 * verbatim by many Nepali outlets, so one agency story legitimately arrives from
 * six sources within an hour.  The spec's D1–D3 dedupe rules only match within a
 * single source, so without this every one of those becomes a separate draft and
 * the editor summarises the same story six times.
 *
 * Deliberately lexical, not embedding-based.  At 3–8 sources covering identical
 * wire copy the texts ARE lexically near-identical — the easy case — and a
 * Jaccard score is a number you can read, explain, and tune.  An embedding gives
 * you 0.83 and no way to see why.  Revisit past ~15 sources, when paraphrased
 * coverage starts producing false negatives.
 */

export const CLUSTER_WINDOW_MS = 36 * 60 * 60 * 1000;

/** At or above this, the same story. */
export const CLUSTER_THRESHOLD = 0.72;
/** Between CANDIDATE and CLUSTER, an editor confirms. */
export const CANDIDATE_THRESHOLD = 0.55;

export interface ClusterInput {
  headline: string;
  /** Standfirst or first paragraph, when available. Improves the token signal. */
  excerpt?: string | undefined;
  publishedAt: Date;
}

export interface SimilarityBreakdown {
  score: number;
  tokenJaccard: number;
  properNounOverlap: number;
  timeProximity: number;
  verdict: 'same' | 'candidate' | 'distinct';
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Overlap coefficient rather than Jaccard: a longer piece naming more entities
 *  should not be penalised for also containing the shorter one's entities. */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) intersection++;
  return intersection / small.size;
}

/** Linear decay to zero across the window. Same minute → 1, edge of window → 0. */
function timeProximity(a: Date, b: Date): number {
  const gap = Math.abs(a.getTime() - b.getTime());
  if (gap >= CLUSTER_WINDOW_MS) return 0;
  return 1 - gap / CLUSTER_WINDOW_MS;
}

function textOf(input: ClusterInput): string {
  return input.excerpt ? `${input.headline} ${input.excerpt}` : input.headline;
}

/**
 * Score two candidate items. Weights are 0.5 / 0.3 / 0.2 per the plan; they are
 * exported so they can be tuned against real data rather than edited in place.
 */
export const WEIGHTS = { tokens: 0.5, properNouns: 0.3, time: 0.2 } as const;

export function similarity(a: ClusterInput, b: ClusterInput): SimilarityBreakdown {
  const tokensA = new Set(contentTokens(textOf(a)));
  const tokensB = new Set(contentTokens(textOf(b)));
  const nounsA = new Set(properNounCandidates(textOf(a)));
  const nounsB = new Set(properNounCandidates(textOf(b)));

  const tokenJaccard = jaccard(tokensA, tokensB);
  const properNounOverlap = overlapCoefficient(nounsA, nounsB);
  const proximity = timeProximity(a.publishedAt, b.publishedAt);

  const score =
    WEIGHTS.tokens * tokenJaccard +
    WEIGHTS.properNouns * properNounOverlap +
    WEIGHTS.time * proximity;

  const verdict: SimilarityBreakdown['verdict'] =
    score >= CLUSTER_THRESHOLD ? 'same' : score >= CANDIDATE_THRESHOLD ? 'candidate' : 'distinct';

  return { score, tokenJaccard, properNounOverlap, timeProximity: proximity, verdict };
}
