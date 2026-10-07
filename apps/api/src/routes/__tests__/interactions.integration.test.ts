import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { connect, close, getDb, syncIndexes, interactionCollections } from '@saar/db';
import { createApp } from '../../app.js';
import { resetEnvCache } from '../../config/index.js';
import { setGoogleVerifierForTests } from '../../services/readers.service.js';
import { forgetInteractionCaches, injectInteractions } from '../../services/interactions.service.js';

/**
 * Readers answering Interactions, over HTTP, against a real database.
 *
 * Google is never called: a stand-in plays its verifier, accepting tokens
 * named "good-token-<account>". Every name is synthetic.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createApp();

const OPTION = (id: string, name: string) => ({ id, name, detail: null, image: null });

async function interaction(over: Record<string, unknown> = {}): Promise<string> {
  const _id = new ObjectId();
  const now = new Date();
  await interactionCollections(getDb()).interactions.insertOne({
    _id,
    type: 'vote',
    status: 'live',
    language: 'en',
    categorySlug: null,
    title: 'Sample: which momo shop is best?',
    options: [OPTION('aaaaaa01', 'Sample Momo House'), OPTION('aaaaaa02', 'नमुना मम घर'), OPTION('aaaaaa03', 'Sample Kitchen')],
    opensAt: new Date(now.getTime() - 60_000),
    closesAt: new Date(now.getTime() + 86_400_000),
    publishedAt: now,
    closedAt: null,
    createdBy: 'test',
    createdAt: now,
    updatedAt: now,
    ...over,
  } as never);
  return _id.toString();
}

async function signIn(account: string): Promise<string> {
  const r = await request(app).post('/v1/readers/session').send({ idToken: `good-token-${account}-padding` });
  expect(r.status).toBe(201);
  return r.body.token as string;
}

const as = (token: string) => ({ Authorization: `Reader ${token}` });

beforeAll(async () => {
  process.env.GOOGLE_WEB_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  resetEnvCache();
  await connect({ uri: URI });
  await syncIndexes(getDb());
  setGoogleVerifierForTests(async (idToken, audiences) => {
    expect(audiences).toEqual(['test-client.apps.googleusercontent.com']);
    const m = /^good-token-(.+)-padding$/.exec(idToken);
    if (!m) throw new Error('bad signature');
    return { sub: m[1]! };
  });
});

afterAll(async () => {
  setGoogleVerifierForTests(null);
  await close();
});

beforeEach(async () => {
  forgetInteractionCaches();
  const c = interactionCollections(getDb());
  await Promise.all([
    c.interactions.deleteMany({}),
    c.votes.deleteMany({}),
    c.ratings.deleteMany({}),
    c.readers.deleteMany({}),
    c.readerSessions.deleteMany({}),
    getDb().collection('rateCounters').deleteMany({}),
  ]);
});

describe('signing in', () => {
  it('turns a Google token into a session, and keeps no account number', async () => {
    const token = await signIn('acct-1');
    expect(token.length).toBeGreaterThan(30);
    const reader = await interactionCollections(getDb()).readers.findOne({});
    expect(reader?.subHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(reader)).not.toContain('acct-1');
    const session = await interactionCollections(getDb()).readerSessions.findOne({});
    expect(session?.tokenHash).not.toBe(token);
  });

  it('refuses a token Google does not confirm', async () => {
    const r = await request(app).post('/v1/readers/session').send({ idToken: 'forged-token-0123456789' });
    expect(r.status).toBe(401);
  });

  it('gives the same account the same reader on a second sign-in', async () => {
    await signIn('acct-1');
    await signIn('acct-1');
    expect(await interactionCollections(getDb()).readers.countDocuments()).toBe(1);
  });

  it('ends a session on sign-out', async () => {
    const token = await signIn('acct-1');
    const id = await interaction();
    expect((await request(app).delete('/v1/readers/session').set(as(token))).status).toBe(204);
    expect((await request(app).get(`/v1/interactions/${id}/me`).set(as(token))).status).toBe(401);
  });
});

describe('voting', () => {
  it('needs a signed-in reader', async () => {
    const id = await interaction();
    const r = await request(app).post(`/v1/interactions/${id}/vote`).send({ optionId: 'aaaaaa01' });
    expect(r.status).toBe(401);
  });

  it('hides the totals until the reader has voted, then shows them', async () => {
    const id = await interaction();
    const first = await signIn('acct-1');
    const before = await request(app).get(`/v1/interactions/${id}/me`).set(as(first));
    expect(before.body).toMatchObject({ myVote: null, results: null, closed: false });

    const r = await request(app).post(`/v1/interactions/${id}/vote`).set(as(first)).send({ optionId: 'aaaaaa02' });
    expect(r.status).toBe(201);
    expect(r.body.myVote).toBe('aaaaaa02');
    expect(r.body.results.total).toBe(1);
    expect(r.body.results.options.map((o: { percent: number }) => o.percent)).toEqual([0, 100, 0]);

    /* The public view still says nothing while it is open. */
    expect((await request(app).get(`/v1/interactions/${id}/results`)).body.results).toBeNull();
  });

  it('counts one vote per account, and says so to a second try', async () => {
    const id = await interaction();
    const token = await signIn('acct-1');
    await request(app).post(`/v1/interactions/${id}/vote`).set(as(token)).send({ optionId: 'aaaaaa01' });
    const again = await request(app).post(`/v1/interactions/${id}/vote`).set(as(token)).send({ optionId: 'aaaaaa03' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already voted/);
    expect(await interactionCollections(getDb()).votes.countDocuments()).toBe(1);

    const other = await signIn('acct-2');
    const second = await request(app).post(`/v1/interactions/${id}/vote`).set(as(other)).send({ optionId: 'aaaaaa03' });
    expect(second.body.results.options.map((o: { percent: number }) => o.percent)).toEqual([50, 0, 50]);
  });

  it('refuses a vote once it has closed, and then shows everyone the result', async () => {
    const id = await interaction({ closesAt: new Date(Date.now() - 1000) });
    const token = await signIn('acct-1');
    const r = await request(app).post(`/v1/interactions/${id}/vote`).set(as(token)).send({ optionId: 'aaaaaa01' });
    expect(r.status).toBe(410);
    const pub = await request(app).get(`/v1/interactions/${id}/results`);
    expect(pub.body).toMatchObject({ closed: true, results: { total: 0 } });
  });

  it('refuses a candidate that is not on the card', async () => {
    const id = await interaction();
    const token = await signIn('acct-1');
    const r = await request(app).post(`/v1/interactions/${id}/vote`).set(as(token)).send({ optionId: 'zzzzzz99' });
    expect(r.status).toBe(400);
  });

  it('treats a draft as not there', async () => {
    const id = await interaction({ status: 'draft' });
    expect((await request(app).get(`/v1/interactions/${id}/results`)).status).toBe(404);
  });
});

