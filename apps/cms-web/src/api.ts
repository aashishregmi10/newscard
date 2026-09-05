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

export const api = {
  me: () => req<{ staff: Staff }>('/auth/me'),
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
};
