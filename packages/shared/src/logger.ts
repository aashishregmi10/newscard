/**
 * Structured logging.  Spec Ch. 17.6.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * `LOG_LEVEL` was parsed and validated at boot by a Zod enum, and then never
 * read. Every log line in both servers was `console.log` with interpolated
 * text. Setting `LOG_LEVEL=error` changed nothing.
 *
 * A config key that is validated is a promise. Validating one and ignoring it
 * is worse than not having it, because the validation is what signals that
 * somebody thought about it.
 *
 * The second half of the same problem: a `requestId` is attached to every
 * request and echoed on every response and in the app's diagnostic screen —
 * which is the hard part, and it was done — but free text cannot be filtered
 * or searched by it. The id existed and nothing could use it.
 *
 * ── Why JSON, and why no dependency ─────────────────────────────────────────
 *
 * One line per event, machine-readable, so a request id is a field rather than
 * a substring somebody greps for. A logging library would add configuration,
 * transports and a dependency to do what thirty lines do here; when this needs
 * sampling or a remote sink, that is the moment to reach for one.
 *
 * Development prints a readable line instead, because JSON in a terminal you
 * are watching is worse than text, and the failure this replaces was partly
 * that nobody wanted to read the output.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that stamps these fields on every line — e.g. a request id. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Which process this is. Two servers write to one place in production. */
  service?: string;
  /** Human-readable single lines instead of JSON. Defaults on outside production. */
  pretty?: boolean;
  /** Injectable for tests. */
  now?: () => Date;
  /** Injectable for tests. */
  write?: (level: LogLevel, line: string) => void;
}

/**
 * An Error does not survive JSON.stringify — `{}` is what you get, which is
 * the least useful possible record of the one event you most want to read.
 */
function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function defaultWrite(level: LogLevel, line: string): void {
  // Warnings and errors to stderr, so a pipeline that only captures one stream
  // still captures the ones that matter.
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const service = opts.service;
  const pretty = opts.pretty ?? process.env.NODE_ENV !== 'production';
  const now = opts.now ?? (() => new Date());
  const write = opts.write ?? defaultWrite;
  const threshold = RANK[level];

  const make = (bound: LogFields): Logger => {
    const emit = (lvl: LogLevel, msg: string, fields?: LogFields): void => {
      if (RANK[lvl] < threshold) return;

      const merged: LogFields = { ...bound, ...fields };
      for (const [k, v] of Object.entries(merged)) merged[k] = serialise(v);

      if (pretty) {
        const extra = Object.entries(merged)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ');
        write(lvl, `${lvl.padEnd(5)} ${msg}${extra ? ' ' + extra : ''}`);
        return;
      }

      write(
        lvl,
        JSON.stringify({
          t: now().toISOString(),
          level: lvl,
          ...(service ? { service } : {}),
          msg,
          ...merged,
        }),
      );
    };

    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      child: (fields) => make({ ...bound, ...fields }),
    };
  };

  return make({});
}
