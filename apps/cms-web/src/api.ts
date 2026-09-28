/**
 * CMS API client.
 *
 * Every request carries credentials (the session cookie) and the CSRF header the
 * server requires on state-changing calls. Errors are normalised so components
 * can show `e.message` without unwrapping the envelope each time.
 */

const BASE = import.meta.env.VITE_CMS_API ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message);
  }
}

/**
 * Was this rejection a cancelled request rather than a failed one?
 *
 * A component that navigates away aborts what it had in flight, and fetch
 * rejects with an AbortError. That is this application tidying up, not the
 * server refusing — reporting it as "cannot reach the CMS server" would put a
 * red banner on screen every time an editor changed their mind quickly.
 *
 * Checked by name rather than `instanceof DOMException`, because not every
 * runtime that implements AbortController throws a DOMException.
 */
export function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // The server rejects state-changing requests without this. A browser
        // will not add it on a cross-site form post, which is what makes it a
        // CSRF defence.
        'X-Requested-With': 'newscard-cms',
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    // A cancellation is passed through untouched so the caller can recognise
    // and ignore it; see isAbort above.
    if (isAbort(e)) throw e;
    // Distinguish "server unreachable" from "server said no" — the fixes are
    // completely different and the message should say which.
    throw new ApiError('Cannot reach the CMS server. Is it running?', 'NETWORK', 0, null);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(
      e?.message ?? `Request failed (${res.status})`,
      e?.code ?? 'UNKNOWN',
      res.status,
      e?.details ?? null,
    );
  }
  return body as T;
}

/**
 * Multipart upload.
 *
 * A sibling of req() rather than an option on it, because the difference is not
 * a flag: the browser must set Content-Type itself so it can include the
 * multipart boundary, and req() always sends application/json. Setting it by
 * hand produces a request the server cannot parse and an error that says
 * nothing useful.
 */
async function upload<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: { 'X-Requested-With': 'newscard-cms' },
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError('Cannot reach the CMS server. Is it running?', 'NETWORK', 0, null);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(
      e?.message ?? `Upload failed (${res.status})`,
      e?.code ?? 'UNKNOWN',
      res.status,
      e?.details ?? null,
    );
  }
  return body as T;
}

export type ImageLicence = 'publisher_licensed' | 'agency' | 'cc_by' | 'own';

export interface ArticleImageData {
  credit: string;
  licence: ImageLicence;
  blurHash: string | null;
  width: number | null;
  height: number | null;
  urls: { sm: string | null; md: string | null; lg: string | null };
}

export interface ShortItem {
  id: string;
  slug: string;
  status: 'draft' | 'published' | 'retracted';
  language: 'ne' | 'en';
  title: string;
  caption: string;
  durationSeconds: number;
  posterUrl: string;
  credit: string;
  sourceName: string;
  categorySlug: string;
  publishedAt: string | null;
  createdAt: string;
  /** The last change to a LIVE short. Edits to a draft do not set it. */
  lastEditedAt: string | null;
  lastEditReason: string | null;
  retractionReason: string | null;
}

/** One short, with everything the edit screen needs. */
export interface ShortDetail {
  id: string;
  slug: string;
  status: 'draft' | 'published' | 'retracted';
  language: 'ne' | 'en';
  title: string;
  caption: string;
  credit: string;
  licence: ImageLicence;
  durationSeconds: number;
  posterUrl: string;
  posterBlurHash: string | null;
  renditions: UploadedVideo['renditions'];
  sourceName: string;
  categorySlug: string;
  publishedAt: string | null;
  createdAt: string | null;
  retractedAt: string | null;
  retractionReason: string | null;
  lastEditedAt: string | null;
  lastEditReason: string | null;
}

/** What the transcoder returns: three renditions the player chooses between. */
export interface UploadedVideo {
  key: string;
  durationSeconds: number;
  posterUrl: string;
  posterBlurHash: string;
  credit: string;
  renditions: Array<{
    quality: 'low' | 'medium' | 'high';
    url: string;
    width: number;
    height: number;
    bytes: number;
  }>;
}

export interface Staff {
  staffId: string;
  email: string;
  role: 'author' | 'reviewer' | 'admin';
  languages: string[];
}

export interface Limits {
  limitType: 'words' | 'graphemes';
  limits: { ne: { min: number; max: number }; en: { min: number; max: number } };
  headlineMaxChars: number;
  pullQuoteMaxChars: number;
}

export interface QueueItem {
  id: string;
  status: string;
  language: 'ne' | 'en';
  headline: string;
  sourceName: string;
  categorySlug: string;
  createdAt: string;
  measured: number;
  possibleDuplicate: boolean;
  possibleLanguageMismatch: boolean;
  clusterId: string | null;
}

