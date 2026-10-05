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
 * The triage queue, split by what has been done with each lead.
 *
 * The same three values the server stores, because inventing a display
 * vocabulary on top of a stored one gives you two things to keep in step.
 */
/** Live, and withdrawn. Both are 'what a reader saw', which is the question
 *  this screen answers; a draft is a different question and has the queue. */
export const PUBLISHED_TABS = ['published', 'retracted'] as const;
export type PublishedTab = (typeof PUBLISHED_TABS)[number];

/** Ten, for the same reason as the triage queue: the row is tall. */
export const PUBLISHED_PER_PAGE: PerPage = 10;

export const LEAD_TABS = ['new', 'promoted', 'dismissed'] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

/**
 * The Shorts screen's tabs: the library of shorts we have made, and the
 * Shorts collected from YouTube channels — waiting, promoted, dismissed —
 * which are article Incoming's three tabs for video.
 */
export const SHORTS_TABS = ['library', 'incoming', 'promoted', 'dismissed'] as const;
export type ShortsTab = (typeof SHORTS_TABS)[number];

/**
 * Ten, and not a setting.
 *
 * Every other list lets the reader pick a page size. A lead row is a
 * headline, three lines of the story and a thumbnail — three or four times
 * the height of a queue row — so every option except the smallest produces a
 * page nobody reaches the bottom of. A menu whose other entries are all
 * worse is not a choice, so there is no menu and no `perPage` in the route.
 */
export const LEADS_PER_PAGE: PerPage = 10;

/**
 * The publisher list, also fixed.
 *
 * For a different reason from the leads queue: this list is not long. A
 * newsroom watches a dozen or two publishers, not a thousand, so the page
 * size was never the thing standing between anyone and the row they wanted —
 * the filter above it is. A menu offering to show a hundred of twenty is a
 * control that does nothing.
 */
export const SOURCES_PER_PAGE: PerPage = 10;

/**
 * The shorts library, fixed at ten like the other lists.
 *
 * Each row carries a poster, so it is taller than a queue row, and a library
 * of clips is scanned by picture rather than read — ten posters is a page
 * you can take in at once. It is paged on the server: see GET /cms/shorts
 * for the cap that used to hide everything past the sixtieth.
 */
export const SHORTS_PER_PAGE: PerPage = 10;

/**
 * The campaign list’s tabs. A campaign’s place among them follows from its
 * status and its dates — see ads.routes.ts — rather than a stored label that
 * would go stale at midnight.
 */
export const AD_TABS = ['running', 'scheduled', 'paused', 'finished', 'draft'] as const;

/** Interactions: live (open, or scheduled to open), drafts, and closed. */
export const INTERACTION_TABS = ['live', 'drafts', 'closed'] as const;
export type InteractionTab = (typeof INTERACTION_TABS)[number];

/** Ten, like the other lists: each row is a whole card. Matches the server's page. */
export const INTERACTIONS_PER_PAGE: PerPage = 10;
export type AdTab = (typeof AD_TABS)[number];

/** Ten, like every other list here. */
export const ADS_PER_PAGE: PerPage = 10;

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

/**
 * The pages anyone may open.
 *
 * They render without a session and before one has been checked for — see
 * App.tsx. That is the whole distinction: a staff route waits to find out
 * who you are, a public one never asks.
 *
 * The advertiser report is not in here because it is not a React route at
 * all. It is a static page in `public/report`, kept that way deliberately
 * — the header links to it like any other address.
 */
export const PUBLIC_ROUTES = ['home', 'about', 'contact'] as const;
export type PublicRouteName = (typeof PUBLIC_ROUTES)[number];

