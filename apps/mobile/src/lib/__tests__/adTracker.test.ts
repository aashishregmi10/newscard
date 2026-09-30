import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * The tracker's two dependencies, replaced: storage, and the network call. Both
 * would otherwise pull in React Native, which this suite deliberately runs
 * without — see vitest.config.ts.
 */
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  },
}));

const posted: Array<{ deviceId: string; events: Array<Record<string, unknown>> }> = [];
vi.mock('../../api/client', () => ({
  postAdEvents: vi.fn(async (deviceId: string, events: Array<Record<string, unknown>>) => {
    posted.push({ deviceId, events });
  }),
}));

const tracker = await import('../adTracker');

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

beforeEach(() => {
  tracker.__resetAdTracker();
  store.clear();
  posted.length = 0;
  tracker.setAdDeviceId('00000000-0000-4000-8000-000000000000');
});

const card = { id: 'ad_c1_5', campaignId: 'c1' };
const small = { id: 'inl_c2_story1', campaignId: 'c2' };

describe('the daily counts', () => {
  it('counts the small ad apart from the full card', async () => {
    /* The reason for two counts: at one small ad per story, a shared count would
       spend the full-card allowance of twelve in twelve stories. */
    await tracker.loadAdBudget();
    tracker.noteAdVisible(small, 'top', 'inline');
    tracker.noteAdHidden(small.id);
    expect(tracker.inlineShownToday()).toBe(1);
    expect(tracker.adsShownToday()).toBe(0);

    tracker.noteAdVisible(card, 'top', 'card');
    tracker.noteAdHidden(card.id);
    expect(tracker.adsShownToday()).toBe(1);
    expect(tracker.inlineShownToday()).toBe(1);
  });

  it('carries over today’s full-card count from the old single counter', async () => {
    /* An update installed mid-day must not reset the reader’s allowance. */
    store.set('saar.adBudget.v1', JSON.stringify({ date: today(), count: 5 }));
    await tracker.loadAdBudget();
    expect(tracker.adsShownToday()).toBe(5);
    expect(tracker.inlineShownToday()).toBe(0);
  });

  it('ignores a count from another day', async () => {
    store.set('saar.adBudget.v2', JSON.stringify({ date: '2000-01-01', count: 9, inline: 40 }));
    await tracker.loadAdBudget();
    expect(tracker.adsShownToday()).toBe(0);
    expect(tracker.inlineShownToday()).toBe(0);
  });
});

describe('what is reported', () => {
  it('tags every event with its placement', async () => {
    tracker.noteAdVisible(small, 'politics', 'inline');
    tracker.noteAdHidden(small.id);
    tracker.noteAdClick(small, 'politics', 'inline');
    await tracker.flushAdEvents();

    const events = posted.flatMap((p) => p.events);
    expect(events.map((e) => [e.type, e.placement])).toEqual([
      ['impression', 'inline'],
      ['click', 'inline'],
    ]);
  });

  it('reports one impression per ad however often it scrolls past', async () => {
    tracker.noteAdVisible(small, 'top', 'inline');
    tracker.noteAdHidden(small.id);
    tracker.noteAdVisible(small, 'top', 'inline');
    tracker.noteAdHidden(small.id);
    await tracker.flushAdEvents();
    expect(posted.flatMap((p) => p.events).filter((e) => e.type === 'impression')).toHaveLength(1);
  });

  it('defaults to the full card, so callers from before placements are unchanged', async () => {
    tracker.noteAdVisible(card, 'top');
    tracker.noteAdHidden(card.id);
    await tracker.flushAdEvents();
    expect(posted[0]?.events[0]?.placement).toBe('card');
  });
});
