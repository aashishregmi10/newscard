import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { close, connect, getDb, syncIndexes } from '../index.js';

/**
 * Index sync against a real database. The case that mattered on 7 Oct 2026:
 * duplicates in `leads` failed its unique index, the sync stopped, and every
 * collection after it went without its indexes. Now it records the failure and
 * goes on. URLs are synthetic.
 */

const URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/newscard_test';

beforeAll(async () => {
  await connect({ uri: URI });
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  for (const name of ['leads', 'votes', 'ratings', 'readers']) {
    await getDb()
      .collection(name)
      .drop()
      .catch(() => undefined);
  }
});

describe('syncIndexes', () => {
  it('records an index it cannot build, and builds every other collection’s', async () => {
    const dupe = { canonicalUrl: 'https://example.invalid/same-story', purgeAt: new Date(Date.now() + 86_400_000) };
    await getDb().collection('leads').insertMany([
      { _id: new ObjectId(), ...dupe },
      { _id: new ObjectId(), ...dupe },
    ]);

    const results = await syncIndexes(getDb());
    const leads = results.find((r) => r.collection === 'leads')!;
    expect(leads.failed.map((f) => f.name)).toContain('lead_url_unique');
    /* The rest of `leads`, and every later collection, still got theirs. */
    expect(leads.created).toContain('lead_expiry');
    const votes = await getDb().collection('votes').indexes();
    expect(votes.map((i) => i.name)).toContain('vote_one_per_reader');
    const ratings = await getDb().collection('ratings').indexes();
    expect(ratings.map((i) => i.name)).toContain('rating_one_send_per_reader');
  });

  it('puts the old index back when a changed definition cannot be built', async () => {
    const readers = getDb().collection('readers');
    /* An old, non-unique reader_sub_unique; two readers share a subHash, so the
       declared unique version cannot be built over them. */
    await readers.createIndex({ subHash: 1 }, { name: 'reader_sub_unique' });
    await readers.insertMany([{ subHash: 'same' }, { subHash: 'same' }]);

    const results = await syncIndexes(getDb());
    expect(results.find((r) => r.collection === 'readers')!.failed.map((f) => f.name)).toEqual(['reader_sub_unique']);
    const after = (await readers.indexes()).find((i) => i.name === 'reader_sub_unique');
    expect(after).toBeDefined();
    expect(after?.unique ?? false).toBe(false);
  });

  it('is a no-op the second time', async () => {
    await syncIndexes(getDb());
    const again = await syncIndexes(getDb());
    expect(again.every((r) => r.created.length === 0 && r.failed.length === 0)).toBe(true);
  });
});