describe('rating', () => {
  const rating = () =>
    interaction({
      type: 'rating',
      title: 'Sample: how was the service?',
      options: [OPTION('bbbbbb01', 'Sample Speed'), OPTION('bbbbbb02', 'नमुना व्यवहार')],
      closesAt: null,
    });
  const rate = (id: string, token: string, a: number, b: number) =>
    request(app)
      .post(`/v1/interactions/${id}/ratings`)
      .set(as(token))
      .send({ ratings: [{ optionId: 'bbbbbb01', stars: a }, { optionId: 'bbbbbb02', stars: b }] });

  it('takes the options in one Send, and moves the averages', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    const b = await signIn('acct-2');

    const r1 = await rate(id, a, 5, 3);
    expect(r1.status).toBe(201);
    expect(r1.body.myRatings).toEqual([
      { optionId: 'bbbbbb01', stars: 5 },
      { optionId: 'bbbbbb02', stars: 3 },
    ]);

    const r2 = await rate(id, b, 2, 4);
    expect(r2.body.results).toMatchObject({ total: 4, respondents: 2, average: 3.5 });
    expect(r2.body.results.options[0]).toMatchObject({ ratings: 2, average: 3.5 });
    expect(r2.body.results.options[1]).toMatchObject({ ratings: 2, average: 3.5 });
  });

  it('counts one rating per account, and says so to a second try', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    await rate(id, a, 5, 5);
    const again = await rate(id, a, 1, 1);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already rated/);
    expect(await interactionCollections(getDb()).ratings.countDocuments()).toBe(2);
  });

  it('lets a reader skip options, and counts each option over those who rated it', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    const b = await signIn('acct-2');
    const only = (token: string, optionId: string, stars: number) =>
      request(app).post(`/v1/interactions/${id}/ratings`).set(as(token)).send({ ratings: [{ optionId, stars }] });

    expect((await only(a, 'bbbbbb02', 4)).status).toBe(201);
    const r = await rate(id, b, 2, 2);
    expect(r.body.results).toMatchObject({ total: 3, respondents: 2 });
    expect(r.body.results.options[0]).toMatchObject({ ratings: 1, average: 2 });
    expect(r.body.results.options[1]).toMatchObject({ ratings: 2, average: 3 });
  });

  it('takes one Send per reader: the options skipped cannot be sent later', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    const send = (ratings: unknown) => request(app).post(`/v1/interactions/${id}/ratings`).set(as(a)).send({ ratings });
    expect((await send([{ optionId: 'bbbbbb01', stars: 4 }])).status).toBe(201);
    const later = await send([{ optionId: 'bbbbbb02', stars: 1 }]);
    expect(later.status).toBe(409);
    expect(later.body.error.details.state.myRatings).toEqual([{ optionId: 'bbbbbb01', stars: 4 }]);
    expect(await interactionCollections(getDb()).ratings.countDocuments()).toBe(1);
  });

  it('refuses an empty form, an option twice, or one not on the card', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    const send = (ratings: unknown) => request(app).post(`/v1/interactions/${id}/ratings`).set(as(a)).send({ ratings });
    expect((await send([])).status).toBe(400);
    expect(
      (await send([{ optionId: 'bbbbbb01', stars: 4 }, { optionId: 'bbbbbb01', stars: 2 }])).status,
    ).toBe(400);
    expect(
      (await send([{ optionId: 'bbbbbb01', stars: 4 }, { optionId: 'zzzzzz99', stars: 2 }])).status,
    ).toBe(400);
    expect(await interactionCollections(getDb()).ratings.countDocuments()).toBe(0);
  });

  it('shows the averages only to a reader who has rated, until it closes', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    const b = await signIn('acct-2');
    await rate(id, a, 4, 2);

    const other = await request(app).get(`/v1/interactions/${id}/me`).set(as(b));
    expect(other.body).toMatchObject({ myRatings: [], results: null });
    expect((await request(app).get(`/v1/interactions/${id}/results`)).body.results).toBeNull();

    await interactionCollections(getDb()).interactions.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'closed', closedAt: new Date() } },
    );
    forgetInteractionCaches();
    const pub = await request(app).get(`/v1/interactions/${id}/results`);
    expect(pub.body.results).toMatchObject({ respondents: 1, average: 3 });
  });

  it('refuses a sixth star', async () => {
    const id = await rating();
    const a = await signIn('acct-1');
    expect((await rate(id, a, 6, 1)).status).toBe(400);
  });
});