export interface ArticleDetail {
  id: string;
  status: string;
  language: 'ne' | 'en';
  headline: string;
  summary: string;
  pullQuote: string | null;
  categorySlug: string;
  sourceName: string;
  publisherUrl: string;
  publisherAuthor: string | null;
  editorialNotes: string | null;
  revisionCount: number;
  measured: number;
  image: ArticleImageData | null;
  publishedAt: string | null;
  retractedAt: string | null;
  retractionReason: string | null;
  /** The last correction to a LIVE story. Autosaves to a draft never set it. */
  lastEditedAt: string | null;
  lastEditReason: string | null;
}

export interface ClusterSibling {
  id: string;
  headline: string;
  sourceName: string;
  language: string;
}

/**
 * A story the collector found, waiting for an editor to judge it.
 *
 * `feedExtract` and `feedImageUrl` are the publisher’s own words and their
 * own image, held for triage and never rendered to a reader. The image is
 * referenced on their server and never copied to ours.
 */
export interface LeadRow {
  id: string;
  sourceSlug: string;
  sourceName: string;
  canonicalUrl: string;
  headline: string;
  feedExtract: string | null;
  feedImageUrl: string | null;
  language: 'ne' | 'en';
  publishedAt: string | null;
  fetchedAt: string;
  status: 'new' | 'promoted' | 'dismissed';
  promotedArticleId: string | null;
  dismissedReason: string | null;
}

/** A story a reader can see, or one that was withdrawn. */
export interface PublishedRow {
  id: string;
  slug: string;
  status: 'published' | 'retracted';
  language: 'ne' | 'en';
  headline: string;
  sourceName: string;
  categorySlug: string;
  categoryLabel: { ne: string; en: string };
  publisherUrl: string;
  publishedAt: string | null;
  retractionReason: string | null;
  retractedAt: string | null;
  lastEditedAt: string | null;
  lastEditReason: string | null;
  hasImage: boolean;
}

export interface LeadCounts {
  new: number;
  promoted: number;
  dismissed: number;
}

/**
 * The publisher's own story, for a draft that came from a lead.
 *
 * Served from the lead rather than the article, so it never enters the
 * `articles` collection and expires on the lead’s own clock. Null for a
 * hand-written story, which has no original to show.
 */
export interface OriginalStory {
  headline: string;
  text: string | null;
  url: string;
}

export interface NewStoryOptions {
  categories: Array<{ slug: string; label: { ne: string; en: string } }>;
  sources: Array<{ slug: string; displayName: string; language: string; licensed: boolean }>;
}


export interface NotifyTargets {
  articles: Array<{
    id: string;
    slug: string;
    headline: string;
    language: 'ne' | 'en';
    categorySlug: string;
    publishedAt: string | null;
  }>;
  devices: { total: number; withToken: number; notifEnabled: number };
  /** Surfaced before the editor writes anything: during quiet hours a send is
   *  mostly suppressed, and finding that out afterwards wastes the copy. */
  quietHours: { active: boolean; opensAt: string | null };
}

export interface DispatchReport {
  notificationId: string;
  type: string;
  devices: number;
  noToken: number;
  attempted: number;
  accepted: number;
  suppressed: number;
  bySuppression: Record<string, number>;
  unregistered: number;
  failed: Array<{ deviceId: string; message: string }>;
  heldForQuietHours: number;
  quietHoursUntil: string | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: { ne: string; en: string };
  deepLink: string;
  audience: { languages: string[]; categories: string[] };
  sentAt: string | null;
  stats: { attempted: number; delivered: number; suppressed: number };
  /** Null until push receipts have been reconciled; until then `delivered`
   *  means accepted for delivery, which is not the same thing. */
  receiptsCheckedAt: string | null;
  createdAt: string;
}

export interface Localised {
  ne: string;
  en: string;
}

export type LicenceStatus = 'agreed' | 'pending' | 'refused' | 'unknown';
export type IngestMethod = 'rss' | 'api' | 'manual';

export interface SourceLicenceData {
  status: LicenceStatus;
  agreementRef: string | null;
  /** ISO-8601. The date we held an agreement is kept even after it lapses. */
  agreedAt: string | null;
  /** Where a takedown demand goes. Required once the status is `agreed`. */
  contactEmail: string | null;
}

