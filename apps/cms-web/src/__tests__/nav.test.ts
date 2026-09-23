import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PER_PAGE,
  DEFAULT_ROUTE,
  Routes,
  canAccess,
  parseRoute,
  resolveRoute,
  routeToHash,
  screenKeyOf,
  sectionOf,
  type Role,
  type Route,
} from '../nav';

/**
 * The routing contract.
 *
 * `apps/cms-web` had no tests at all — 1,500 lines, and the only thing
 * standing between it and a regression was the type checker. These cover the
 * part where a mistake is both most likely and least visible: a URL that
 * silently resolves to the wrong screen looks like a rendering bug, and nobody
 * thinks to suspect the parser.
 *
 * This file imports nav.ts alone, which imports nothing. That is deliberate:
 * the root test runner cannot resolve this application's node_modules — it is
 * not an npm workspace — so a test that reached for React would pass locally
 * and fail in CI, which is the worst of both.
 */

const ALL_ROUTES: readonly Route[] = [
  Routes.queue(),
  Routes.queue({ page: 3, perPage: 50, q: 'road repairs' }),
  Routes.new(),
  Routes.article('65f1c2a4b8e9d0123456789a'),
  Routes.article('65f1c2a4b8e9d0123456789a', 'notes'),
  Routes.shorts(),
  Routes.shorts({ page: 2, perPage: 100 }),
  Routes.shortNew(),
  Routes.sources(),
  Routes.sources({ tab: 'pending', page: 2, perPage: 50, q: 'khabar' }),
  Routes.sourceNew(),
  Routes.source('namuna-khabar'),
  Routes.notifications(),
  Routes.notifications('history'),
];

