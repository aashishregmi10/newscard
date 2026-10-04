/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from packages/schemas by `npm run gen:types`, which CI re-runs and
 * compares. Editing this by hand reintroduces exactly the drift it exists to
 * prevent: the server's shape and the app's belief about it diverging silently.
 *
 * To change a shape, change the Zod schema and regenerate.
 */

/** One encoded size of a short video. The CLIENT picks which to play. */
export interface VideoRendition {
  quality: "low" | "medium" | "high";
  url: string;
  width: number;
  height: number;
  bytes: number;
}

/** A story as the feed returns it. Mirrors GET /v1/feed items. */
export interface ArticleCardDto {
  id: string;
  slug: string;
  language: "ne" | "en";
  headline: string;
  summary: string;
  pullQuote: string | null;
  category: {
    slug: string;
    label: {
      ne: string;
      en: string;
    };
  };
  source: {
    name: string;
    logoUrl: string | null;
  };
  author: string | null;
  originatingAgency: string | null;
  publisherUrl: string;
  publishedAt: string;
  sourcePublishedAt: string | null;
  image: {
    credit: string;
    blurHash: string | null;
    width: number | null;
    height: number | null;
    urls: {
      sm: string | null;
      md: string | null;
      lg: string | null;
    };
  } | null;
}

/** A sponsored card. Discriminated from editorial on `kind`. */
export interface AdCardDto {
  kind: "ad";
  id: string;
  campaignId: string;
  language: "ne" | "en";
  advertiser: string;
  headline: string;
  body: string;
  callToAction: {
    ne: string;
    en: string;
  };
  landingUrl: string;
  image: {
    blurHash: string | null;
    urls: {
      sm: string | null;
      md: string | null;
      lg: string | null;
    };
  } | null;
}

/** The small ad carried on a story, beside save and share. On the feed entry, never the card. */
export interface InlineAdDto {
  kind: "inlineAd";
  id: string;
  campaignId: string;
  language: "ne" | "en";
  advertiser: string;
  text: string;
  landingUrl: string;
  logo: {
    blurHash: string | null;
    urls: {
      sm: string | null;
      md: string | null;
      lg: string | null;
    };
  } | null;
}

/** A short, as GET /v1/videos returns it. */
export interface VideoCardDto {
  kind: "video";
  id: string;
  slug: string;
  language: "ne" | "en";
  title: string;
  caption: string;
  durationSeconds: number;
  posterUrl: string;
  posterBlurHash: string | null;
  renditions: VideoRendition[];
  youtubeId: string | null;
  credit: string;
  source: {
    name: string;
  };
  category: {
    slug: string;
    label: {
      ne: string;
      en: string;
    };
  };
  publishedAt: string;
}
