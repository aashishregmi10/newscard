import { z } from 'zod';
import { LocalisedText } from './common.js';

/** The `categories` collection.  Spec Ch. 3.4. */
export const Category = z.object({
  /** Stable machine name. Never localised, never changed. */
  slug: z.string().min(2).max(32).regex(/^[a-z0-9-]+$/),
  label: LocalisedText,
  /** Sparse integers (10, 20, 30) so a category can be inserted without
   *  renumbering every sibling. */
  order: z.number().int(),
  isActive: z.boolean().default(true),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
});
export type Category = z.infer<typeof Category>;

/**
 * Spec Ch. 3.4.1 — seven categories at launch.
 *
 * `top` is VIRTUAL: it is assembled from articles across all categories that
 * editorial has flagged. An article's own categoryId always points at a concrete
 * category, never at `top`.
 */
export const MVP_CATEGORIES: ReadonlyArray<Category> = [
  { slug: 'top', label: { en: 'Top Stories', ne: 'मुख्य समाचार' }, order: 10, isActive: true },
  { slug: 'nepal', label: { en: 'Nepal', ne: 'नेपाल' }, order: 20, isActive: true },
  { slug: 'politics', label: { en: 'Politics', ne: 'राजनीति' }, order: 30, isActive: true },
  { slug: 'business', label: { en: 'Business', ne: 'अर्थतन्त्र' }, order: 40, isActive: true },
  { slug: 'world', label: { en: 'World', ne: 'विश्व' }, order: 50, isActive: true },
  { slug: 'sports', label: { en: 'Sports', ne: 'खेलकुद' }, order: 60, isActive: true },
  { slug: 'tech', label: { en: 'Technology', ne: 'प्रविधि' }, order: 70, isActive: true },
];

export const VIRTUAL_CATEGORY_SLUGS = ['top', 'all'] as const;
export function isVirtualCategory(slug: string): boolean {
  return (VIRTUAL_CATEGORY_SLUGS as readonly string[]).includes(slug);
}
