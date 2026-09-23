/**
 * Where you are in the application.
 *
 * -- Why this file exists ----------------------------------------------------
 *
 * Navigation used to be four independent booleans — `openId`, `creating`,
 * `notifying`, `shorts` — read by a chain of nested ternaries. Four booleans
 * describe sixteen states, of which five are meaningful; the other eleven were
 * unreachable only because every setter remembered to clear the other three.
 * That is a state machine held together by discipline, and it had already
 * produced a visible bug: the button for the section you were on was hidden,
 * so the only way to tell where you were was to notice what was missing.
 *
 * A discriminated union makes the eleven impossible states unrepresentable, and
 * the compiler checks the switch.
 *
 * -- Why the location bar carries the screen's whole state -------------------
 *
 * Not just which screen: which TAB of it, which PAGE of the list, and what the
 * list is filtered to. The rule is that anything you would be annoyed to lose
 * on a refresh, or would want to put in a message to a colleague, belongs in
 * the URL — "the third page of the queue filtered to road" is a sentence, and a
 * sentence should have an address.
 *
 * It also makes the browser's Back button mean what people expect. Switching a
 * tab and pressing Back returns to the previous tab rather than leaving the
 * story altogether, because the tab change was a navigation and is in the
 * history like one.
 *
 * -- Why this file has no imports --------------------------------------------
 *
 * It is pure: strings in, values out, no React, no `window`, no `import.meta`.
 * That is what lets it be unit-tested by the repository's root runner, which
 * cannot resolve this application's own node_modules. The React binding lives
 * next door in useRoute.ts.
 */

/** The tabs on the composer's reference column. */
export const ARTICLE_TABS = ['source', 'notes', 'guidance'] as const;
export type ArticleTab = (typeof ARTICLE_TABS)[number];

/**
 * The tabs on the notification screen.
 *
 * It used to be one page carrying five stacked panels — reach, compose, the
 * dispatch report, a single-handset test, and the history. Everything was
 * visible at once, which sounds like an advantage and is not: a screen where
 * the thing you came for is the fourth panel down is a screen you scan rather
 * than use, and the send button sat in the middle of it with two unrelated
 * forms below.
 *
 * Three jobs, three tabs. Composing is the default because it is what the
 * screen is for.
 */
export const NOTIFY_TABS = ['compose', 'history', 'test'] as const;
export type NotifyTab = (typeof NOTIFY_TABS)[number];

/**
 * The tabs on the publishers list.
 *
 * Licence status is not an attribute of a publisher — it is the question you
 * came to ask. While Gate 1 is open the daily question is "where have we got to
 * with the five?", and afterwards it is "may we use this one?". A list sorted
 * alphabetically with a small chip on each row buries both. The tab counts are
 * the Gate 1 dashboard, which is why there is no separate widget for it.
 */
export const LICENCE_TABS = ['all', 'agreed', 'pending', 'refused', 'unknown'] as const;
export type LicenceTab = (typeof LICENCE_TABS)[number];

/** A publisher's slug, as it may appear in a hash. Mirrors the schema's rule. */
const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/;

/**
 * Page sizes offered, and the only ones accepted.
 *
 * A closed set rather than any number the URL happens to carry. `perPage` is
 * attacker-controlled input that becomes a slice length: left open, `?perPage=`
 * with five zeroes on it is a request to render every story in the archive into
 * the DOM, and the tab stops responding.
 */
export const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];
export const DEFAULT_PER_PAGE: PerPage = 20;

/** Long enough for any real search, short enough not to be a payload. */
const MAX_QUERY_LENGTH = 120;

export type Route =
  | { name: 'queue'; page: number; perPage: PerPage; q: string }
  | { name: 'new' }
  | { name: 'article'; id: string; tab: ArticleTab }
  | { name: 'shorts'; page: number; perPage: PerPage }
  | { name: 'shortNew' }
  | { name: 'sources'; tab: LicenceTab; page: number; perPage: PerPage; q: string }
  | { name: 'sourceNew' }
  | { name: 'source'; slug: string }
  | { name: 'notifications'; tab: NotifyTab };

