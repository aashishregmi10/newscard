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
  } catch {
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
  } catch {
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
}

export interface ClusterSibling {
  id: string;
  headline: string;
  sourceName: string;
  language: string;
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

export const api = {
  me: () => req<{ staff: Staff }>('/auth/me'),

  /** Sections and publishers a new story can be filed against. */
  options: () => req<NewStoryOptions>('/cms/options'),

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

  queue: () => req<{ limits: Limits; items: QueueItem[] }>('/cms/queue'),

  article: (id: string) =>
    req<{ limits: Limits; article: ArticleDetail; cluster: ClusterSibling[] }>(
      `/cms/articles/${id}`,
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

  shorts: () => req<{ items: ShortItem[] }>('/cms/shorts'),

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

  retractShort: (id: string) =>
    req<{ status: string }>(`/cms/shorts/${id}/retract`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  notifyTargets: () => req<NotifyTargets>('/cms/notifications/targets'),

  notifyHistory: () => req<{ items: NotificationRow[] }>('/cms/notifications'),

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