export type Route =
  | { name: 'home' }
  | { name: 'about' }
  | { name: 'contact' }
  | { name: 'queue'; page: number; perPage: PerPage; q: string }
  | { name: 'new' }
  | { name: 'article'; id: string; tab: ArticleTab }
  | { name: 'shorts'; tab: ShortsTab; page: number }
  | { name: 'shortEdit'; id: string }
  | { name: 'ads'; tab: AdTab; page: number }
  | { name: 'adNew' }
  | { name: 'ad'; id: string }
  | { name: 'advertisers' }
  | { name: 'interactions'; tab: InteractionTab; page: number }
  | { name: 'interactionNew' }
  | { name: 'interaction'; id: string }
  | { name: 'shortNew' }
  | { name: 'sources'; tab: LicenceTab; page: number; q: string }
  | { name: 'sourceNew' }
  | { name: 'source'; slug: string }
  | { name: 'published'; tab: PublishedTab; page: number }
  | { name: 'publishedEdit'; id: string }
  | { name: 'leads'; tab: LeadTab; page: number }
  | { name: 'notifications'; tab: NotifyTab };

/** The top-level sections the rail offers. Every route belongs to one. */
export type Section =
  | 'queue'
  | 'published'
  | 'leads'
  | 'shorts'
  | 'sources'
  | 'ads'
  | 'interactions'
  | 'notifications';

/**
 * Constructors, so a caller never has to remember the defaults.
 *
 * The alternative — optional fields on the union — means `{ name: 'queue' }`
 * and `{ name: 'queue', page: 1 }` are different values that mean the same
 * thing, which then has to be special-cased in every comparison. Required
 * fields and a constructor keep exactly one representation of each state.
 */