describe('parseRoute and routeToHash', () => {
  it('round-trips every route', () => {
    for (const route of ALL_ROUTES) {
      expect(parseRoute(routeToHash(route))).toEqual(route);
    }
  });

  it('treats an empty location as the queue', () => {
    expect(parseRoute('')).toEqual(Routes.queue());
    expect(parseRoute('#')).toEqual(Routes.queue());
    expect(parseRoute('#/')).toEqual(Routes.queue());
  });

  it('accepts the spellings a hand-typed link actually has', () => {
    // No leading slash, a trailing one, and the wrong case.
    expect(parseRoute('#queue')).toEqual(Routes.queue());
    expect(parseRoute('#/queue/')).toEqual(Routes.queue());
    expect(parseRoute('#/Shorts')).toEqual(Routes.shorts());
    expect(parseRoute('#/NOTIFICATIONS')).toEqual(Routes.notifications());
  });

  it('falls back to the queue for anything it does not recognise', () => {
    expect(parseRoute('#/nonsense')).toEqual(DEFAULT_ROUTE);
    expect(parseRoute('#/queue/new/extra')).toEqual(DEFAULT_ROUTE);
    // Shorts have no detail screen, so a short's id is not a route.
    expect(parseRoute('#/shorts/123')).toEqual(DEFAULT_ROUTE);
    expect(parseRoute('#/shorts/new/extra')).toEqual(DEFAULT_ROUTE);
  });

  it('separates the publisher list, the create form and one publisher', () => {
    expect(parseRoute('#/sources')).toEqual(Routes.sources());
    expect(parseRoute('#/sources/new')).toEqual(Routes.sourceNew());
    expect(parseRoute('#/sources/NEW')).toEqual(Routes.sourceNew());
    expect(parseRoute('#/sources/namuna-khabar')).toEqual(Routes.source('namuna-khabar'));
  });

  it('folds a publisher slug to lower case, unlike an opaque article id', () => {
    // A slug is a constrained lowercase token by schema; an article id is not.
    expect(parseRoute('#/sources/Namuna-Khabar')).toEqual(Routes.source('namuna-khabar'));
    expect(parseRoute('#/queue/AbC123')).toEqual(Routes.article('AbC123'));
  });

  it('refuses a segment that is not a storable slug', () => {
    /*
     * Validated at the boundary so nothing path-shaped ever reaches a URL
     * builder, and so a slug that could not exist does not become a request.
     */
    for (const bad of ['a', '..', '%2e%2e', 'has_underscore', 'Has Space', 'a'.repeat(65)]) {
      expect(parseRoute(`#/sources/${bad}`)).toEqual(DEFAULT_ROUTE);
    }
    expect(parseRoute('#/sources/a/b')).toEqual(DEFAULT_ROUTE);

    // But a publisher may legitimately be slugged "sources". Only `new` is
    // reserved, because only `new` is a route.
    expect(parseRoute('#/sources/sources')).toEqual(Routes.source('sources'));
  });

  it('separates the shorts library from the upload form', () => {
    expect(parseRoute('#/shorts')).toEqual(Routes.shorts());
    expect(parseRoute('#/shorts/new')).toEqual(Routes.shortNew());
    expect(parseRoute('#/shorts/NEW')).toEqual(Routes.shortNew());
    expect(routeToHash(Routes.shortNew())).toBe('#/shorts/new');
  });

  it('keeps the case of a story id', () => {
    // Ids are opaque. Folding their case would break the day they stop being
    // lowercase hex, and the failure would look like "story not found".
    expect(parseRoute('#/queue/AbC123')).toEqual(Routes.article('AbC123'));
  });

  it('distinguishes the new-story form from a story called "new"', () => {
    expect(parseRoute('#/queue/new')).toEqual(Routes.new());
    expect(parseRoute('#/queue/NEW')).toEqual(Routes.new());
  });

  it('decodes an id, and survives one that cannot be decoded', () => {
    expect(parseRoute('#/queue/a%20b')).toEqual(Routes.article('a b'));
    // A lone % is a malformed escape; decodeURIComponent throws on it.
    expect(() => parseRoute('#/queue/100%')).not.toThrow();
    expect(parseRoute('#/queue/100%')).toEqual(Routes.article('100%'));
  });

  it('escapes an id on the way out so the hash survives a round trip', () => {
    const hash = routeToHash(Routes.article('a b/c'));
    expect(hash).toBe('#/queue/a%20b%2Fc');
    expect(parseRoute(hash)).toEqual(Routes.article('a b/c'));
  });

  it('leaves out every parameter that is at its default', () => {
    // The canonical hash is compared against the address bar to decide whether
    // to rewrite it. Spelling out defaults would rewrite '#/queue' into
    // '#/queue?page=1&perPage=20' on every visit, saying nothing extra.
    expect(routeToHash(Routes.queue())).toBe('#/queue');
    expect(routeToHash(Routes.shorts())).toBe('#/shorts');
    expect(routeToHash(Routes.article('abc'))).toBe('#/queue/abc');
    expect(routeToHash(Routes.article('abc', 'source'))).toBe('#/queue/abc');
  });

  it('writes only the parameters that differ from the default', () => {
    expect(routeToHash(Routes.queue({ page: 2 }))).toBe('#/queue?page=2');
    expect(routeToHash(Routes.queue({ q: 'road' }))).toBe('#/queue?q=road');
    expect(routeToHash(Routes.article('abc', 'notes'))).toBe('#/queue/abc?tab=notes');
  });
});

describe('the tab in the URL', () => {
  it('reads a known tab and ignores an unknown one', () => {
    expect(parseRoute('#/queue/abc?tab=notes')).toEqual(Routes.article('abc', 'notes'));
    expect(parseRoute('#/queue/abc?tab=guidance')).toEqual(Routes.article('abc', 'guidance'));
    // A tab removed in a later release must not render an empty panel.
    expect(parseRoute('#/queue/abc?tab=whatever')).toEqual(Routes.article('abc', 'source'));
  });

  it('accepts a tab in any case', () => {
    expect(parseRoute('#/queue/abc?tab=NOTES')).toEqual(Routes.article('abc', 'notes'));
  });

  it('carries the notification screen tab too', () => {
    expect(parseRoute('#/notifications')).toEqual(Routes.notifications('compose'));
    expect(parseRoute('#/notifications?tab=history')).toEqual(Routes.notifications('history'));
    expect(parseRoute('#/notifications?tab=test')).toEqual(Routes.notifications('test'));
    // An unknown tab lands on the default rather than rendering an empty panel.
    expect(parseRoute('#/notifications?tab=nope')).toEqual(Routes.notifications('compose'));
  });

  it('carries the publisher list tab', () => {
    expect(parseRoute('#/sources')).toEqual(Routes.sources({ tab: 'all' }));
    expect(parseRoute('#/sources?tab=pending')).toEqual(Routes.sources({ tab: 'pending' }));
    expect(parseRoute('#/sources?tab=AGREED')).toEqual(Routes.sources({ tab: 'agreed' }));
    expect(parseRoute('#/sources?tab=nonsense')).toEqual(Routes.sources({ tab: 'all' }));
  });

  it('does not confuse the three kinds of tab', () => {
    /*
     * All three live under `?tab=` and each has its own vocabulary. 'notes' is
     * meaningless on the notification screen, 'history' on a story, and
     * 'compose' on the publisher list — each must fall back to its own default
     * rather than rendering an empty panel.
     */
    expect(parseRoute('#/notifications?tab=notes')).toEqual(Routes.notifications('compose'));
    expect(parseRoute('#/queue/abc?tab=history')).toEqual(Routes.article('abc', 'source'));
    expect(parseRoute('#/sources?tab=compose')).toEqual(Routes.sources({ tab: 'all' }));
    expect(parseRoute('#/sources?tab=source')).toEqual(Routes.sources({ tab: 'all' }));
  });
});

