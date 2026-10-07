import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { applyValidators, close, collections, connect, getDb, syncIndexes } from '@saar/db';
import { createCmsApp } from '../../server.js';
import { hashPassword } from '../../auth/password.js';
import { ensureSessionIndexes, SESSION_COOKIE } from '../../auth/session.js';

/**
 * Signing in, changing one's password, and the lockout — over HTTP, against a
 * real database. The account and its passwords are synthetic.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';
const app = createCmsApp();
const EMAIL = 'sample.editor@example.invalid';
const FIRST = 'sample-first-password';

const call = (method: 'post' | 'get', path: string, cookie?: string) => {
  const r = request(app)[method](path).set('X-Requested-With', 'newscard-cms');
  return cookie ? r.set('Cookie', cookie) : r;
};

const cookieOf = (res: request.Response): string => {
  const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const c = set.find((x) => x.startsWith(`${SESSION_COOKIE}=`));
  if (!c) throw new Error('no session cookie');
  return c.split(';')[0]!;
};

const login = (password: string) => call('post', '/api/auth/login').send({ email: EMAIL, password });

beforeAll(async () => {
  await connect({ uri: URI });
  await applyValidators(getDb());
  await syncIndexes(getDb());
  await ensureSessionIndexes();
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await Promise.all([
    collections(getDb()).staff.deleteMany({}),
    getDb().collection('sessions').deleteMany({}),
    getDb().collection('rateCounters').deleteMany({}),
  ]);
  await collections(getDb()).staff.insertOne({
    email: EMAIL,
    name: 'Sample Editor',
    isActive: true,
    passwordHash: await hashPassword(FIRST),
    failedLoginCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
});

describe('changing a password', () => {
  it('needs the current password, and ends every other session', async () => {
    const here = cookieOf(await login(FIRST));
    const elsewhere = cookieOf(await login(FIRST));

    const wrong = await call('post', '/api/auth/password', here).send({
      currentPassword: 'not-the-password',
      newPassword: 'a-new-sample-password',
    });
    expect(wrong.status).toBe(401);

    const short = await call('post', '/api/auth/password', here).send({
      currentPassword: FIRST,
      newPassword: 'short',
    });
    expect(short.status).toBe(400);

    const ok = await call('post', '/api/auth/password', here).send({
      currentPassword: FIRST,
      newPassword: 'a-new-sample-password',
    });
    expect(ok.status).toBe(200);
    const renewed = cookieOf(ok);

    /* The other session has ended; this one carries on under a new cookie. */
    expect((await call('get', '/api/auth/me', elsewhere)).status).toBe(401);
    expect((await call('get', '/api/auth/me', renewed)).status).toBe(200);
    expect((await login(FIRST)).status).toBe(401);
    expect((await login('a-new-sample-password')).status).toBe(200);
  });

  it('refuses without a session', async () => {
    const r = await call('post', '/api/auth/password').send({ currentPassword: FIRST, newPassword: 'a-new-sample-password' });
    expect(r.status).toBe(401);
  });
});

describe('the lockout', () => {
  it('answers exactly as a wrong password does, so it does not reveal the account exists', async () => {
    await collections(getDb()).staff.updateOne(
      { email: EMAIL },
      { $set: { lockedUntil: new Date(Date.now() + 10 * 60_000) } },
    );
    const locked = await login(FIRST);
    const unknown = await call('post', '/api/auth/login').send({ email: 'nobody@example.invalid', password: FIRST });
    expect(locked.status).toBe(unknown.status);
    expect(locked.body.error.message).toBe(unknown.body.error.message);
  });
});
