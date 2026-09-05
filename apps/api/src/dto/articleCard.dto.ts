import type { ArticleDoc } from '@newscard/db';
import type { ArticleCardDto } from '@newscard/schemas';

/**
 * Map a stored article to the public card.  Spec Ch. 6.3.
 *
 * Fields are PICKED explicitly. Never serialise the document and delete unwanted
 * keys — a blacklist leaks every new field on the day it is added, and
 * `editorialNotes` would be first. The key set is asserted by a test in
 * @newscard/schemas.
 */
export function toArticleCard(a: ArticleDoc): ArticleCardDto {
  return {
    id: a._id.toString(),
    slug: a.slug,
    language: a.language,
    headline: a.headline,
    summary: a.summary,
    pullQuote: a.pullQuote ?? null,
    category: { slug: a.categorySlug, label: a.categoryLabel },
    source: { name: a.sourceName, logoUrl: a.sourceLogoUrl ?? null },
    author: a.publisherAuthor ?? null,
    originatingAgency: a.originatingAgency ?? null,
    publisherUrl: a.publisherUrl,
    // publishedAt is non-null for anything reaching this mapper, because every
    // feed query filters status: "published". The fallback keeps the DTO total
    // rather than emitting `undefined` into JSON if that ever changes.
    publishedAt: (a.publishedAt ?? a.createdAt).toISOString(),
    sourcePublishedAt: a.publisherPublishedAt ? a.publisherPublishedAt.toISOString() : null,
    image: a.image
      ? {
          credit: a.image.credit,
          blurHash: a.image.blurHash ?? null,
          width: a.image.width ?? null,
          height: a.image.height ?? null,
          urls: {
            sm: a.image.urls.sm ?? null,
            md: a.image.urls.md ?? null,
            lg: a.image.urls.lg ?? null,
          },
        }
      : null,
  };
}