export interface SourceIngestData {
  method: IngestMethod;
  feedUrl: string | null;
  pollIntervalMin: number;
  /** Written by the poller, which does not exist yet — null on every row today. */
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface SourceRow {
  slug: string;
  displayName: string;
  homepageUrl: string;
  logoUrl: string | null;
  language: 'ne' | 'en';
  priority: number;
  isActive: boolean;
  licence: SourceLicenceData;
  ingest: SourceIngestData;
  /** The server's own `isPollable()` answer, so the UI does not restate it. */
  pollable: boolean;
}

export interface SourceDetail extends SourceRow {
  /** What is filed against this publisher. Read before withdrawing a licence. */
  articles: { published: number; total: number };
}

export interface SourceInput {
  slug: string;
  displayName: string;
  homepageUrl: string;
  logoUrl?: string | null;
  language: 'ne' | 'en';
  ingest: { method: IngestMethod; feedUrl?: string | null; pollIntervalMin: number };
  priority: number;
  isActive: boolean;
}

export interface SourcePatch {
  displayName?: string;
  homepageUrl?: string;
  logoUrl?: string | null;
  language?: 'ne' | 'en';
  ingest?: { method?: IngestMethod; feedUrl?: string | null; pollIntervalMin?: number };
  priority?: number;
  isActive?: boolean;
}

export interface LicenceResult {
  licence: SourceLicenceData;
  publishedArticles: number;
  wasDowngraded: boolean;
}

/*
 * The read methods take an optional AbortSignal; the write methods do not.
 *
 * That asymmetry is the point rather than an omission. A read is worth
 * cancelling — leaving a screen makes its data irrelevant, and a stale response
 * landing after a newer one is an actual defect. A write is not: aborting a
 * PATCH cancels the browser's wait, not the server's work, so the save may well
 * have happened and the application would have no idea. The right thing for an
 * in-flight write is to let it finish and ignore the result.
 */
export const api = {
  me: (signal?: AbortSignal) => req<{ staff: Staff }>('/auth/me', { signal }),

  /** Sections and publishers a new story can be filed against. */
  options: (signal?: AbortSignal) => req<NewStoryOptions>('/cms/options', { signal }),

  /** Create a draft. Returns its id so the composer can open it immediately. */
  create: (body: {
    language: 'ne' | 'en';
    categorySlug: string;
    sourceSlug: string;
    headline?: string;
  }) => req<{ id: string }>('/cms/articles', { method: 'POST', body: JSON.stringify(body) }),
  login: (email: string, password: string) =>
    req<{ staff: unknown }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),

  queue: (signal?: AbortSignal) =>
    req<{ limits: Limits; items: QueueItem[] }>('/cms/queue', { signal }),

  article: (id: string, signal?: AbortSignal) =>
    req<{
      limits: Limits;
      article: ArticleDetail;
      cluster: ClusterSibling[];
      original: OriginalStory | null;
    }>(
      `/cms/articles/${encodeURIComponent(id)}`,
      { signal },
    ),

