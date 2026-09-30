import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { connect, close, collections, getDb, applyValidators, syncIndexes } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { createSession, SESSION_COOKIE } from '../../auth/session.js';

/**
 * The Advertising section's API, over HTTP.
 *
 * What matters most here is that the numbers the site shows are the numbers
 * serving uses: the share of voice a price buys, and a report link that works
 * exactly once and is never stored in a readable form.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createCmsApp();
const DAY = 86_400_000;

let cookie: string;

function post(path: string) {
  return request(app).post(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}
function get(path: string) {
  return request(app).get(path).set('Cookie', cookie).set('X-Requested-With', 'newscard-cms');
}

const POSTER = {
  blurHash: 'LKO2?U%2Tw=w',
  width: 1080,
  height: 1350,
  urls: { sm: '/media/i/p/360.jpg', md: '/media/i/p/720.jpg', lg: '/media/i/p/1080.jpg' },
};

let advertiserId: string;

async function addAdvertiser(name = 'hotel-x', displayName = 'Hotel X'): Promise<string> {
  const res = await post('/api/cms/ads/advertisers').send({
    name,
    displayName,
    contactEmail: `${name}@example.invalid`,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function campaignBody(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    advertiserId,
    name: 'Dashain offer',
    placement: 'card',
    language: 'en',
    categories: [],
    startsAt: new Date(now - DAY).toISOString(),
    endsAt: new Date(now + 6 * DAY).toISOString(),
    pricePaisa: 7_000_00,
    status: 'live',
    creative: {
      headline: 'Rooms from Rs 2,500 this Dashain',
      body: null,
      callToAction: { ne: 'बुक गर्नुहोस्', en: 'Book now' },
      landingUrl: 'https://hotelx.example.invalid/dashain',
      image: POSTER,
    },
    ...over,
  };
}

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
  const token = await createSession({ _id: new ObjectId(), email: 'admin@example.invalid' });
  cookie = `${SESSION_COOKIE}=${token}`;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  const db = getDb();
  await Promise.all([
    db.collection('campaigns').deleteMany({}),
    db.collection('advertisers').deleteMany({}),
    db.collection('adEvents').deleteMany({}),
    collections(db).categories.deleteMany({}),
    collections(db).audit.deleteMany({}),
  ]);
  await collections(db).categories.insertOne({
    _id: new ObjectId(),
    slug: 'business',
    label: { ne: 'अर्थ', en: 'Business' },
    order: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  advertiserId = await addAdvertiser();
});

describe('advertisers', () => {
  it('refuses a second advertiser with the same name, by name and not with a 500', async () => {
    const res = await post('/api/cms/ads/advertisers').send({
      name: 'hotel-x',
      displayName: 'Another',
      contactEmail: 'x@example.invalid',
    });
    expect(res.status).toBe(422);
    expect(String(res.body.error?.message)).toMatch(/already exists/);
  });

  it('carries a rename onto every campaign, so live ads print the new name', async () => {
    const created = await post('/api/cms/ads/campaigns').send(campaignBody());
    await post(`/api/cms/ads/advertisers/${advertiserId}/edit`).send({
      name: 'hotel-x',
      displayName: 'Hotel X & Spa',
      contactEmail: 'hotel-x@example.invalid',
      isActive: true,
    });
    const c = await getDb().collection('campaigns').findOne({ _id: new ObjectId(created.body.id) });
    expect(c?.advertiserName).toBe('Hotel X & Spa');
  });
});

describe('creating a campaign', () => {
  it('saves a full-card campaign and denormalises the advertiser name', async () => {
    const res = await post('/api/cms/ads/campaigns').send(campaignBody());
    expect(res.status).toBe(201);
    const c = await getDb().collection('campaigns').findOne({ _id: new ObjectId(res.body.id) });
    expect(c?.placement).toBe('card');
    expect(c?.advertiserName).toBe('Hotel X');
    expect(c?.pricePaisa).toBe(7_000_00);
    expect(c?.stats).toEqual({ impressions: 0, viewableImpressions: 0, clicks: 0 });
    expect(c?.reportTokenHash).toBeNull();
    expect(c).not.toHaveProperty('weight');
  });

  it('refuses a full-card campaign with no poster', async () => {
    const body = campaignBody();
    const res = await post('/api/cms/ads/campaigns').send({
      ...body,
      creative: { ...body.creative, image: null },
    });
    expect(res.status).toBe(422);
    expect(String(res.body.error?.message)).toMatch(/poster/);
  });

  it('refuses small-ad text that would not fit beside the icons', async () => {
    const body = campaignBody({ placement: 'inline' });
    const res = await post('/api/cms/ads/campaigns').send({
      ...body,
      creative: { ...body.creative, headline: 'Rooms from Rs 2,500 all through Dashain', image: null },
    });
    expect(res.status).toBe(422);
    expect(String(res.body.error?.message)).toMatch(/24/);
  });

  it('accepts a small ad with no logo', async () => {
    const body = campaignBody({ placement: 'inline' });
    const res = await post('/api/cms/ads/campaigns').send({
      ...body,
      creative: { ...body.creative, headline: 'Hotel X · Dashain', image: null },
    });
    expect(res.status).toBe(201);
  });

  it('refuses an end before the start, and an unknown section', async () => {
    const now = Date.now();
    expect(
      (
        await post('/api/cms/ads/campaigns').send(
          campaignBody({ startsAt: new Date(now).toISOString(), endsAt: new Date(now - DAY).toISOString() }),
        )
      ).status,
    ).toBe(422);
    expect((await post('/api/cms/ads/campaigns').send(campaignBody({ categories: ['nowhere'] }))).status).toBe(400);
    expect((await post('/api/cms/ads/campaigns').send(campaignBody({ categories: ['business'] }))).status).toBe(201);
  });

  it('writes an audit record', async () => {
    const res = await post('/api/cms/ads/campaigns').send(campaignBody());
    const row = await collections(getDb()).audit.findOne({ action: 'ad.campaign.create' });
    expect(row?.entityId).toBe(res.body.id);
  });
});

describe('the list and its tabs', () => {
  it('files a campaign by its dates and status, not by a stored label', async () => {
    const now = Date.now();
    await post('/api/cms/ads/campaigns').send(campaignBody({ name: 'running' }));
    await post('/api/cms/ads/campaigns').send(
      campaignBody({
        name: 'scheduled',
        startsAt: new Date(now + 2 * DAY).toISOString(),
        endsAt: new Date(now + 9 * DAY).toISOString(),
      }),
    );
    await post('/api/cms/ads/campaigns').send(
      campaignBody({
        name: 'finished',
        startsAt: new Date(now - 9 * DAY).toISOString(),
        endsAt: new Date(now - 2 * DAY).toISOString(),
      }),
    );
    await post('/api/cms/ads/campaigns').send(campaignBody({ name: 'paused', status: 'paused' }));
    await post('/api/cms/ads/campaigns').send(campaignBody({ name: 'draft', status: 'draft' }));

    const res = await get('/api/cms/ads/campaigns?tab=running');
    expect(res.body.counts).toEqual({ running: 1, scheduled: 1, paused: 1, finished: 1, draft: 1 });
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['running']);
    for (const tab of ['scheduled', 'paused', 'finished', 'draft']) {
      const r = await get(`/api/cms/ads/campaigns?tab=${tab}`);
      expect(r.body.items.map((i: { name: string }) => i.name)).toEqual([tab]);
      expect(r.body.items[0].state).toBe(tab);
    }
  });

  it('pages ten at a time', async () => {
    for (let i = 0; i < 12; i++) {
      await post('/api/cms/ads/campaigns').send(campaignBody({ name: `c${i}` }));
    }
    const first = await get('/api/cms/ads/campaigns?tab=running');
    expect(first.body.total).toBe(12);
    expect(first.body.items).toHaveLength(10);
    const second = await get('/api/cms/ads/campaigns?tab=running&page=2');
    expect(second.body.items).toHaveLength(2);
  });
});

describe('share of voice', () => {
  it('shows each running campaign its share by price per day, per placement', async () => {
    const now = Date.now();
    const week = { startsAt: new Date(now - DAY).toISOString(), endsAt: new Date(now + 6 * DAY).toISOString() };
    await post('/api/cms/ads/campaigns').send(campaignBody({ name: 'twice', pricePaisa: 14_000_00, ...week }));
    await post('/api/cms/ads/campaigns').send(campaignBody({ name: 'once', pricePaisa: 7_000_00, ...week }));
    const inlineBody = campaignBody({ placement: 'inline', name: 'small', ...week });
    await post('/api/cms/ads/campaigns').send({
      ...inlineBody,
      creative: { ...inlineBody.creative, headline: 'Hotel X', image: null },
    });

    const res = await get('/api/cms/ads/overview');
    const card = res.body.placements.find((p: { placement: string }) => p.placement === 'card');
    const inline = res.body.placements.find((p: { placement: string }) => p.placement === 'inline');
    const byName = Object.fromEntries(
      card.running.map((r: { name: string; shareOfVoice: number }) => [r.name, r.shareOfVoice]),
    );
    expect(byName.twice).toBeCloseTo(2 / 3, 5);
    expect(byName.once).toBeCloseTo(1 / 3, 5);
    // A different product: the small ad does not share the full-card slots.
    expect(inline.running).toHaveLength(1);
    expect(inline.running[0].shareOfVoice).toBeCloseTo(1, 5);
  });

  it('previews the share a price would buy, before saving', async () => {
    const now = Date.now();
    const week = { startsAt: new Date(now - DAY).toISOString(), endsAt: new Date(now + 6 * DAY).toISOString() };
    await post('/api/cms/ads/campaigns').send(campaignBody({ pricePaisa: 7_000_00, ...week }));

    const q = new URLSearchParams({
      placement: 'card',
      pricePaisa: String(21_000_00),
      startsAt: week.startsAt,
      endsAt: week.endsAt,
    });
    const res = await get(`/api/cms/ads/share-preview?${q.toString()}`);
    expect(res.status).toBe(200);
    // Rs 3,000 a day beside Rs 1,000 a day: three quarters.
    expect(res.body.shareOfVoice).toBeCloseTo(0.75, 5);
    expect(res.body.pricePerDayPaisa).toBe(3_000_00);
    expect(res.body.alongside).toBe(1);
  });

  it('gives a free campaign no share while anyone paying is running', async () => {
    await post('/api/cms/ads/campaigns').send(campaignBody());
    const now = Date.now();
    const q = new URLSearchParams({
      placement: 'card',
      pricePaisa: '0',
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 7 * DAY).toISOString(),
    });
    const res = await get(`/api/cms/ads/share-preview?${q.toString()}`);
    expect(res.body.shareOfVoice).toBe(0);
  });
});

describe('report links', () => {
  it('shows the token once and stores only its hash', async () => {
    const created = await post('/api/cms/ads/campaigns').send(campaignBody());
    const res = await post(`/api/cms/ads/campaigns/${created.body.id}/report-link`).send({});
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^rp_/);
    expect(res.body.replaced).toBe(false);

    const c = await getDb().collection('campaigns').findOne({ _id: new ObjectId(created.body.id) });
    expect(c?.reportTokenHash).toBe(createHash('sha256').update(res.body.token).digest('hex'));
    expect(JSON.stringify(c)).not.toContain(res.body.token);

    const audit = await collections(getDb()).audit.findOne({ action: 'ad.campaign.reportLink' });
    expect(JSON.stringify(audit)).not.toContain(res.body.token);
  });

  it('replacing a link revokes the old one', async () => {
    const created = await post('/api/cms/ads/campaigns').send(campaignBody());
    const first = await post(`/api/cms/ads/campaigns/${created.body.id}/report-link`).send({});
    const second = await post(`/api/cms/ads/campaigns/${created.body.id}/report-link`).send({});
    expect(second.body.replaced).toBe(true);
    const c = await getDb().collection('campaigns').findOne({ _id: new ObjectId(created.body.id) });
    expect(c?.reportTokenHash).not.toBe(createHash('sha256').update(first.body.token).digest('hex'));
  });
});

describe('one campaign', () => {
  it('returns the form fields and the report over its flight so far', async () => {
    const created = await post('/api/cms/ads/campaigns').send(campaignBody());
    const id = created.body.id as string;
    await getDb()
      .collection('adEvents')
      .insertMany([
        { campaignId: new ObjectId(id), placement: 'card', type: 'impression', dwellMs: 2000, deviceId: 'd1', categorySlug: 'top', occurredAt: new Date() },
        { campaignId: new ObjectId(id), placement: 'card', type: 'impression', dwellMs: 200, deviceId: 'd2', categorySlug: 'top', occurredAt: new Date() },
        { campaignId: new ObjectId(id), placement: 'card', type: 'click', dwellMs: 2000, deviceId: 'd1', categorySlug: 'top', occurredAt: new Date() },
      ]);

    const res = await get(`/api/cms/ads/campaigns/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.campaign.creative.image.urls.lg).toBe(POSTER.urls.lg);
    expect(res.body.report.delivery.impressions).toBe(2);
    expect(res.body.report.delivery.viewableImpressions).toBe(1);
    expect(res.body.report.engagement.clicks).toBe(1);
    expect(res.body.report.delivery.goal).toBeNull();
    expect(res.body.report.delivery.deliveredShare).toBe(1);
    expect(res.body.report.paid.shareOfVoiceNow).toBe(1);
    expect(res.body.report.value.costPerClickPaisa).toBeGreaterThan(0);
  });

  it('edits without touching what was delivered or the report key', async () => {
    const created = await post('/api/cms/ads/campaigns').send(campaignBody());
    const id = created.body.id as string;
    await getDb()
      .collection('campaigns')
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { stats: { impressions: 9, viewableImpressions: 5, clicks: 1 }, reportTokenHash: 'abc' } },
      );
    const res = await post(`/api/cms/ads/campaigns/${id}/edit`).send(campaignBody({ name: 'Renamed', status: 'paused' }));
    expect(res.status).toBe(200);
    const c = await getDb().collection('campaigns').findOne({ _id: new ObjectId(id) });
    expect(c?.name).toBe('Renamed');
    expect(c?.status).toBe('paused');
    expect(c?.stats).toEqual({ impressions: 9, viewableImpressions: 5, clicks: 1 });
    expect(c?.reportTokenHash).toBe('abc');
  });
});