export const Routes = {
  home: (): Route => ({ name: 'home' }),
  about: (): Route => ({ name: 'about' }),
  contact: (): Route => ({ name: 'contact' }),
  queue: (params: { page?: number; perPage?: PerPage; q?: string } = {}): Route => ({
    name: 'queue',
    page: params.page ?? 1,
    perPage: params.perPage ?? DEFAULT_PER_PAGE,
    q: params.q ?? '',
  }),
  new: (): Route => ({ name: 'new' }),
  article: (id: string, tab: ArticleTab = 'source'): Route => ({ name: 'article', id, tab }),
  shorts: (params: { tab?: ShortsTab; page?: number } = {}): Route => ({
    name: 'shorts',
    tab: params.tab ?? 'library',
    page: params.page ?? 1,
  }),
  shortNew: (): Route => ({ name: 'shortNew' }),
  shortEdit: (id: string): Route => ({ name: 'shortEdit', id }),
  ads: (params: { tab?: AdTab; page?: number } = {}): Route => ({
    name: 'ads',
    tab: params.tab ?? 'running',
    page: params.page ?? 1,
  }),
  adNew: (): Route => ({ name: 'adNew' }),
  ad: (id: string): Route => ({ name: 'ad', id }),
  advertisers: (): Route => ({ name: 'advertisers' }),
  interactions: (params: { tab?: InteractionTab; page?: number } = {}): Route => ({
    name: 'interactions',
    tab: params.tab ?? 'live',
    page: params.page ?? 1,
  }),
  interactionNew: (): Route => ({ name: 'interactionNew' }),
  interaction: (id: string): Route => ({ name: 'interaction', id }),
  sources: (params: { tab?: LicenceTab; page?: number; q?: string } = {}): Route => ({
    name: 'sources',
    tab: params.tab ?? 'all',
    page: params.page ?? 1,
    q: params.q ?? '',
  }),
  sourceNew: (): Route => ({ name: 'sourceNew' }),
  source: (slug: string): Route => ({ name: 'source', slug }),
  published: (params: { tab?: PublishedTab; page?: number } = {}): Route => ({
    name: 'published',
    tab: params.tab ?? 'published',
    page: params.page ?? 1,
  }),
  publishedEdit: (id: string): Route => ({ name: 'publishedEdit', id }),
  leads: (params: { tab?: LeadTab; page?: number } = {}): Route => ({
    name: 'leads',
    tab: params.tab ?? 'new',
    page: params.page ?? 1,
  }),
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

  /*
   * The bare address is the public homepage, not the queue.
   *
   * DEFAULT_ROUTE stays the queue on purpose: it is the fallback for a
   * route that is not understood, and sending a signed-in editor to a
   * marketing page because they followed a stale link would be worse than
   * sending them to their work.
   */
  if (section === '') return Routes.home();
  if (section === 'home') return Routes.home();
  if (section === 'about') return Routes.about();
  if (section === 'contact') return Routes.contact();

  if (section === 'queue') {
    return Routes.queue({
      page: readPage(query),
      perPage: readPerPage(query),
      q: readQuery(query),
    });
  }

  if (section === 'shorts') {
    return Routes.shorts({ tab: readShortsTab(query), page: readPage(query) });
  }

  if (section === 'shorts/new') return Routes.shortNew();

  /* After `shorts/new`, for the same reason `queue/new` precedes a story id.
     One segment, checked before decoding — see the note under queue. */
  if (section.startsWith('shorts/')) {
    const rest = path.slice('shorts/'.length);
    if (rest !== '' && !rest.includes('/')) {
      const id = decodeSegment(rest);
      if (id !== '') return Routes.shortEdit(id);
    }
  }

  if (section === 'sources') {
    return Routes.sources({
      tab: readLicenceTab(query),
      page: readPage(query),
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

  if (section === 'ads') {
    return Routes.ads({ tab: readAdTab(query), page: readPage(query) });
  }
  /* Both before the generic id branch, as `queue/new` is — a campaign can
     never be called "new" or "advertisers", but the order makes that moot. */
  if (section === 'ads/new') return Routes.adNew();
  if (section === 'ads/advertisers') return Routes.advertisers();
  if (section.startsWith('ads/')) {
    const rest = path.slice('ads/'.length);
    if (rest !== '' && !rest.includes('/')) {
      const id = decodeSegment(rest);
      if (id !== '') return Routes.ad(id);
    }
  }

  if (section === 'interactions') {
    return Routes.interactions({ tab: readInteractionTab(query), page: readPage(query) });
  }
  /* Before the id branch, as `ads/new` is. */
  if (section === 'interactions/new') return Routes.interactionNew();
  if (section.startsWith('interactions/')) {
    const rest = path.slice('interactions/'.length);
    if (rest !== '' && !rest.includes('/')) {
      const id = decodeSegment(rest);
      if (id !== '') return Routes.interaction(id);
    }
  }

  if (section === 'published') {
    return Routes.published({ tab: readPublishedTab(query), page: readPage(query) });
  }

  if (section.startsWith('published/')) {
    /* #/published/<id> is the correction screen for one live story. It sits
       under the list rather than at #/queue/<id>, because the composer is
       where drafts are written and this is where live stories are corrected
       — two screens with different rules, and the URL should say which.
       One segment, checked before decoding, for the reason given under queue. */
    const rest = path.slice('published/'.length);
    if (rest !== '' && !rest.includes('/')) {
      const id = decodeSegment(rest);
      if (id !== '') return Routes.publishedEdit(id);
    }
  }

  if (section === 'leads') {
    return Routes.leads({
      tab: readLeadTab(query),
      page: readPage(query),
    });
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
    case 'home':
      return '#/';
    case 'about':
      return '#/about';
    case 'contact':
      return '#/contact';
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
        tab: route.tab === 'library' ? null : route.tab,
        page: route.page === 1 ? null : String(route.page),
      });
    case 'shortNew':
      return '#/shorts/new';
    case 'shortEdit':
      return `#/shorts/${encodeURIComponent(route.id)}`;
    case 'sources':
      return withQuery('#/sources', {
        tab: route.tab === 'all' ? null : route.tab,
        q: route.q === '' ? null : route.q,
        page: route.page === 1 ? null : String(route.page),
      });
    case 'sourceNew':
      return '#/sources/new';
    case 'source':
      return `#/sources/${encodeURIComponent(route.slug)}`;
    case 'publishedEdit':
      return `#/published/${encodeURIComponent(route.id)}`;
    case 'ads':
      return withQuery('#/ads', {
        tab: route.tab === 'running' ? null : route.tab,
        page: route.page === 1 ? null : String(route.page),
      });
    case 'adNew':
      return '#/ads/new';
    case 'ad':
      return `#/ads/${encodeURIComponent(route.id)}`;
    case 'advertisers':
      return '#/ads/advertisers';
    case 'interactions':
      return withQuery('#/interactions', {
        tab: route.tab === 'live' ? null : route.tab,
        page: route.page === 1 ? null : String(route.page),
      });
    case 'interactionNew':
      return '#/interactions/new';
    case 'interaction':
      return `#/interactions/${encodeURIComponent(route.id)}`;
    case 'published':
      return withQuery('#/published', {
        tab: route.tab === 'published' ? null : route.tab,
        page: route.page === 1 ? null : String(route.page),
      });
    case 'leads':
      return withQuery('#/leads', {
        tab: route.tab === 'new' ? null : route.tab,
        page: route.page === 1 ? null : String(route.page),
      });
    case 'notifications':
      return withQuery('#/notifications', {
        tab: route.tab === 'compose' ? null : route.tab,
      });
  }
}

/** Which rail item should light up. */
/** Does this render without asking who is looking at it? */
export function isPublicRoute(route: Route): boolean {
  return (PUBLIC_ROUTES as readonly string[]).includes(route.name);
}

export function sectionOf(route: Route): Section {
  switch (route.name) {
    /* Not in the rail at all — the rail belongs to the signed-in
       application, and these render outside it. */
    case 'home':
    case 'about':
    case 'contact':
      return 'queue';
    case 'queue':
    case 'new':
    case 'article':
      return 'queue';
    case 'shorts':
    case 'shortNew':
    case 'shortEdit':
      return 'shorts';
    case 'sources':
    case 'sourceNew':
    case 'source':
      return 'sources';
    case 'published':
    case 'publishedEdit':
      return 'published';
    case 'ads':
    case 'adNew':
    case 'ad':
    case 'advertisers':
      return 'ads';
    case 'interactions':
    case 'interactionNew':
    case 'interaction':
      return 'interactions';
    case 'leads':
      return 'leads';
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
    case 'home':
    case 'about':
    case 'contact':
      return route.name;
    case 'queue':
      return 'queue';
    case 'new':
      return 'new';
    case 'article':
      return `article:${route.id}`;
    case 'shorts':
      return `shorts:${route.tab}`;
    case 'shortNew':
      return 'shortNew';
    case 'shortEdit':
      return `shortEdit:${route.id}`;
    case 'sources':
      return 'sources';
    case 'sourceNew':
      return 'sourceNew';
    case 'source':
      return `source:${route.slug}`;
    /* The tab, not the page. Paging must not read as arriving somewhere new:
       the scroll reset and the focus move belong to changing tab. */
    case 'published':
      return `published:${route.tab}`;
    case 'publishedEdit':
      return `publishedEdit:${route.id}`;
    case 'ads':
      return `ads:${route.tab}`;
    case 'adNew':
      return 'adNew';
    case 'ad':
      return `ad:${route.id}`;
    case 'advertisers':
      return 'advertisers';
    case 'interactions':
      return `interactions:${route.tab}`;
    case 'interactionNew':
      return 'interactionNew';
    case 'interaction':
      return `interaction:${route.id}`;
    case 'leads':
      return `leads:${route.tab}`;
    case 'notifications':
      return 'notifications';
  }
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

function readAdTab(query: URLSearchParams): AdTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return AD_TABS.find((tab) => tab === raw) ?? 'running';
}

function readInteractionTab(query: URLSearchParams): InteractionTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return INTERACTION_TABS.find((tab) => tab === raw) ?? 'live';
}

function readPublishedTab(query: URLSearchParams): PublishedTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return PUBLISHED_TABS.find((tab) => tab === raw) ?? 'published';
}

function readShortsTab(query: URLSearchParams): ShortsTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return SHORTS_TABS.find((tab) => tab === raw) ?? 'library';
}

function readLeadTab(query: URLSearchParams): LeadTab {
  const raw = (query.get('tab') ?? '').toLowerCase();
  return LEAD_TABS.find((tab) => tab === raw) ?? 'new';
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
