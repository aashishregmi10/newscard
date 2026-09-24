/**
 * Turning values into words.
 *
 * Pure, with the clock injected, so every branch is reachable from a test —
 * including the ones that need a date in the future, which is not a hypothetical
 * (see below).
 */

/**
 * How long ago, in the shortest form that is still honest.
 *
 * Three things a naive implementation gets wrong, all of which have been seen
 * in a real queue:
 *
 *   - A timestamp the server produced a second or two ahead of this machine's
 *     clock yields a negative difference and renders as "-1m ago". Anything not
 *     yet a minute old is "just now", which covers it.
 *   - `new Date('nonsense')` is an Invalid Date and every arithmetic on it is
 *     NaN, which formats as "NaNm ago". An empty string is better than that.
 *   - Past a few days "312d ago" stops being information. It becomes a date.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A file size an editor can act on.
 *
 * One decimal place at megabyte scale and none below it: "1.4 MB" answers "will
 * this be slow on a phone", and "1434 KB" makes you do arithmetic to answer the
 * same question.
 */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A wall-clock time, for "quiet hours until ...".
 *
 * `toLocaleTimeString` with no options prints seconds, which is a precision
 * nobody needs for a policy that changes on the half hour and which makes the
 * string long enough to wrap.
 */
export function timeOfDay(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A date and time, for an audit trail where the exact moment is the point. */
export function dateTime(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `1 device` / `2 devices`, without a stray "(s)". */
export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A machine token said the way a person would: `cap_reached` to `Cap reached`. */
export function humanise(token: string): string {
  const spaced = token.replace(/[_-]+/g, ' ').trim();
  return spaced === '' ? '' : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A server rejection, with the part that says which field.
 *
 * -- The bug this exists to fix ----------------------------------------------
 *
 * Every failing form in this application showed only the top-level sentence.
 * Saving a licence with a word in the email box produced "Invalid licence
 * values." on screen, while the server had in fact answered precisely:
 *
 *     details.issues = [{ path: "contactEmail", message: "Invalid email" }]
 *
 * That half was dropped and could only be found in the network tab. A message
 * naming no field on a form of eight is a message that sends the person hunting.
 *
 * -- Why the raw field name is good enough -----------------------------------
 *
 * `contactEmail` is not the label on screen, and mapping every server path to
 * its label would mean a table per form, kept in step by hand. The path alone
 * narrows eight fields to one, which is the whole of the difficulty; the field
 * is also marked in red by the form's own validation wherever that exists.
 *
 * The shape is Zod's, flattened by `issuesOf` in the routes. Anything that does
 * not match falls back to the message unchanged, because a malformed error is
 * still an error and swallowing it would be worse than not decorating it.
 */
export function explainFailure(message: string, details: unknown): string {
  if (typeof details !== 'object' || details === null) return message;

  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return message;

  const named = issues
    .map((issue): string | null => {
      if (typeof issue !== 'object' || issue === null) return null;
      const { path, message: detail } = issue as { path?: unknown; message?: unknown };
      if (typeof detail !== 'string' || detail.trim() === '') return null;
      return typeof path === 'string' && path.trim() !== '' ? `${path}: ${detail}` : detail;
    })
    .filter((line): line is string => line !== null);

  return named.length === 0 ? message : `${message} (${named.join('; ')})`;
}
