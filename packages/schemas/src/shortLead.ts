import { z } from 'zod';
import { LanguageEnum, LeadStatusEnum } from './enums.js';
import { ObjectIdString } from './common.js';
import { YouTubeVideoId } from './video.js';

/**
 * The `shortLeads` collection — Shorts found on a licensed publisher's YouTube
 * channel, waiting for an editor.
 *
 * The video equivalent of a lead: a pointer to somebody else's Short, its
 * title, description, thumbnail and length, so an editor can judge it without
 * opening YouTube. Nothing here is shown to a reader. Promoting one makes a
 * short DRAFT that plays the Short through YouTube's player; dismissing one
 * says why.
 *
 * Only what the collector could verify is a Short arrives here: ninety seconds
 * or less (the same cap as an uploaded short), allowed to be embedded by its
 * owner, and taller than it is wide.
 *
 * Expires after a month like a lead, on a date the server sets.
 */

export const SHORT_LEAD_TTL_DAYS = 30;

export const ShortLead = z.object({
  sourceId: ObjectIdString,
  sourceSlug: z.string().min(1),
  sourceName: z.string().min(1),

  videoId: YouTubeVideoId,
  channelId: z.string().min(1),
  channelTitle: z.string(),

  /** THEIR words, for triage. Prefills the draft's title, which the editor edits. */
  title: z.string().min(1).max(300),
  /** THEIR description, for triage and as the source of a drafted caption. */
  description: z.string().max(5000),
  /** On YouTube's image server, shown as their terms allow. */
  thumbnailUrl: z.string().url(),
  durationSeconds: z.number().positive(),

  language: LanguageEnum,
  publishedAt: z.date().nullable(),
  fetchedAt: z.date(),

  status: LeadStatusEnum.default('new'),
  promotedVideoId: ObjectIdString.nullable().optional(),
  dismissedReason: z.string().max(200).nullable().optional(),

  purgeAt: z.date(),
});
export type ShortLead = z.infer<typeof ShortLead>;