/** The top-level sections the rail offers. Every route belongs to one. */
export type Section = 'queue' | 'shorts' | 'sources' | 'notifications';

export type Role = 'author' | 'reviewer' | 'admin';

/**
 * Constructors, so a caller never has to remember the defaults.
 *
 * The alternative — optional fields on the union — means `{ name: 'queue' }`
 * and `{ name: 'queue', page: 1 }` are different values that mean the same
 * thing, which then has to be special-cased in every comparison. Required
 * fields and a constructor keep exactly one representation of each state.
 */
export const Routes = {
  queue: (params: { page?: number; perPage?: PerPage; q?: string } = {}): Route => ({
    name: 'queue',
    page: params.page ?? 1,
    perPage: params.perPage ?? DEFAULT_PER_PAGE,
    q: params.q ?? '',
  }),
  new: (): Route => ({ name: 'new' }),
  article: (id: string, tab: ArticleTab = 'source'): Route => ({ name: 'article', id, tab }),
  shorts: (params: { page?: number; perPage?: PerPage } = {}): Route => ({
    name: 'shorts',
    page: params.page ?? 1,
    perPage: params.perPage ?? DEFAULT_PER_PAGE,
  }),
  shortNew: (): Route => ({ name: 'shortNew' }),
  sources: (
    params: { tab?: LicenceTab; page?: number; perPage?: PerPage; q?: string } = {},
  ): Route => ({
    name: 'sources',
    tab: params.tab ?? 'all',
    page: params.page ?? 1,
    perPage: params.perPage ?? DEFAULT_PER_PAGE,
    q: params.q ?? '',
  }),
  sourceNew: (): Route => ({ name: 'sourceNew' }),
  source: (slug: string): Route => ({ name: 'source', slug }),
  notifications: (tab: NotifyTab = 'compose'): Route => ({ name: 'notifications', tab }),
};

export const DEFAULT_ROUTE: Route = Routes.queue();

/**
 * Read a route out of a location hash.
 *
 * Total: every string maps to a route, and anything unrecognised becomes the
 * queue. A router that can fail needs every caller to handle the failure, and
 * the only sensible handling of "that URL means nothing" in an application with
 * three screens is to show the first one.
 */
export function parseRoute(hash: string): Route {
  const { path, query } = split(hash);
  /* Section names are matched case-insensitively, because a hand-typed or
     auto-capitalised link should still land. The id is NOT lowercased with
     them: it is an opaque server identifier, and folding its case would break
     the moment ids stop being lowercase hex. */
  const section = path.toLowerCase();

  if (section === '' || section === 'queue') {
    return Routes.queue({
      page: readPage(query),
      perPage: readPerPage(query),
      q: readQuery(query),
    });
  }

  if (section === 'shorts') {
    return Routes.shorts({ page: readPage(query), perPage: readPerPage(query) });
  }

  if (section === 'shorts/new') return Routes.shortNew();

  if (section === 'sources') {
    return Routes.sources({
      tab: readLicenceTab(query),
      page: readPage(query),
      perPage: readPerPage(query),
      q: readQuery(query),
    });
  }

  /* Before the generic `sources/` branch below, exactly as `queue/new` comes
     before an article id — otherwise a publisher slugged "new" would shadow the
     create form, or the create form would shadow the publisher. */
  if (section === 'sources/new') return Routes.sourceNew();

  if (section.startsWith('sources/')) {
    const rest = path.slice('sources/'.length);
    if (rest !== '' && !rest.includes('/')) {
      /*
       * Unlike an article id, a slug is a constrained lowercase token, so it is
       * folded and validated here. That also means '..' and anything else
       * path-shaped never reaches a URL builder.
       */
      const slug = decodeSegment(rest).toLowerCase();
      if (SLUG_PATTERN.test(slug)) return Routes.source(slug);
    }
  }

  if (section === 'notifications') return Routes.notifications(readNotifyTab(query));

  if (section.startsWith('queue/')) {
    const rest = path.slice('queue/'.length);
    if (rest.toLowerCase() === 'new') return Routes.new();

    /*
     * An id is one segment. A hash with more — someone truncating a URL by
     * hand, a stale bookmark — is not half-honoured; it is not a story.
     *
     * Checked BEFORE decoding, and that order is the whole point: a literal
     * slash separates segments, but an escaped one (%2F) is a character inside
     * a single segment and perfectly legal. Testing the decoded string
     * conflates the two and throws away an id that routeToHash had just
     * escaped correctly.
     */
    if (rest !== '' && !rest.includes('/')) {
      const id = decodeSegment(rest);
      if (id !== '') return Routes.article(id, readTab(query));
    }
  }

  return DEFAULT_ROUTE;
}

