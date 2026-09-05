import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { connect, close, getDb } from '@newscard/db';
import { rateLimit, ensureRateLimitIndexes } from '../rateLimit.js';
import { requestId, errorHandler } from '../index.js';

/**
 * Rate limiting, against a real MongoDB.
 *
 * A wall-clock test that fires N requests at the production limit is unreliable:
 * sequential requests straddle the fixed-window boundary and the counter resets
 * mid-run. So these use a tiny limit and a long window, which makes the
 * behaviour deterministic.
 */

/**
 * Never falls back to MONGO_URI. These suites DELETE collections, and a chain
 * that reaches the development database turns `npm test` into "why is my feed
 * empty" — a data loss that presents as a code bug.
 */
const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

function appWithLimit(limit: number, windowMs = 60_000) {
  const app = express();
  app.use(requestId);
  app.use(
    rateLimit({ name: `t${Math.random().toString(36).slice(2)}`, limit, windowMs, key: () => 'fixed-key' }),
  );
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  await connect({ uri: URI });
  await ensureRateLimitIndexes();
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await getDb().collection('rateCounters').deleteMany({});
});

describe('rate limiting', () => {
  it('allows requests up to the limit and refuses the next one', async () => {
    const app = appWithLimit(3);

    for (let i = 1; i <= 3; i++) {
      const res = await request(app).get('/ping');
      expect(res.status, `request ${i} should pass`).toBe(200);
    }

    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('sets Retry-After so the client knows how long to back off', async () => {
    const app = appWithLimit(1);
    await request(app).get('/ping');
    const res = await request(app).get('/ping');

    expect(res.status).toBe(429);
    const retry = Number(res.headers['retry-after']);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it('advertises the limit on successful responses too', async () => {
    const res = await request(appWithLimit(5)).get('/ping');
    expect(res.headers['x-ratelimit-limit']).toBe('5');
  });

  it('counts in the database, not in process memory', async () => {
    // The reason this matters: an in-memory counter silently multiplies every
    // limit by the number of running instances, and nothing surfaces the fault.
    // Two independent app instances must share one budget.
    const a = express();
    const b = express();
    const rule = { name: 'shared-rule', limit: 2, windowMs: 60_000, key: () => 'same-client' };
    for (const app of [a, b]) {
      app.use(requestId);
      app.use(rateLimit(rule));
      app.get('/ping', (_req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    }

    expect((await request(a).get('/ping')).status).toBe(200);
    expect((await request(b).get('/ping')).status).toBe(200);
    // Third request across BOTH instances must be refused.
    expect((await request(a).get('/ping')).status).toBe(429);
  });

  it('keys separately, so one caller cannot exhaust another caller budget', async () => {
    const app = express();
    app.use(requestId);
    app.use(
      rateLimit({
        name: 'per-caller',
        limit: 1,
        windowMs: 60_000,
        key: (req) => String(req.get('x-caller') ?? 'anon'),
      }),
    );
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    expect((await request(app).get('/ping').set('x-caller', 'alice')).status).toBe(200);
    expect((await request(app).get('/ping').set('x-caller', 'alice')).status).toBe(429);
    // Bob is unaffected — this is what protects users behind carrier-grade NAT
    // from each other when the key is a device rather than an IP.
    expect((await request(app).get('/ping').set('x-caller', 'bob')).status).toBe(200);
  });

  it('skips the check entirely when the key resolves to null', async () => {
    const app = express();
    app.use(requestId);
    app.use(rateLimit({ name: 'skip', limit: 1, windowMs: 60_000, key: () => null }));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/ping')).status).toBe(200);
    }
  });
});
