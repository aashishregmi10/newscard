import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import sharp from 'sharp';
import { connect, close, getDb, applyValidators, syncIndexes, interactionCollections } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

/**
 * Interactions in the editorial site, over HTTP, against a real database.
 *
 * Every name is synthetic — "नमुना", "Sample" — and every photo is generated,
 * as the project's rules require of demo data.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createCmsApp();
let cookie: string;

const send = (method: 'post' | 'patch' | 'get' | 'delete', path: string) =>
  request(app)[method](path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');

const photo = (credit = 'नमुना फोटो') => ({
  credit,
  blurHash: null,
  width: 640,
  height: 640,
  urls: { sm: '/media/images/x/160.jpg', md: '/media/images/x/320.jpg', lg: '/media/images/x/640.jpg' },
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function vote(over: Record<string, unknown> = {}) {
  return {
    type: 'vote',
    language: 'ne',
    categorySlug: null,
    title: 'नमुना: सबैभन्दा मीठो मम कहाँ पाइन्छ?',
    options: [
      { name: 'नमुना मम घर', detail: 'ठमेल', image: photo() },
      { name: 'Sample Momo House', detail: 'Patan', image: photo() },
      { name: 'नमुना भान्सा', detail: null, image: photo() },
      { name: 'Sample Kitchen', detail: null, image: photo() },
    ],
    opensAt: null,
    closesAt: inDays(7),
    ...over,
  };
}

function rating(over: Record<string, unknown> = {}) {
  return {
    type: 'rating',
    language: 'en',
    categorySlug: null,
    title: 'Sample: best coffee in town',
    options: [
      { name: 'नमुना क्याफे', detail: 'Baneshwor', image: null },
      { name: 'Sample Cafe', detail: null, image: photo('Sample Cafe') },
    ],
    opensAt: null,
    closesAt: null,
    ...over,
  };
}

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
  cookie = `${SESSION_COOKIE}=${await createSession({ _id: new ObjectId(), email: 'admin@example.invalid' })}`;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  const c = interactionCollections(getDb());
  await Promise.all([c.interactions.deleteMany({}), c.votes.deleteMany({}), c.ratings.deleteMany({})]);
});

describe('making an Interaction', () => {
  it('saves a four-candidate vote as a draft and lists it under Drafts', async () => {
    const r = await send('post', '/api/cms/interactions').send(vote());
    expect(r.status).toBe(201);
    expect(r.body.interaction).toMatchObject({ type: 'vote', status: 'draft', phase: 'draft' });
    const ids = r.body.interaction.options.map((o: { id: string }) => o.id);
    expect(new Set(ids).size).toBe(4);

    const list = await send('get', '/api/cms/interactions?tab=drafts');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.counts).toEqual({ live: 0, drafts: 1, closed: 0 });
  });

  it('saves a rating whose businesses need no photo', async () => {
    const r = await send('post', '/api/cms/interactions').send(rating());
    expect(r.status).toBe(201);
    expect(r.body.interaction.options[0].detail).toBe('Baneshwor');
  });

  it('refuses a fifth candidate, a repeated name and a candidate without a photo', async () => {
    const five = vote({
      options: [...vote().options, { name: 'नमुना पाँचौं', detail: null, image: photo() }],
    });
    const r1 = await send('post', '/api/cms/interactions').send(five);
    expect(r1.status).toBe(422);
    expect(r1.body.error.details.problems[0].field).toBe('options');

    const twice = vote({
      options: [
        { name: 'Sample Cafe', detail: null, image: photo() },
        { name: '  sample   cafe ', detail: null, image: photo() },
      ],
    });
    const r2 = await send('post', '/api/cms/interactions').send(twice);
    expect(r2.status).toBe(422);
    expect(r2.body.error.details.problems).toContainEqual({ field: 'options.1.name', message: 'Same name as candidate 1.' });

    const noPhoto = vote({
      options: [
        { name: 'नमुना एक', detail: null, image: photo() },
        { name: 'नमुना दुई', detail: null, image: null },
      ],
    });
    const r3 = await send('post', '/api/cms/interactions').send(noPhoto);
    expect(r3.status).toBe(422);
    expect(r3.body.error.message).toBe('Every candidate needs a photo.');
  });

  it('refuses a vote without a closing date, and a closing date before the opening', async () => {
    expect((await send('post', '/api/cms/interactions').send(vote({ closesAt: null }))).status).toBe(422);
    const backwards = vote({ opensAt: inDays(3), closesAt: inDays(1) });
    const r = await send('post', '/api/cms/interactions').send(backwards);
    expect(r.status).toBe(422);
    expect(r.body.error.details.problems[0].field).toBe('closesAt');
  });

  it('refuses a section that does not exist', async () => {
    const r = await send('post', '/api/cms/interactions').send(rating({ categorySlug: 'no-such-section' }));
    expect(r.status).toBe(422);
  });
});

describe('a candidate photo', () => {
  it('is cropped square and carries its credit', async () => {
    const file = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3a6ea5' } })
      .jpeg()
      .toBuffer();
    const r = await send('post', '/api/cms/media/option-image')
      .field('credit', 'नमुना फोटो')
      .attach('file', file, { filename: 'candidate.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(201);
    expect(r.body.image).toMatchObject({ credit: 'नमुना फोटो', width: 640, height: 640 });
  });

  it('is refused when too small to crop square, or without a credit', async () => {
    const small = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#888' } })
      .png()
      .toBuffer();
    const r1 = await send('post', '/api/cms/media/option-image')
      .field('credit', 'नमुना फोटो')
      .attach('file', small, { filename: 'small.png', contentType: 'image/png' });
    expect(r1.status).toBe(422);
    expect(r1.body.error.message).toMatch(/320px/);

    const big = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    const r2 = await send('post', '/api/cms/media/option-image').attach('file', big, {
      filename: 'big.jpg',
      contentType: 'image/jpeg',
    });
    expect(r2.status).toBe(422);
  });
});

describe('publishing, and what is locked after', () => {
  async function published() {
    const made = await send('post', '/api/cms/interactions').send(vote());
    const id = made.body.interaction.id as string;
    const r = await send('post', `/api/cms/interactions/${id}/publish`);
    expect(r.status).toBe(200);
    return { id, interaction: r.body.interaction };
  }

  it('goes live, opening now, and appears under Live', async () => {
    const { interaction } = await published();
    expect(interaction).toMatchObject({ status: 'live', phase: 'open' });
    expect(interaction.opensAt).not.toBeNull();
    const list = await send('get', '/api/cms/interactions?tab=live');
    expect(list.body.items).toHaveLength(1);
  });

  it('locks the candidates once live, but lets the closing date move', async () => {
    const { id } = await published();
    const edit = await send('patch', `/api/cms/interactions/${id}`).send(vote({ title: 'Changed after publishing' }));
    expect(edit.status).toBe(409);

    const later = inDays(14);
    const move = await send('patch', `/api/cms/interactions/${id}`).send({ closesAt: later });
    expect(move.status).toBe(200);
    expect(move.body.interaction.closesAt).toBe(new Date(later).toISOString());
  });

  it('closes, moves to Closed, and cannot be deleted', async () => {
    const { id } = await published();
    const closed = await send('post', `/api/cms/interactions/${id}/close`);
    expect(closed.body.interaction).toMatchObject({ status: 'closed', phase: 'closed' });
    expect((await send('get', '/api/cms/interactions?tab=closed')).body.items).toHaveLength(1);
    expect((await send('delete', `/api/cms/interactions/${id}`)).status).toBe(409);
  });

  it('deletes a draft', async () => {
    const made = await send('post', '/api/cms/interactions').send(rating());
    const id = made.body.interaction.id as string;
    expect((await send('delete', `/api/cms/interactions/${id}`)).status).toBe(204);
    expect((await send('get', `/api/cms/interactions/${id}`)).status).toBe(404);
  });

  it('counts the votes into percentages that add up to 100', async () => {
    const { id, interaction } = await published();
    const [a, b, c] = interaction.options.map((o: { id: string }) => o.id);
    const votes = interactionCollections(getDb()).votes;
    const at = new Date();
    await votes.insertMany(
      [a, a, b].concat([c]).map((optionId) => ({
        _id: new ObjectId(),
        interactionId: new ObjectId(id),
        optionId,
        readerId: new ObjectId(),
        createdAt: at,
      })),
    );
    const r = await send('get', `/api/cms/interactions/${id}`);
    expect(r.body.interaction.results.total).toBe(4);
    const percents = r.body.interaction.results.options.map((o: { percent: number }) => o.percent);
    expect(percents).toEqual([50, 25, 25, 0]);
  });
});