  save: (
    id: string,
    patch: {
      headline?: string;
      summary?: string;
      pullQuote?: string | null;
      /** null removes the image, which is how an editor changes their mind. */
      image?: ArticleImageData | null;
    },
  ) =>
    req<{ ok: true; savedAt: string }>(`/cms/articles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  transition: (id: string, to: string, note?: string) =>
    req<{ status: string }>(`/cms/articles/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to, note }),
    }),

  /** Pull a live story. The reason is required and is kept. */
  retractArticle: (id: string, reason: string) =>
    req<{ ok: true }>(`/cms/articles/${id}/retract`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  /**
   * Correct a live story in place.
   *
   * Deliberately not `save`: that is the draft autosave and records nothing.
   * This sends the whole text at once with a reason, and the server stamps
   * the time and keeps the before and after.
   */
  editPublished: (
    id: string,
    body: {
      headline: string;
      summary: string;
      image?: ArticleImageData | null;
      reason: string;
    },
  ) =>
    req<{ ok: true; lastEditedAt: string }>(
      `/cms/articles/${id}/edit`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  publish: (id: string) =>
    req<{ status: string; publishedAt: string | null; selfApproved: boolean }>(
      `/cms/articles/${id}/publish`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  /**
   * Upload a photograph and get back the three renditions.
   *
   * It does NOT attach them to the article — the composer holds the result and
   * saves it, so an upload the editor then abandons leaves an orphaned key
   * rather than a half-edited story.
   */
  uploadImage: (file: File, credit: string, licence: ImageLicence) => {
    const form = new FormData();
    form.append('file', file);
    form.append('credit', credit);
    form.append('licence', licence);
    return upload<{ image: ArticleImageData }>('/cms/media/image', form);
  },

  uploadVideo: (file: File, credit: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('credit', credit);
    return upload<{ video: UploadedVideo }>('/cms/media/video', form);
  },

  shorts: (signal?: AbortSignal) => req<{ items: ShortItem[] }>('/cms/shorts', { signal }),

  createShort: (body: {
    language: 'ne' | 'en';
    categorySlug: string;
    sourceSlug: string;
    title: string;
    caption: string;
    credit: string;
    licence: ImageLicence;
    durationSeconds: number;
    posterUrl: string;
    posterBlurHash: string;
    renditions: UploadedVideo['renditions'];
  }) => req<{ id: string }>('/cms/shorts', { method: 'POST', body: JSON.stringify(body) }),

  publishShort: (id: string) =>
    req<{ status: string; publishedAt: string }>(`/cms/shorts/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** A reason is required: a withdrawal is final, and is kept on the record. */
  retractShort: (id: string, reason: string) =>
    req<{ status: string }>(`/cms/shorts/${id}/retract`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  short: (id: string, signal?: AbortSignal) =>
    req<{ short: ShortDetail }>(`/cms/shorts/${encodeURIComponent(id)}`, { signal }),

  /**
   * Save changes to a short. `clip` only when the video was replaced;
   * `reason` is required by the server when the short is live.
   */
  editShort: (
    id: string,
    body: {
      language: 'ne' | 'en';
      categorySlug: string;
      title: string;
      caption: string;
      credit: string;
      licence: ImageLicence;
      clip?: {
        durationSeconds: number;
        posterUrl: string;
        posterBlurHash: string;
        renditions: UploadedVideo['renditions'];
      };
      reason?: string;
    },
  ) =>
    req<{ ok: true; lastEditedAt: string | null }>(`/cms/shorts/${id}/edit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* ---------------------------------------------------------- publishers */

  published: (status: string, page: number, perPage: number, signal?: AbortSignal) =>
    req<{
      items: PublishedRow[];
      total: number;
      counts: { published: number; retracted: number };
    }>(
      `/cms/published?status=${encodeURIComponent(status)}&page=${page}&perPage=${perPage}`,
      { signal },
    ),

  /* ------------------------------------------------------------- leads */

  /** Paged on the server — see the note on the route; `dismissed` grows. */
  leads: (status: string, page: number, perPage: number, signal?: AbortSignal) =>
    req<{ items: LeadRow[]; total: number; counts: LeadCounts }>(
      `/cms/leads?status=${encodeURIComponent(status)}&page=${page}&perPage=${perPage}`,
      { signal },
    ),

  /** Returns the id of the draft it created, which is where the editor goes. */
  promoteLead: (id: string, categorySlug: string) =>
    req<{ articleId: string }>(`/cms/leads/${encodeURIComponent(id)}/promote`, {
      method: 'POST',
      body: JSON.stringify({ categorySlug }),
    }),

  dismissLead: (id: string, reason: string) =>
    req<{ status: string }>(`/cms/leads/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  sources: (signal?: AbortSignal) => req<{ items: SourceRow[] }>('/cms/sources', { signal }),

  source: (slug: string, signal?: AbortSignal) =>
    req<{ source: SourceDetail }>(`/cms/sources/${encodeURIComponent(slug)}`, { signal }),

  /** Creates a publisher. The licence is NOT settable here — see the route. */
  createSource: (body: SourceInput) =>
    req<{ slug: string }>('/cms/sources', { method: 'POST', body: JSON.stringify(body) }),

  saveSource: (slug: string, patch: SourcePatch) =>
    req<{ ok: true }>(`/cms/sources/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /**
   * The legal gate, on its own endpoint under its own permission.
   *
   * `note` is required by the server when the licence LEAVES `agreed`: granting
   * one is evidenced by the agreement reference, withdrawing one is evidenced
   * by nothing unless we ask.
   */
  setSourceLicence: (
    slug: string,
    body: {
      status: LicenceStatus;
      agreementRef?: string | null;
      agreedAt?: string | null;
      contactEmail?: string | null;
      note?: string;
    },
  ) =>
    req<LicenceResult>(`/cms/sources/${encodeURIComponent(slug)}/licence`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  notifyTargets: (signal?: AbortSignal) =>
    req<NotifyTargets>('/cms/notifications/targets', { signal }),

  notifyHistory: (signal?: AbortSignal) =>
    req<{ items: NotificationRow[] }>('/cms/notifications', { signal }),

  notifySend: (body: {
    type: string;
    articleId: string | null;
    title: Localised;
    body: Localised;
    audience: { languages: string[]; categories: string[] };
  }) =>
    req<{ id: string; report: DispatchReport }>('/cms/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** One handset, named explicitly. Bypasses the send gate — see the route. */
  notifyTest: (body: { deviceId: string; title: string; body: string; deepLink?: string }) =>
    req<{ ok: true; accepted: number }>('/cms/notifications/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
