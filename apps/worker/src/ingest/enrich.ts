import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { bodyText, politeGet } from './politeGet.js';

/**
 * Reading one story's own page, for a publisher whose feed carries no photo or
 * only part of the story.
 *
 * ── When this runs at all ───────────────────────────────────────────────────
 *
 * Only for a publisher whose licence says `images` or `fullText`, only for a
 * story that is new on this poll, and only for what the feed did not already
 * give us. A publisher on the WordPress API never needs it. It is one request
 * per new story, paced by the caller — the same guest's manners as the feed.
 *
 * ── What it reads ───────────────────────────────────────────────────────────
 *
 *   photo  the page's `og:image` (or `twitter:image`): the picture the
 *          publisher chose to represent the story wherever it is shared.
 *   text   the article, through Mozilla's Readability — the engine behind
 *          Firefox's Reader View — which finds the story among the menus,
 *          related links and comments without a rule per site.
 *
 * Either may come back null. A page that cannot be read leaves the lead
 * exactly as the feed made it; nothing here can lose a story.
 */

/** A story page with its scripts and ads is commonly 200–600 KB. */
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

/** The same cap as `feedContent`, so the lead validator never sees more. */
export const MAX_ARTICLE_CHARS = 20_000;

export interface PageReading {
  imageUrl: string | null;
  text: string | null;
}

function absolute(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pure: a page's HTML to its photo and text. Exported for tests. */
export function readArticleHtml(html: string, pageUrl: string): PageReading {
  const { document } = parseHTML(html);

  const meta = (selector: string): string | null =>
    document.querySelector(selector)?.getAttribute('content') ?? null;
  const imageUrl = absolute(
    meta('meta[property="og:image"]') ??
      meta('meta[name="og:image"]') ??
      meta('meta[name="twitter:image"]') ??
      meta('meta[property="twitter:image"]'),
    pageUrl,
  );

  let text: string | null = null;
  try {
    /* Readability edits the document it is given; this one is ours alone. */
    const article = new Readability(document as unknown as Document).parse();
    const raw = article?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    text = raw.length > 0 ? raw.slice(0, MAX_ARTICLE_CHARS) : null;
  } catch {
    text = null;
  }

  return { imageUrl, text };
}

export async function readArticlePage(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PageReading> {
  const res = await politeGet(url, {
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
    maxBytes: MAX_PAGE_BYTES,
    ...(options.fetchImpl && { fetchImpl: options.fetchImpl }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });
  return readArticleHtml(bodyText(res), res.finalUrl);
}
