import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE, type Card } from '../api/client';

/**
 * Two things the app was not doing, both of which left us blind.
 *
 * ── Crash reports ───────────────────────────────────────────────────────────
 * A crash showed the reader an error boundary and told us nothing. On the
 * entry-level Android this app targets, that means faults we cannot reproduce
 * and hear about weeks later from a store rating, without a stack.
 *
 * ── Read events ─────────────────────────────────────────────────────────────
 * POST /v1/events was implemented, indexed and rate-limited on the server, and
 * the app never called it. Nothing could answer "which stories are read to the
 * end", "which section is dead" or "did that notification work" — so every
 * editorial decision was being made blind, and the analytics the product sells
 * had no data to display.
 *
 * ── What is sent, and what is not ───────────────────────────────────────────
 * An article id, how long it was on screen, whether the reader opened the
 * publisher, and the app's own random install id. No advertising identifier, no
 * profile, nothing the reader typed, and no location. This is the same standard
 * the advertising measurement already holds itself to, and it is what lets the
 * store privacy disclosure stay short and true.
 *
 * Delivery is best-effort and batched. On a metered connection, telemetry must
 * never cost the reader more than the content does — a dropped batch is a
 * rounding error in a statistic, and a retry queue that grows is not.
 */

const FLUSH_INTERVAL_MS = 25_000;
const MAX_BATCH = 40;
const APP_VERSION = String(Constants.expoConfig?.version ?? '0.0.0');
const PLATFORM = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

let deviceId: string | null = null;

export function setTelemetryDeviceId(id: string | null): void {
  deviceId = id;
}

/* ── read events ────────────────────────────────────────────────────────── */

interface ReadEvent {
  articleId: string;
  categorySlug: string;
  language: string;
  dwellMs: number;
  /** True when the reader reached the end of the summary rather than passing by. */
  completed: boolean;
  openedPublisher: boolean;
  occurredAt: string;
}

let queue: ReadEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

/** Cards already reported, so scrolling back up is not a second read. */
const reported = new Set<string>();

function ensureTimer(): void {
  if (!timer) timer = setInterval(() => void flushEvents(), FLUSH_INTERVAL_MS);
}

/**
 * A card left the screen after having been on it.
 *
 * `dwellMs` is measured, not assumed. A card flicked past at speed and a card
 * read to the end are both worth knowing about and are not the same event, so
 * the distinction is recorded rather than filtered out here — the server decides
 * what counts as a read.
 */
export function noteRead(card: Card, dwellMs: number, openedPublisher = false): void {
  if (reported.has(card.id)) return;
  reported.add(card.id);
  queue.push({
    articleId: card.id,
    categorySlug: card.category.slug,
    language: card.language,
    dwellMs: Math.min(Math.round(dwellMs), 120_000),
    // Two seconds is roughly the floor for having read sixty words; below it
    // the card was passed, not read.
    completed: dwellMs >= 2000,
    openedPublisher,
    occurredAt: new Date().toISOString(),
  });
  ensureTimer();
}

/** The reader tapped through to the publisher — the strongest engagement signal
 *  the feed produces, and the number a publisher will ask for. */
export function notePublisherOpen(card: Card): void {
  queue.push({
    articleId: card.id,
    categorySlug: card.category.slug,
    language: card.language,
    dwellMs: 0,
    completed: true,
    openedPublisher: true,
    occurredAt: new Date().toISOString(),
  });
  void flushEvents();
}

export async function flushEvents(): Promise<void> {
  if (queue.length === 0 || !deviceId) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  try {
    await fetch(`${API_BASE}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, events: batch }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Dropped on purpose. See the note at the top of this file.
  }
}

/* ── error reports ──────────────────────────────────────────────────────── */

/** Faults already sent this session, so a render loop does not become a
 *  network loop on top of it. */
const sentErrors = new Set<string>();

export function reportError(error: unknown, context?: string, fatal = false): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${context ?? '-'}:${err.message}`.slice(0, 220);
  if (sentErrors.has(key)) return;
  sentErrors.add(key);

  const body = {
    message: err.message.slice(0, 500),
    stack: err.stack?.slice(0, 8000),
    context,
    fatal,
    platform: PLATFORM,
    osVersion: String(Platform.Version ?? ''),
    appVersion: APP_VERSION,
    ...(deviceId ? { deviceId } : {}),
    occurredAt: new Date().toISOString(),
  };

  // Sent immediately, not batched: the app may be about to die, and a fatal
  // error held in a queue for twenty-five seconds is a fatal error nobody
  // hears about.
  void fetch(`${API_BASE}/v1/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  }).catch(() => undefined);
}

/**
 * Catch what never reaches a React error boundary.
 *
 * A boundary only sees errors thrown while rendering. A rejected promise in an
 * effect, a callback that throws, a native module failing on a background
 * thread — all of those bypass it entirely, and between them they are most of
 * what actually breaks in production.
 */
export function installGlobalErrorHandlers(): void {
  const g = globalThis as {
    ErrorUtils?: {
      getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
  };

  const previous = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((e: unknown, isFatal?: boolean) => {
    reportError(e, 'global', Boolean(isFatal));
    // Chained, never replaced: React Native's own handler is what shows the
    // red box in development, and swallowing it would make debugging worse in
    // exchange for a report nobody is reading yet.
    previous?.(e, isFatal);
  });
}

/** Test seam — this module holds process-wide state by design. */
export function __resetTelemetry(): void {
  queue = [];
  reported.clear();
  sentErrors.clear();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
