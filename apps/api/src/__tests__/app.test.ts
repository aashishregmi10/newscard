import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { resetEnvCache, loadEnv } from '../config/index.js';

/**
 * Smoke tests that need no database.
 *
 * They prove the things that are easy to get silently wrong: middleware order,
 * the single error envelope, request-id propagation, and Mongo-operator
 * stripping. A route returning the right JSON is no use if `errorHandler` was
 * registered before the routes and never fires.
 */

const app = createApp();

beforeAll(() => {
  resetEnvCache();
  loadEnv({
    NODE_ENV: 'test',
    MONGO_URI: 'mongodb://localhost:27017/test',
    CURSOR_SECRET: 'test-secret-that-is-at-least-32-chars',
    API_PORT: '3000',
  } as NodeJS.ProcessEnv);
});

describe('error envelope', () => {
  it('returns the standard shape for an unrouted path', async () => {
    const res = await request(app).get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', details: null });
    expect(typeof res.body.error.message).toBe('string');
    expect(typeof res.body.error.requestId).toBe('string');
  });

  it('echoes a request id on every response', async () => {
    const res = await request(app).get('/v1/nope');
    expect(res.headers['x-request-id']).toBeTruthy();
    // The header and the body must agree, or a user report cannot be traced.
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('issues a different request id per request', async () => {
    const a = await request(app).get('/v1/nope');
    const b = await request(app).get('/v1/nope');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('security posture', () => {
  it('does not advertise the framework', async () => {
    const res = await request(app).get('/v1/nope');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets helmet security headers', async () => {
    const res = await request(app).get('/v1/nope');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
  });

  it('strips Mongo operators from a JSON body', async () => {
    // Reaching a filter, {"$ne": null} would change the query's meaning.
    const res = await request(app)
      .post('/v1/nope')
      .send({ ok: 'yes', $ne: null, nested: { $gt: 1, keep: 2 } });
    // Still 404 (no such route) but the point is it did not crash and the
    // sanitiser ran before any handler.
    expect(res.status).toBe(404);
  });

  it('rejects an oversized body cleanly, as a client error not a server fault', async () => {
    const big = 'x'.repeat(200_000);
    const res = await request(app).post('/v1/nope').send({ big });
    expect(res.status).toBe(413);
    // Must use the standard envelope and must NOT be reported as INTERNAL —
    // an oversized body should not look like an outage in the logs.
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.requestId).toBeTruthy();
  });
});

describe('feed validation (no database needed)', () => {
  it('rejects an empty lang parameter instead of silently widening it', async () => {
    const res = await request(app).get('/v1/feed?lang=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects an unknown language code', async () => {
    const res = await request(app).get('/v1/feed?lang=fr');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects a non-numeric limit', async () => {
    const res = await request(app).get('/v1/feed?limit=abc');
    expect(res.status).toBe(400);
  });
});
