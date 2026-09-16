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

  save: (id: string, patch: { headline?: string; summary?: string; pullQuote?: string | null }) =>
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
