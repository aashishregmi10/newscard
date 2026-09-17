import { describe, it, expect, vi } from 'vitest';
import { runFeedLoad, appendPage, type FeedLoadDeps, type FeedState } from '../feedLoad.js';
import { INITIAL_FEED_STATE } from '../feedLoad.js';
import type { Card, FeedEntry, FeedPage } from '../../api/client';

/**
 * The first tests the mobile app has ever had, on the behaviour QA treats as
 * severity-1: a story we already hold is always shown, and losing the network
 * never blanks the screen.
 *
 * These assert the ORDER of what reaches the screen, because "cache first" is
 * an ordering guarantee. A test that only checked the final state would pass on
 * an implementation that showed a spinner for eight seconds and then the same
 * cards — which is the exact regression worth catching.
 */

function card(id: string): Card {
  return {
    id,
    slug: `story-${id}`,
    language: 'ne',
    headline: `Headline ${id}`,
    summary: 'summary',
    pullQuote: null,
    category: { slug: 'nepal', label: { ne: 'नेपाल', en: 'Nepal' } },
    source: { name: 'Source', logoUrl: null },
    author: null,
    originatingAgency: null,
    publisherUrl: 'https://example.invalid/x',
    publishedAt: '2026-09-17T10:00:00.000Z',
    sourcePublishedAt: null,
    image: null,
  };
}

function page(items: FeedEntry[], nextCursor: string | null = null): FeedPage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

/** Records every state the screen would have shown, in order. */
function recorder() {
  const states: FeedState[] = [];
  let current = { ...INITIAL_FEED_STATE };
  const emit = (next: FeedState | ((p: FeedState) => FeedState)): void => {
    current = typeof next === 'function' ? next(current) : next;
    states.push({ ...current });
  };
  return { states, emit };
}

function deps(over: Partial<FeedLoadDeps> = {}): FeedLoadDeps {
  return {
    getCached: async () => [],
    fetchPage: async () => page([]),
    loadAdBudget: async () => {},
    adsShownToday: () => 0,
    persist: () => {},
    ...over,
  };
}

const params = {
  mode: 'initial' as const,
  category: 'nepal',
  languages: ['ne' as const],
  isCurrent: () => true,
};

describe('runFeedLoad — cache first', () => {
  it('paints the cache BEFORE the network resolves', async () => {
    const { states, emit } = recorder();
    let releaseNetwork: (p: FeedPage) => void = () => {};
    const networkPage = new Promise<FeedPage>((r) => (releaseNetwork = r));

    const running = runFeedLoad(
      params,
      deps({
        getCached: async () => [card('cached-1')],
        fetchPage: () => networkPage,
      }),
      emit,
    );

    // Let the cache read settle; the network is still outstanding.
    await vi.waitFor(() => expect(states.length).toBe(2));

    expect(states[0]!.status).toBe('loading');
    expect(states[1]).toMatchObject({ status: 'ready', fromCache: true });
    expect(states[1]!.cards?.map((c) => c.id)).toEqual(['cached-1']);

    releaseNetwork(page([card('fresh-1')]));
    await running;

    const last = states[states.length - 1]!;
    expect(last).toMatchObject({ status: 'ready', fromCache: false });
    expect(last.cards?.map((c) => c.id)).toEqual(['fresh-1']);
  });

  it('does not blank the screen when the network fails after a cache hit', async () => {
    const { states, emit } = recorder();

    await runFeedLoad(
      params,
      deps({
        getCached: async () => [card('cached-1')],
        fetchPage: async () => {
          throw Object.assign(new Error('offline'), { kind: 'offline' });
        },
      }),
      emit,
    );

    const last = states[states.length - 1]!;
    // The cards survive, and the failure is reported alongside them.
    expect(last.cards?.map((c) => c.id)).toEqual(['cached-1']);
    expect(last.status).toBe('ready');
    expect(last.error).toEqual({ kind: 'offline', message: 'offline' });
  });

  it('reports empty rather than ready when there was nothing cached to keep', async () => {
    const { states, emit } = recorder();

    await runFeedLoad(
      params,
      deps({
        fetchPage: async () => {
          throw Object.assign(new Error('timeout'), { kind: 'timeout' });
        },
      }),
      emit,
    );

    expect(states[states.length - 1]).toMatchObject({
      status: 'empty',
      error: { kind: 'timeout' },
    });
  });

  it('survives a cache that throws', async () => {
    const { states, emit } = recorder();

    const outcome = await runFeedLoad(
      params,
      deps({
        getCached: async () => {
          throw new Error('sqlite is unavailable');
        },
        fetchPage: async () => page([card('fresh-1')]),
      }),
      emit,
    );

    // A broken cache is an optimisation that failed, not an outage.
    expect(outcome).not.toBeNull();
    expect(states[states.length - 1]!.cards?.map((c) => c.id)).toEqual(['fresh-1']);
  });

  it('discards a response for a category the reader has left', async () => {
    const { states, emit } = recorder();
    let current = true;

    await runFeedLoad(
      { ...params, isCurrent: () => current },
      deps({
        getCached: async () => [card('cached-1')],
        fetchPage: async () => {
          // The reader swipes to another category while this is in flight.
          current = false;
          return page([card('wrong-category')]);
        },
      }),
      emit,
    );

    expect(states.map((s) => s.cards?.map((c) => c.id) ?? null)).not.toContainEqual([
      'wrong-category',
    ]);
  });

  it('loads the ad budget before requesting, or a restart resets the daily cap', async () => {
    const order: string[] = [];

    await runFeedLoad(
      params,
      deps({
        loadAdBudget: async () => {
          order.push('budget');
        },
        fetchPage: async () => {
          order.push('fetch');
          return page([]);
        },
      }),
      recorder().emit,
    );

    expect(order).toEqual(['budget', 'fetch']);
  });

  it('caches editorial but never ads', async () => {
    const persisted: Card[][] = [];
    const ad = { ...card('ad-1'), kind: 'ad' } as unknown as FeedEntry;

    await runFeedLoad(
      params,
      deps({
        fetchPage: async () => page([card('story-1'), ad]),
        persist: (articles) => persisted.push(articles),
      }),
      recorder().emit,
    );

    // An ad has a flight window and a budget; serving one from a stale cache
    // would bill nobody and mislead the reader after the campaign ended.
    expect(persisted[0]!.map((c) => c.id)).toEqual(['story-1']);
  });
});

describe('appendPage — the page boundary', () => {
  it('appends the next page in order', () => {
    const result = appendPage([card('a')], [card('b'), card('c')]);
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a card already on screen rather than rendering it twice', () => {
    // The overlap the compound cursor makes unlikely and this makes impossible.
    // In React a duplicate key is a rendering bug rather than a visible one,
    // which is the hardest kind to notice.
    const result = appendPage([card('a'), card('b')], [card('b'), card('c')]);
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles the very first page, where nothing is on screen yet', () => {
    expect(appendPage(null, [card('a')]).map((c) => c.id)).toEqual(['a']);
  });

  it('is a no-op for an empty page', () => {
    expect(appendPage([card('a')], []).map((c) => c.id)).toEqual(['a']);
  });
});
