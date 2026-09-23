/**
 * Reading an RSS or Atom feed.
 *
 * ── Why this is hand-written ────────────────────────────────────────────────
 *
 * A general XML parser is a dependency with a parsing surface far larger than
 * the job: entity expansion, DTDs, namespaces, and the billion-laughs class of
 * attack that comes with them. What is actually needed is a handful of fields
 * out of two well-known formats, from documents we did not author and must not
 * trust. Roughly two hundred lines, no dependency, and nothing here can expand
 * an entity or fetch an external one because none of it is implemented.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 *
 * It is not a conformant XML parser and does not try to be. It does not
 * validate, does not resolve namespaces properly (it matches on local names),
 * and will happily read malformed documents. That is the correct trade for
 * this job: feeds in the wild are frequently malformed, and being strict would
 * mean dropping real stories from real publishers over a stray ampersand.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 *
 * Everything returned is UNTRUSTED TEXT from a third party. HTML is stripped
 * rather than sanitised, because nothing downstream renders it as markup and
 * "sanitised HTML" is a promise that needs keeping forever.
 */

export interface FeedItem {
  title: string;
  link: string;
  /** The feed's own extract, stripped to plain text. Editor-facing only. */
  summary: string | null;
  /** Null when absent or unparseable — a bad date must not lose the story. */
  publishedAt: Date | null;
  imageUrl: string | null;
  /** The publisher's own id for the item, where they gave one. */
  guid: string | null;
}

export interface ParsedFeed {
  title: string | null;
  items: FeedItem[];
}

/** Items past this are ignored. A feed with thousands of entries is a feed we
 *  are being asked to hold in memory, and the recent ones are the point. */
const MAX_ITEMS = 100;

/** Two megabytes of feed is already abnormal; past that something is wrong at
 *  the other end and we should not be the ones to find out how wrong. */
export const MAX_FEED_BYTES = 2 * 1024 * 1024;

/**
 * The five XML entities, and numeric references.
 *
 * Deliberately NOT a general entity table: a feed that uses `&nbsp;` gets a
 * literal `&nbsp;`, which is ugly in an extract and harmless. Supporting named
 * HTML entities means shipping a 2,000-entry table to improve punctuation.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    /* Ampersand last, or `&amp;lt;` would decode twice and produce `<`. */
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  /* Lone surrogates are not characters and throw in String.fromCodePoint. */
  if (code >= 0xd800 && code <= 0xdfff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * HTML to plain text.
 *
 * Stripped, not sanitised. Nothing downstream renders this as markup — the
 * triage list puts it in a text node — so removing tags entirely is both
 * simpler and safer than deciding which ones are acceptable.
 */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      /* Script and style carry content that is not prose; dropping the tags
         alone would leave the CSS in the extract. */
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Contents of the first `<tag>` at any depth, CDATA unwrapped. */
function tagText(xml: string, ...names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i');
    const m = re.exec(xml);
    if (m?.[1] === undefined) continue;
    const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    const text = stripHtml(raw);
    if (text !== '') return text;
  }
  return null;
}

/** An attribute off the first matching tag — `<enclosure url="...">`. */
function tagAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = re.exec(xml);
  return m?.[1] !== undefined ? decodeEntities(m[1]).trim() : null;
}

/**
 * The link.
 *
 * RSS puts it in the element's text; Atom puts it in an `href` attribute and
 * may offer several with different `rel`s, of which `alternate` (or none) is
 * the story and `self` is the feed itself. Getting this wrong points every lead
 * at the feed URL, which looks like the collector working and is not.
 */
function itemLink(xml: string): string | null {
  const alternate = /<(?:\w+:)?link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(xml);
  if (alternate?.[1] !== undefined) return decodeEntities(alternate[1]).trim();

  const bare = /<(?:\w+:)?link\b(?![^>]*\brel\s*=\s*["'](?:self|edit|replies)["'])[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(xml);
  if (bare?.[1] !== undefined) return decodeEntities(bare[1]).trim();

  const text = tagText(xml, 'link');
  return text !== null && text !== '' ? text : null;
}

/**
 * A picture for the item, if the feed offered one.
 *
 * Only ever a URL on the publisher's server. Checked against an image type
 * where the feed declares one, because `<enclosure>` is also how podcasts
 * attach audio and a 40MB mp3 is not a thumbnail.
 */
function itemImage(xml: string): string | null {
  const mediaContent = /<media:content\b[^>]*\burl\s*=\s*["']([^"']+)["'][^>]*>/i.exec(xml);
  if (mediaContent?.[1] !== undefined) return decodeEntities(mediaContent[1]).trim();

  const thumb = tagAttr(xml, 'media:thumbnail', 'url') ?? tagAttr(xml, 'thumbnail', 'url');
  if (thumb !== null) return thumb;

  const enclosureType = tagAttr(xml, 'enclosure', 'type');
  const enclosureUrl = tagAttr(xml, 'enclosure', 'url');
  if (enclosureUrl !== null && (enclosureType === null || enclosureType.startsWith('image/'))) {
    return enclosureUrl;
  }
  return null;
}

/**
 * A date, or null.
 *
 * Feeds carry RFC-822 (RSS) and RFC-3339 (Atom) and, in practice, neither.
 * `Date.parse` handles both common forms; anything it cannot read becomes null
 * rather than an exception or an Invalid Date propagating into a sort.
 */
export function parseFeedDate(raw: string | null): Date | null {
  if (raw === null || raw.trim() === '') return null;
  const ms = Date.parse(raw.trim());
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  /* A feed dated in 1970 or 2190 is a broken clock at the other end, not news. */
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2200) return null;
  return date;
}

/** Split a document into its item elements, RSS `<item>` or Atom `<entry>`. */
function splitItems(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:\w+:)?(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < MAX_ITEMS) {
    if (m[2] !== undefined) out.push(m[2]);
  }
  return out;
}

/**
 * Parse a feed document.
 *
 * Total: a document it cannot make sense of yields an empty item list rather
 * than throwing. A publisher serving an HTML error page instead of their feed
 * is a thing that happens weekly, and it should mark the source as failing —
 * which the caller does by seeing zero items — not crash the poll for every
 * other publisher in the same run.
 */
export function parseFeed(xml: string): ParsedFeed {
  if (typeof xml !== 'string' || xml.trim() === '') return { title: null, items: [] };

  /* The channel/feed title lives outside the items, so it must be read from a
     document with the items removed — otherwise the first item's title wins. */
  const withoutItems = xml.replace(
    /<(?:\w+:)?(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?\1>/gi,
    '',
  );

  const items: FeedItem[] = [];
  for (const block of splitItems(xml)) {
    const title = tagText(block, 'title');
    const link = itemLink(block);
    /* A story with no headline or no link is not a lead — there is nothing to
       show an editor and nowhere for them to go. */
    if (title === null || link === null || link === '') continue;

    items.push({
      title,
      link,
      summary: tagText(block, 'description', 'summary', 'content'),
      publishedAt: parseFeedDate(
        rawTag(block, 'pubDate') ??
          rawTag(block, 'published') ??
          rawTag(block, 'updated') ??
          rawTag(block, 'date'),
      ),
      imageUrl: itemImage(block),
      guid: tagText(block, 'guid', 'id'),
    });
  }

  return { title: tagText(withoutItems, 'title'), items };
}

/** Undecoded contents of a tag — dates must not be HTML-stripped first. */
function rawTag(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i');
  const m = re.exec(xml);
  return m?.[1] !== undefined ? decodeEntities(m[1].trim()) : null;
}
