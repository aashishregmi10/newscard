import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDb, interactionCollections, interactionPhase, type InteractionDoc } from '@saar/db';
import { AppError } from '@saar/shared';
import { Stars, type InteractionStateDto } from '@saar/schemas';
import { asyncRoute } from '../middleware/index.js';
import { loadEnv } from '../config/index.js';
import { interactionAnswerLimit, readerSessionLimit } from '../middleware/rateLimit.js';
import { forgetInteractionCaches, resultsOf, toResultsDto } from '../services/interactions.service.js';
import { requireReader, signInWithGoogle, signOut } from '../services/readers.service.js';

/**
 * Reader sign-in, and answering Interactions.
 *
 *   GET    /v1/readers/config             the Google client ID the app signs in with
 *   POST   /v1/readers/session            Google ID token in, our session out
 *   DELETE /v1/readers/session            sign out
 *   GET    /v1/interactions/:id/me        this reader's answers, and the results they may see
 *   GET    /v1/interactions/:id/results   what anyone may see
 *   POST   /v1/interactions/:id/vote      one vote, final
 *   POST   /v1/interactions/:id/rating    one rating per business, final
 *
 * "One" is the database's rule — unique indexes on (interaction, reader) and
 * (interaction, business, reader) — so two taps arriving together cannot both
 * count. The second is told it was already recorded, not that it failed.
 */

export const interactionRoutes = Router();

const SessionBody = z.object({ idToken: z.string().min(20).max(4096) });
const VoteBody = z.object({ optionId: z.string().min(1).max(40) });
const RatingBody = z.object({ optionId: z.string().min(1).max(40), stars: Stars });

async function interactionOr404(idParam: unknown): Promise<InteractionDoc> {
  const id = String(idParam ?? '');
  if (!ObjectId.isValid(id)) throw new AppError('NOT_FOUND', 'No such vote or rating.');
  const doc = await interactionCollections(getDb()).interactions.findOne({ _id: new ObjectId(id) });
  /* A draft does not exist as far as a reader is concerned. */
  if (!doc || doc.status === 'draft') throw new AppError('NOT_FOUND', 'No such vote or rating.');
  return doc;
}

/** Where this reader stands, and the results they may see. */
async function stateFor(doc: InteractionDoc, readerId: ObjectId | null): Promise<InteractionStateDto> {
  const now = new Date();
  const closed = interactionPhase(doc, now) === 'closed';
  const c = interactionCollections(getDb());

  let myVote: string | null = null;
  let myRatings: Array<{ optionId: string; stars: number }> = [];
  if (readerId !== null) {
    if (doc.type === 'vote') {
      myVote = (await c.votes.findOne({ interactionId: doc._id, readerId }))?.optionId ?? null;
    } else {
      myRatings = (await c.ratings.find({ interactionId: doc._id, readerId }).toArray()).map((r) => ({
        optionId: r.optionId,
        stars: r.stars,
      }));
    }
  }

  const mayShow = doc.type === 'rating' || closed || myVote !== null;
  return {
    id: String(doc._id),
    closed,
    myVote,
    myRatings,
    results: mayShow ? toResultsDto(await resultsOf(getDb(), doc, now)) : null,
  };
}

/** Refuse an answer to something not open now, saying which. */
function assertOpen(doc: InteractionDoc): void {
  const phase = interactionPhase(doc, new Date());
  if (phase === 'scheduled') throw new AppError('GONE', 'This is not open yet.');
  if (phase === 'closed') {
    throw new AppError('GONE', doc.type === 'vote' ? 'Voting has closed.' : 'Rating has closed.');
  }
}

const isDuplicate = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

/**
 * The Google Web client ID the app asks Google for a token for. From the
 * server's settings, so it is changed in one place (.env), not in every build.
 * Not a secret: Google prints it in every sign-in page that uses it.
 */
interactionRoutes.get('/readers/config', (_req, res) => {
  const first = loadEnv()
    .GOOGLE_WEB_CLIENT_ID.split(',')
    .map((s) => s.trim())
    .find(Boolean);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ googleWebClientId: first ?? null });
});

interactionRoutes.post(
  '/readers/session',
  readerSessionLimit,
  asyncRoute(async (req, res) => {
    const parsed = SessionBody.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'A Google ID token is required.');
    const { token, expiresAt } = await signInWithGoogle(parsed.data.idToken);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
  }),
);

interactionRoutes.delete(
  '/readers/session',
  asyncRoute(async (req, res) => {
    await signOut(req);
    res.status(204).end();
  }),
);

interactionRoutes.get(
  '/interactions/:id/me',
  requireReader,
  asyncRoute(async (req, res) => {
    const doc = await interactionOr404(req.params.id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await stateFor(doc, req.readerId!));
  }),
);

interactionRoutes.get(
  '/interactions/:id/results',
  asyncRoute(async (req, res) => {
    const doc = await interactionOr404(req.params.id);
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(await stateFor(doc, null));
  }),
);

interactionRoutes.post(
  '/interactions/:id/vote',
  interactionAnswerLimit,
  requireReader,
  asyncRoute(async (req, res) => {
    const parsed = VoteBody.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Choose a candidate.');
    const doc = await interactionOr404(req.params.id);
    if (doc.type !== 'vote') throw new AppError('BAD_REQUEST', 'This is a rating, not a vote.');
    assertOpen(doc);
    if (!doc.options.some((o) => o.id === parsed.data.optionId)) {
      throw new AppError('BAD_REQUEST', 'No such candidate.');
    }

    try {
      await interactionCollections(getDb()).votes.insertOne({
        interactionId: doc._id,
        optionId: parsed.data.optionId,
        readerId: req.readerId!,
        createdAt: new Date(),
      } as never);
    } catch (e) {
      if (isDuplicate(e)) {
        throw new AppError('INVALID_TRANSITION', 'You have already voted. A vote cannot be changed.', {
          state: await stateFor(doc, req.readerId!),
        });
      }
      throw e;
    }
    forgetInteractionCaches(String(doc._id));
    res.status(201).json(await stateFor(doc, req.readerId!));
  }),
);

interactionRoutes.post(
  '/interactions/:id/rating',
  interactionAnswerLimit,
  requireReader,
  asyncRoute(async (req, res) => {
    const parsed = RatingBody.safeParse(req.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'Choose one to five stars.');
    const doc = await interactionOr404(req.params.id);
    if (doc.type !== 'rating') throw new AppError('BAD_REQUEST', 'This is a vote, not a rating.');
    assertOpen(doc);
    const option = doc.options.find((o) => o.id === parsed.data.optionId);
    if (!option) throw new AppError('BAD_REQUEST', 'No such business.');

    try {
      await interactionCollections(getDb()).ratings.insertOne({
        interactionId: doc._id,
        optionId: option.id,
        readerId: req.readerId!,
        stars: parsed.data.stars,
        createdAt: new Date(),
      } as never);
    } catch (e) {
      if (isDuplicate(e)) {
        throw new AppError('INVALID_TRANSITION', `You have already rated ${option.name}. A rating cannot be changed.`, {
          state: await stateFor(doc, req.readerId!),
        });
      }
      throw e;
    }
    forgetInteractionCaches(String(doc._id));
    res.status(201).json(await stateFor(doc, req.readerId!));
  }),
);
