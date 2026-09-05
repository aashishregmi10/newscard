import { z } from 'zod';

/** A 24-character hex ObjectId, as a string at the API boundary. */
export const ObjectIdString = z
  .string()
  .regex(/^[0-9a-f]{24}$/, 'must be a 24-character hex ObjectId');

/** Slugs are URL-safe, lowercase, and immutable after publish (Ch. 3.2.1). */
export const Slug = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[a-z0-9-]+$/, 'must be lowercase alphanumeric with hyphens');

/** Publisher URLs must be HTTPS. A plaintext link from a news app is a bad look
 *  and, on some networks in Nepal, an injection vector. */
export const HttpsUrl = z.string().url().startsWith('https://', 'must be an https:// URL');

/** Dates are BSON Date in storage; ISO-8601 with Z on the wire (Ch. 3.1). */
export const IsoDateString = z.string().datetime({ offset: false });

/** Localised text. Both languages are required wherever this is used — we never
 *  send an English string to a Nepali-only device (Ch. 3.9). */
export const LocalisedText = z.object({
  ne: z.string().min(1),
  en: z.string().min(1),
});
export type LocalisedText = z.infer<typeof LocalisedText>;

/** Timestamps present on every document (Ch. 3.1), omitted from field tables. */
export const Timestamps = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
});
