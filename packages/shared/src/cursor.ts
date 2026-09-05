import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Opaque, signed pagination cursor.  Spec Ch. 6.5.3.
 *
 * The cursor encodes the sort key of the LAST returned document so the next page
 * can resume with a strict inequality.  Two properties matter and are the reason
 * this file carries 100% branch coverage:
 *
 *   1. The sort key is the compound (publishedAt, _id), not publishedAt alone.
 *      Two articles published in the same millisecond are otherwise ordered
 *      non-deterministically, which duplicates one card and skips another at the
 *      page boundary.
 *   2. Offset pagination is never used.  New articles are inserted at the head of
 *      the sort order, so skip/limit shows the reader the same card twice.
 *
 * Clients MUST treat the string as opaque.  It is signed so a tampered cursor is
 * rejected before it reaches a database query.
 */

/** Maximum age of a cursor before it is refused. Spec: 24 hours. */
export const CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CursorPayload {
  /** publishedAt of the last returned document, epoch milliseconds. */
  p: number;
  /** _id of the last returned document, as a 24-character hex string. */
  i: string;
  /** Issued-at, epoch SECONDS (keeps the encoded cursor short). */
  t: number;
}

export class CursorError extends Error {
  constructor(
    message: string,
    readonly reason: 'malformed' | 'bad_signature' | 'expired',
  ) {
    super(message);
    this.name = 'CursorError';
  }
}

const OBJECT_ID_RE = /^[0-9a-f]{24}$/;

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(body: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(body).digest());
}

/**
 * Encode a cursor pointing at the last document of the current page.
 *
 * @param publishedAt  the document's publishedAt
 * @param id           the document's _id as a hex string
 * @param secret       CURSOR_SECRET
 * @param now          injectable clock, for tests
 */
export function encodeCursor(
  publishedAt: Date,
  id: string,
  secret: string,
  now: Date = new Date(),
): string {
  if (!OBJECT_ID_RE.test(id)) {
    throw new CursorError(`id is not a 24-character hex ObjectId: ${id}`, 'malformed');
  }
  const time = publishedAt.getTime();
  if (!Number.isFinite(time)) {
    throw new CursorError('publishedAt is not a valid date', 'malformed');
  }

  const payload: CursorPayload = {
    p: time,
    i: id,
    t: Math.floor(now.getTime() / 1000),
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

/**
 * Decode and verify a cursor.
 *
 * Throws CursorError for every failure mode; callers map that to HTTP 400
 * INVALID_CURSOR (Ch. 6.2) and restart pagination from page one.
 */
export function decodeCursor(
  cursor: string,
  secret: string,
  now: Date = new Date(),
): CursorPayload {
  const dot = cursor.indexOf('.');
  if (dot <= 0 || dot === cursor.length - 1) {
    throw new CursorError('cursor is not <body>.<signature>', 'malformed');
  }
  const body = cursor.slice(0, dot);
  const signature = cursor.slice(dot + 1);

  // Constant-time comparison. Length differences are handled explicitly because
  // timingSafeEqual throws on mismatched lengths.
  const expected = Buffer.from(sign(body, secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new CursorError('cursor signature does not verify', 'bad_signature');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    throw new CursorError('cursor body is not valid JSON', 'malformed');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new CursorError('cursor body is not an object', 'malformed');
  }
  const { p, i, t } = parsed as Record<string, unknown>;

  if (typeof p !== 'number' || !Number.isFinite(p)) {
    throw new CursorError('cursor.p is not a finite number', 'malformed');
  }
  if (typeof i !== 'string' || !OBJECT_ID_RE.test(i)) {
    throw new CursorError('cursor.i is not an ObjectId hex string', 'malformed');
  }
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    throw new CursorError('cursor.t is not a finite number', 'malformed');
  }

  if (now.getTime() - t * 1000 > CURSOR_MAX_AGE_MS) {
    throw new CursorError('cursor has expired', 'expired');
  }

  return { p, i, t };
}
