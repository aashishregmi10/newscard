/**
 * Relative timestamps.  Spec Ch. 7.2.2.
 *
 * Computed from the SOURCE's publication time, not ours. Using our publish time
 * would show "2 minutes ago" for a story the publisher ran six hours earlier,
 * which misleads the reader about how fresh the news is.
 */

type Lang = 'ne' | 'en';

const NE_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

/** Latin digits are near-universal in Nepali news, so this is available but not
 *  used by default (Ch. 11.5). Kept so the choice is easy to revisit. */
export function toDevanagariDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => NE_DIGITS[Number(d)]!);
}

const NE_MONTHS = [
  'जनवरी', 'फेब्रुअरी', 'मार्च', 'अप्रिल', 'मे', 'जुन',
  'जुलाई', 'अगस्ट', 'सेप्टेम्बर', 'अक्टोबर', 'नोभेम्बर', 'डिसेम्बर',
];
const EN_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function relativeTime(when: Date, lang: Lang, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - when.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return lang === 'ne' ? 'भर्खरै' : 'just now';
  if (minutes < 60) {
    return lang === 'ne' ? `${minutes} मिनेट अघि` : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (hours < 24) {
    return lang === 'ne' ? `${hours} घण्टा अघि` : `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (days < 2) return lang === 'ne' ? 'हिजो' : 'yesterday';
  if (days < 7) return lang === 'ne' ? `${days} दिन अघि` : `${days} days ago`;

  const d = when.getDate();
  const m = when.getMonth();
  return lang === 'ne' ? `${d} ${NE_MONTHS[m]}` : `${d} ${EN_MONTHS[m]}`;
}