/**
 * The canonical hash for a route.
 *
 * Parameters at their default value are omitted, so the first page of an
 * unfiltered queue is '#/queue' rather than '#/queue?page=1&perPage=20&q='.
 * That matters because this string is compared against the address bar to
 * decide whether to rewrite it — if defaults were spelled out, every visit to a
 * plain '#/queue' would rewrite the URL to a noisier one saying the same thing.
 */
export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'queue':
      return withQuery('#/queue', {
        q: route.q === '' ? null : route.q,
        page: route.page === 1 ? null : String(route.page),
        perPage: route.perPage === DEFAULT_PER_PAGE ? null : String(route.perPage),
      });
    case 'new':
      return '#/queue/new';
    case 'article':
      return withQuery(`#/queue/${encodeURIComponent(route.id)}`, {
        tab: route.tab === 'source' ? null : route.tab,
      });
    case 'shorts':
      return withQuery('#/shorts', {
        page: route.page === 1 ? null : String(route.page),
        perPage: route.perPage === DEFAULT_PER_PAGE ? null : String(route.perPage),
      });
    case 'shortNew':
      return '#/shorts/new';
    case 'sources':
      return withQuery('#/sources', {
        tab: route.tab === 'all' ? null : route.tab,
        q: route.q === '' ? null : route.q,
        page: route.page === 1 ? null : String(route.page),
        perPage: route.perPage === DEFAULT_PER_PAGE ? null : String(route.perPage),
      });
    case 'sourceNew':
      return '#/sources/new';
    case 'source':
      return `#/sources/${encodeURIComponent(route.slug)}`;
    case 'notifications':
      return withQuery('#/notifications', {
        tab: route.tab === 'compose' ? null : route.tab,
      });
  }
}

/** Which rail item should light up. */
export function sectionOf(route: Route): Section {
  switch (route.name) {
    case 'queue':
    case 'new':
    case 'article':
      return 'queue';
    case 'shorts':
    case 'shortNew':
      return 'shorts';
    case 'sources':
    case 'sourceNew':
    case 'source':
      return 'sources';
    case 'notifications':
      return 'notifications';
  }
}

/**
 * The part of a route that identifies the SCREEN, ignoring its parameters.
 *
 * Used to decide whether a navigation was a change of screen — which scrolls to
 * the top and moves focus — or a change of parameter within one. Paging a list
 * should scroll to the top; typing in its search box should not, or the page
 * would jump on every keystroke.
 */
export function screenKeyOf(route: Route): string {
  switch (route.name) {
    case 'queue':
      return 'queue';
    case 'new':
      return 'new';
    case 'article':
      return `article:${route.id}`;
    case 'shorts':
      return 'shorts';
    case 'shortNew':
      return 'shortNew';
    case 'sources':
      return 'sources';
    case 'sourceNew':
      return 'sourceNew';
    case 'source':
      return `source:${route.slug}`;
    case 'notifications':
      return 'notifications';
  }
}

/**
 * The same permission the server enforces on the route.
 *
 * Duplicated here on purpose, and only to decide what to SHOW. The server is
 * the authority; this exists so an author is not offered a screen that would
 * refuse them, and so a link to one typed by hand lands somewhere sensible
 * rather than on an error the reader cannot act on.
 */