describe('paging in the URL', () => {
  it('reads a page number', () => {
    expect(parseRoute('#/queue?page=4')).toEqual(Routes.queue({ page: 4 }));
    expect(parseRoute('#/shorts?page=2')).toEqual(Routes.shorts({ page: 2 }));
  });

  it('treats anything that is not a positive whole number as the first page', () => {
    for (const bad of ['0', '-3', 'abc', '1.5', '', 'NaN', 'Infinity']) {
      expect(parseRoute(`#/queue?page=${bad}`).name).toBe('queue');
      expect(parseRoute(`#/queue?page=${bad}`)).toEqual(Routes.queue());
    }
  });

  it('only accepts a page size it actually offers', () => {
    /*
     * perPage is attacker-controlled input that becomes a slice length. Left
     * open, `?perPage=100000` is a request to render the whole archive into the
     * DOM and the tab stops responding.
     */
    expect(parseRoute('#/queue?perPage=50')).toEqual(Routes.queue({ perPage: 50 }));
    expect(parseRoute('#/queue?perPage=100000')).toEqual(Routes.queue());
    expect(parseRoute('#/queue?perPage=7')).toEqual(Routes.queue());
    expect(parseRoute('#/queue?perPage=-10')).toEqual(Routes.queue());

    const route = parseRoute('#/queue?perPage=abc');
    if (route.name !== 'queue') throw new Error('expected the queue');
    expect(route.perPage).toBe(DEFAULT_PER_PAGE);
  });
});

describe('the search term in the URL', () => {
  it('reads and round-trips a term, including spaces', () => {
    const route = parseRoute('#/queue?q=road%20repairs');
    expect(route).toEqual(Routes.queue({ q: 'road repairs' }));
    expect(parseRoute(routeToHash(route))).toEqual(route);
  });

  it('round-trips a Devanagari term', () => {
    const route = Routes.queue({ q: 'सडक' });
    expect(parseRoute(routeToHash(route))).toEqual(route);
  });

  it('trims, so one search does not have two addresses', () => {
    expect(parseRoute('#/queue?q=%20road%20')).toEqual(Routes.queue({ q: 'road' }));
  });

  it('caps the length rather than filtering on whatever fits in an address bar', () => {
    const long = 'a'.repeat(500);
    expect(parseRoute(`#/queue?q=${long}`).name).toBe('queue');
    const route = parseRoute(`#/queue?q=${long}`);
    if (route.name !== 'queue') throw new Error('expected the queue');
    expect(route.q.length).toBeLessThanOrEqual(120);
  });

  it('carries several parameters at once', () => {
    expect(parseRoute('#/queue?q=road&page=3&perPage=50')).toEqual(
      Routes.queue({ q: 'road', page: 3, perPage: 50 }),
    );
  });

  it('ignores a parameter appended by something outside the application', () => {
    // Mail clients and analytics do this to shared links.
    expect(parseRoute('#/shorts?utm_source=mail')).toEqual(Routes.shorts());
    expect(parseRoute('#/queue/65f1?ref=x')).toEqual(Routes.article('65f1'));
  });
});