describe('Interaction cards in the feed', () => {
  const story = (i: number) => ({ id: `s${i}`, kind: 'article' as const });
  const card = (id: string) => ({
    kind: 'interaction' as const,
    id,
    type: 'vote' as const,
    language: 'en' as const,
    title: 'x',
    options: [],
    closesAt: null,
  });

  it('goes after the 6th story, and never beside a full-card ad', () => {
    const entries = Array.from({ length: 10 }, (_, i) => story(i));
    const out = injectInteractions(entries, 0, [card('one')]);
    expect(out.map((e) => e.id).slice(5, 7)).toEqual(['s5', 'one']);

    /* An ad after the 6th story: the Interaction waits one story. */
    const withAd = [...entries.slice(0, 6), { id: 'ad', kind: 'ad' as const }, ...entries.slice(6)];
    const out2 = injectInteractions(withAd, 0, [card('one')]);
    expect(out2.map((e) => e.id).slice(5, 9)).toEqual(['s5', 'ad', 's6', 'one']);
  });

  it('is sent only to an app that asks, in its language, after the 6th story', async () => {
    await getDb().collection('articles').deleteMany({});
    await getDb().collection('campaigns').deleteMany({});
    const sources = [new ObjectId(), new ObjectId()];
    const at = Date.now();
    await getDb()
      .collection('articles')
      .insertMany(
        Array.from({ length: 10 }, (_, i) => {
          const _id = new ObjectId();
          return {
            _id,
            slug: `story-${_id.toString()}`,
            status: 'published',
            language: 'en',
            categoryId: new ObjectId(),
            sourceId: sources[i % 2],
            publishedAt: new Date(at - i * 60_000),
            headline: `Sample story number ${i + 1}`,
            summary: 'Sample summary.',
            summaryWordCount: 2,
            summaryCharCount: 15,
            pullQuote: null,
            publisherUrl: `https://example.invalid/${_id.toString()}`,
            publisherAuthor: null,
            publisherPublishedAt: null,
            tags: [],
            clusterId: null,
            originatingAgency: null,
            image: null,
            sourceName: i % 2 ? 'Sample Post' : 'Sample Times',
            sourceLogoUrl: null,
            categorySlug: 'nepal',
            categoryLabel: { ne: 'नेपाल', en: 'Nepal' },
            authoredBy: new ObjectId(),
            reviewedBy: null,
            selfApproved: false,
            draftSource: 'human',
            revisionCount: 0,
            possibleDuplicate: false,
            possibleLanguageMismatch: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }),
      );
    const id = await interaction();
    await interaction({ language: 'ne', title: 'नमुना मतदान' });

    const old = await request(app).get('/v1/feed?lang=en');
    expect(old.status).toBe(200);
    expect(old.body.items.some((i: { kind?: string }) => i.kind === 'interaction')).toBe(false);

    const asked = await request(app).get('/v1/feed?lang=en&interactions=1');
    const kinds = asked.body.items.map((i: { kind?: string; id: string }) => (i.kind === 'interaction' ? i.id : i.kind));
    expect(kinds.filter((k: string) => k !== 'article')).toEqual([id]);
    expect(kinds.indexOf(id)).toBe(6);
  });
});