export function canAccess(route: Route, role: Role): boolean {
  switch (route.name) {
    case 'notifications':
      return role !== 'author';
    /*
     * `source.read` is granted to every role, so the publisher list and one
     * publisher's record are readable by all — an author who cannot file
     * against a publisher deserves to see that it is a licensing question
     * rather than a bug. Only the create form is admin-only, because there is
     * nothing on it to read.
     */
    case 'sourceNew':
      return role === 'admin';
    default:
      return true;
  }
}

/**
 * The route to actually show, given who is asking.
 *
 * Kept separate from `canAccess` so the caller does not have to remember to ask
 * both questions in the right order.
 */
export function resolveRoute(route: Route, role: Role): Route {
  return canAccess(route, role) ? route : DEFAULT_ROUTE;
}

/* ------------------------------------------------------------------ parsing */

/**
 * Split a hash into a bare path and its query string.
 *
 * Handles the several shapes the location bar actually produces: '', '#',
 * '#/queue', '#queue' (what a hand-typed link looks like), a trailing slash,
 * and a query appended by something outside this application.
 */
function split(hash: string): { path: string; query: URLSearchParams } {
  let rest = hash.trim();
  if (rest.startsWith('#')) rest = rest.slice(1);

  const mark = rest.indexOf('?');
  const path = mark >= 0 ? rest.slice(0, mark) : rest;
  const search = mark >= 0 ? rest.slice(mark + 1) : '';

  return {
    /* Leading and trailing slashes are noise: '/queue/' and 'queue' are the
       same place, and treating them as different is how a URL ends up with two
       spellings that render one screen. */
    path: path.replace(/^\/+/, '').replace(/\/+$/, ''),
    query: new URLSearchParams(search),
  };
}

/**
 * Build a hash, leaving out every parameter that has nothing to say.
 *
 * Insertion order is fixed by the caller rather than sorted, so the same route
 * always produces byte-identical output — which is what makes comparing it
 * against `window.location.hash` a reliable test for "does this need
 * rewriting".
 */
function withQuery(base: string, params: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query === '' ? base : `${base}?${query}`;
}

/**
 * A page number, or the first page.
 *
 * Anything that is not a positive whole number is the first page: '0', '-3',
 * 'abc', '1.5', an empty value, and the absurdly large number that arrives when
 * someone edits the URL to see what happens. No upper bound is enforced here —
 * how many pages exist is a fact about the data, which this file does not have,
 * so the screen clamps it once it knows.
 */
function readPage(query: URLSearchParams): number {
  const raw = query.get('page');
  if (raw === null) return 1;
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function readPerPage(query: URLSearchParams): PerPage {
  const raw = Number(query.get('perPage'));
  return PER_PAGE_OPTIONS.find((option) => option === raw) ?? DEFAULT_PER_PAGE;
}

/**
 * The search term.
 *
 * Trimmed, because ' road' and 'road' are the same search and should not be two
 * URLs; and capped, because the length is otherwise whatever fits in an address
 * bar and it ends up in a `filter` callback on every keystroke.
 */
function readQuery(query: URLSearchParams): string {
  return (query.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
}

function readTab(query: URLSearchParams): ArticleTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return ARTICLE_TABS.find((tab) => tab === raw) ?? 'source';
}

function readNotifyTab(query: URLSearchParams): NotifyTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return NOTIFY_TABS.find((tab) => tab === raw) ?? 'compose';
}

function readLicenceTab(query: URLSearchParams): LicenceTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return LICENCE_TABS.find((tab) => tab === raw) ?? 'all';
}

/**
 * Decode one path segment.
 *
 * `decodeURIComponent` throws on a malformed escape — '%zz', or a '%' someone
 * typed literally. A bad character in a URL is not worth an error boundary, so
 * the raw segment is used instead and the lookup simply finds no such story.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