describe('sectionOf', () => {
  it('files the composer and the new-story form under the queue', () => {
    // Otherwise the rail unlights while you are working on a story, which is
    // the exact confusion the rail was introduced to remove.
    expect(sectionOf(Routes.queue())).toBe('queue');
    expect(sectionOf(Routes.new())).toBe('queue');
    expect(sectionOf(Routes.article('x'))).toBe('queue');
    expect(sectionOf(Routes.shorts())).toBe('shorts');
    expect(sectionOf(Routes.notifications())).toBe('notifications');
  });

  it('files the upload form under shorts', () => {
    // Same reason: the rail must not unlight while you are uploading a clip.
    expect(sectionOf(Routes.shortNew())).toBe('shorts');
  });

  it('files every publisher screen under publishers', () => {
    expect(sectionOf(Routes.sources())).toBe('sources');
    expect(sectionOf(Routes.sourceNew())).toBe('sources');
    expect(sectionOf(Routes.source('x-y'))).toBe('sources');
  });
});

describe('screenKeyOf', () => {
  it('is the same for a screen whose parameters changed', () => {
    // Paging or searching must not count as arriving at a new screen, or the
    // page would scroll to the top and steal focus on every keystroke.
    expect(screenKeyOf(Routes.queue({ page: 1 }))).toBe(screenKeyOf(Routes.queue({ page: 9 })));
    expect(screenKeyOf(Routes.queue({ q: 'road' }))).toBe(screenKeyOf(Routes.queue()));
    expect(screenKeyOf(Routes.sources({ tab: 'pending' }))).toBe(screenKeyOf(Routes.sources()));
    expect(screenKeyOf(Routes.article('a', 'source'))).toBe(screenKeyOf(Routes.article('a', 'notes')));
    expect(screenKeyOf(Routes.notifications('compose'))).toBe(
      screenKeyOf(Routes.notifications('test')),
    );
  });

  it('differs between screens, and between two stories', () => {
    expect(screenKeyOf(Routes.queue())).not.toBe(screenKeyOf(Routes.shorts()));
    expect(screenKeyOf(Routes.article('a'))).not.toBe(screenKeyOf(Routes.article('b')));
    // A list and its create form are different screens, so arriving at the
    // upload form should scroll to the top rather than keep the list's offset.
    expect(screenKeyOf(Routes.shorts())).not.toBe(screenKeyOf(Routes.shortNew()));
    expect(screenKeyOf(Routes.sources())).not.toBe(screenKeyOf(Routes.sourceNew()));
    expect(screenKeyOf(Routes.source('a-a'))).not.toBe(screenKeyOf(Routes.source('b-b')));
  });
});

describe('canAccess and resolveRoute', () => {
  const ROLES: readonly Role[] = ['author', 'reviewer', 'admin'];

  it('keeps an author out of the notification screen', () => {
    // The same rule the server enforces on the route; this is only so the
    // screen is not offered and a typed link lands somewhere usable.
    expect(canAccess(Routes.notifications(), 'author')).toBe(false);
    expect(canAccess(Routes.notifications(), 'reviewer')).toBe(true);
    expect(canAccess(Routes.notifications(), 'admin')).toBe(true);
  });

  it('lets every role reach every other screen', () => {
    /* The two exceptions are the two the permission matrix names: notifications
       need `notification.send` (reviewer and admin) and adding a publisher needs
       `source.write` (admin). Everything else is open to all three roles. */
    for (const role of ROLES) {
      for (const route of ALL_ROUTES) {
        if (route.name === 'notifications' || route.name === 'sourceNew') continue;
        expect(canAccess(route, role)).toBe(true);
      }
    }
  });

  it('sends a refused route to the queue rather than nowhere', () => {
    expect(resolveRoute(Routes.notifications(), 'author')).toEqual(DEFAULT_ROUTE);
    expect(resolveRoute(Routes.shorts(), 'author')).toEqual(Routes.shorts());
  });

  it('lets every role read publishers but only an admin add one', () => {
    /*
     * Mirrors the server's matrix exactly: `source.read` is held by all three
     * roles, `source.write` by admin alone. An author who cannot file against a
     * publisher needs to see that it is a licensing question, not a bug — so
     * the list is readable; only the create form is not.
     */
    for (const role of ROLES) {
      expect(canAccess(Routes.sources(), role)).toBe(true);
      expect(canAccess(Routes.source('namuna-khabar'), role)).toBe(true);
    }
    expect(canAccess(Routes.sourceNew(), 'author')).toBe(false);
    expect(canAccess(Routes.sourceNew(), 'reviewer')).toBe(false);
    expect(canAccess(Routes.sourceNew(), 'admin')).toBe(true);
    expect(resolveRoute(Routes.sourceNew(), 'reviewer')).toEqual(DEFAULT_ROUTE);
  });
});
