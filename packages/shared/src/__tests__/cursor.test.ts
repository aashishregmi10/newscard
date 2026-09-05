import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  encodeCursor,
  decodeCursor,
  CursorError,
  CURSOR_MAX_AGE_MS,
} from '../cursor.js';

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Correctly sign an arbitrary body, so structural tests are not masked by a signature failure. */
const signBody = (body: string) => b64url(createHmac('sha256', SECRET).update(body).digest());

const SECRET = 'test-secret-at-least-32-bytes-long!!';
const ID_A = '66d7f1a2c3b4e5f6a7b8c9d0';
const ID_B = '66d7f1a2c3b4e5f6a7b8c9d1';
const NOW = new Date('2026-09-04T04:00:00.000Z');

describe('cursor round-trip', () => {
  it('encodes and decodes the compound sort key exactly', () => {
    const published = new Date('2026-09-04T03:52:11.123Z');
    const c = encodeCursor(published, ID_A, SECRET, NOW);
    const got = decodeCursor(c, SECRET, NOW);

    expect(got.p).toBe(published.getTime());
    expect(got.i).toBe(ID_A);
  });

  it('preserves millisecond precision', () => {
    // The whole point of the tiebreak is same-millisecond publishes. If the
    // encoder rounded to seconds, F-05 would pass by accident and fail in prod.
    const published = new Date(1757043131987);
    const got = decodeCursor(encodeCursor(published, ID_A, SECRET, NOW), SECRET, NOW);
    expect(got.p).toBe(1757043131987);
  });

  it('produces different cursors for the same instant with different ids', () => {
    const published = new Date(1757043131000);
    const a = encodeCursor(published, ID_A, SECRET, NOW);
    const b = encodeCursor(published, ID_B, SECRET, NOW);
    expect(a).not.toBe(b);
    expect(decodeCursor(a, SECRET, NOW).i).toBe(ID_A);
    expect(decodeCursor(b, SECRET, NOW).i).toBe(ID_B);
  });

  it('is url-safe: no +, / or = in the output', () => {
    // Cursors travel in a query string. Base64 padding and + would need escaping,
    // and a client that forgets to escape produces a signature failure that looks
    // like tampering.
    for (let n = 0; n < 200; n++) {
      const c = encodeCursor(new Date(1757043131000 + n), ID_A, SECRET, NOW);
      expect(c).not.toMatch(/[+/=]/);
    }
  });
});

describe('cursor rejection', () => {
  it('rejects a tampered signature', () => {
    const c = encodeCursor(new Date(), ID_A, SECRET, NOW);
    const tampered = c.slice(0, -1) + (c.at(-1) === 'A' ? 'B' : 'A');
    expect(() => decodeCursor(tampered, SECRET, NOW)).toThrow(CursorError);
    try {
      decodeCursor(tampered, SECRET, NOW);
    } catch (e) {
      expect((e as CursorError).reason).toBe('bad_signature');
    }
  });

  it('rejects a tampered body even when the signature is left intact', () => {
    const c = encodeCursor(new Date(), ID_A, SECRET, NOW);
    const [, sig] = c.split('.');
    const forgedBody = b64url(Buffer.from(JSON.stringify({ p: 0, i: ID_B, t: 0 }), 'utf8'));
    expect(() => decodeCursor(`${forgedBody}.${sig}`, SECRET, NOW)).toThrow(CursorError);
  });

  it('rejects a cursor signed with a different secret', () => {
    const c = encodeCursor(new Date(), ID_A, 'some-other-secret-value-here!!!!', NOW);
    expect(() => decodeCursor(c, SECRET, NOW)).toThrow(/signature/);
  });

  it.each([
    ['empty string', ''],
    ['no separator', 'abcdef'],
    ['leading separator', '.abcdef'],
    ['trailing separator', 'abcdef.'],
  ])('rejects malformed input: %s', (_label, input) => {
    expect(() => decodeCursor(input, SECRET, NOW)).toThrow(CursorError);
  });

  it('rejects an expired cursor', () => {
    const issued = new Date(NOW.getTime() - CURSOR_MAX_AGE_MS - 1000);
    const c = encodeCursor(new Date(), ID_A, SECRET, issued);
    try {
      decodeCursor(c, SECRET, NOW);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CursorError).reason).toBe('expired');
    }
  });

  it('accepts a cursor one second inside the expiry window', () => {
    const issued = new Date(NOW.getTime() - CURSOR_MAX_AGE_MS + 1000);
    const c = encodeCursor(new Date(), ID_A, SECRET, issued);
    expect(() => decodeCursor(c, SECRET, NOW)).not.toThrow();
  });

  it('rejects a non-ObjectId id at encode time', () => {
    expect(() => encodeCursor(new Date(), 'not-an-object-id', SECRET, NOW)).toThrow(CursorError);
    expect(() => encodeCursor(new Date(), ID_A.toUpperCase(), SECRET, NOW)).toThrow(CursorError);
  });

  it('rejects an invalid publishedAt at encode time', () => {
    expect(() => encodeCursor(new Date('nonsense'), ID_A, SECRET, NOW)).toThrow(/valid date/);
  });

  it.each([
    ['p missing', { i: ID_A, t: 1757043131 }],
    ['p not a number', { p: 'x', i: ID_A, t: 1757043131 }],
    ['i missing', { p: 1, t: 1757043131 }],
    ['i not an ObjectId', { p: 1, i: 'zzz', t: 1757043131 }],
    ['t missing', { p: 1, i: ID_A }],
    ['not an object', 42],
    ['null body', null],
  ])('rejects a structurally invalid payload: %s', (_label, payload) => {
    const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    expect(() => decodeCursor(`${body}.${signBody(body)}`, SECRET, NOW)).toThrow(CursorError);
  });

  it('rejects a body that is not valid JSON', () => {
    const body = b64url(Buffer.from('{not json', 'utf8'));
    expect(() => decodeCursor(`${body}.${signBody(body)}`, SECRET, NOW)).toThrow(/JSON/);
  });
});
