import AsyncStorage from '@react-native-async-storage/async-storage';
import { postAdEvents, type AdCard, type AdEventInput } from '../api/client';

/**
 * Ad measurement on the device.
 *
 * Two things happen here, and they are deliberately in one file because they
 * are the same fact seen from two sides:
 *
 *   1. What the ADVERTISER is told  — impressions, how long each was actually
 *      on screen, and clicks. Reported in aggregate; see adReport.service.ts.
 *   2. What the READER is protected from — the daily ad count, which the next
 *      feed request sends back so the server can stop serving once the cap is
 *      reached. The count lives on the device because the device is the only
 *      thing that knows what was actually rendered.
 *
 * ── The rules this file enforces ────────────────────────────────────────────
 *
 * • ONE impression per ad instance. Scrolling back up past the same card is
 *   not a second impression. Billing a second time for a card the reader
 *   merely scrolled past twice would be quietly overcharging.
 *
 * • Dwell is measured, not assumed. `dwellMs` is real time on screen, and the
 *   server decides from it whether the impression was *viewable* (>= 1s).
 *   An impression the reader flicked past at speed is still reported, and it
 *   is reported as what it was.
 *
 * • Nothing identifies a person. Events carry the app's own random deviceId,
 *   the campaign, the category and a duration. No advertising ID, no profile,
 *   no cross-app anything (spec Ch. 15.2).
 *
 * • Measurement is best-effort. A failed post is dropped, never retried into a
 *   growing queue — on a metered connection, telemetry must not outweigh the
 *   content it measures.
 */

const BUDGET_KEY = 'newscard.adBudget.v1';
const FLUSH_INTERVAL_MS = 20_000;
const MAX_BATCH = 50;

interface AdState {
  campaignId: string;
  categorySlug: string;
  /** Timestamp the ad became visible, or null while it is off screen. */
  since: number | null;
  dwellMs: number;
  reported: boolean;
}

let deviceId: string | null = null;
let queue: AdEventInput[] = [];
const states = new Map<string, AdState>();
let timer: ReturnType<typeof setInterval> | null = null;

/* -------------------------------------------------------------- daily budget */

let budget = { date: '', count: 0 };
let budgetLoaded = false;

/** Local calendar day. The cap is a reader-experience limit, so it has to turn
 *  over at the reader's midnight, not UTC's. */
function today(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function loadAdBudget(): Promise<void> {
  if (budgetLoaded) return;
  budgetLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(BUDGET_KEY);
    const parsed = raw ? (JSON.parse(raw) as { date?: string; count?: number }) : null;
    if (parsed?.date === today() && typeof parsed.count === 'number') {
      budget = { date: parsed.date, count: parsed.count };
      return;
    }
  } catch {
    // A corrupt or missing budget means "none shown yet", which errs towards
    // the reader rather than towards revenue.
  }
  budget = { date: today(), count: 0 };
}

/** Ads shown to this device today. Sent with every feed request. */
export function adsShownToday(): number {
  if (budget.date !== today()) budget = { date: today(), count: 0 };
  return budget.count;
}

function spendOne(): void {
  if (budget.date !== today()) budget = { date: today(), count: 0 };
  budget.count += 1;
  void AsyncStorage.setItem(BUDGET_KEY, JSON.stringify(budget)).catch(() => undefined);
}

/* ------------------------------------------------------------- measurement */

export function setAdDeviceId(id: string | null): void {
  deviceId = id;
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => void flushAdEvents(), FLUSH_INTERVAL_MS);
}

/** The ad scrolled into view. */
export function noteAdVisible(ad: AdCard, categorySlug: string): void {
  const s = states.get(ad.id);
  if (s) {
    if (s.since === null && !s.reported) s.since = Date.now();
    return;
  }
  states.set(ad.id, {
    campaignId: ad.campaignId,
    categorySlug,
    since: Date.now(),
    dwellMs: 0,
    reported: false,
  });
  ensureTimer();
}

/** The ad scrolled out of view — this is where the impression is recorded,
 *  because only now is the dwell known. */
export function noteAdHidden(adId: string): void {
  const s = states.get(adId);
  if (!s) return;
  if (s.since !== null) {
    s.dwellMs += Date.now() - s.since;
    s.since = null;
  }
  report(s);
}

function report(s: AdState): void {
  if (s.reported) return;
  s.reported = true;
  queue.push({
    campaignId: s.campaignId,
    type: 'impression',
    dwellMs: Math.round(s.dwellMs),
    categorySlug: s.categorySlug,
    occurredAt: new Date().toISOString(),
  });
  spendOne();
}

/**
 * The reader tapped the call to action.
 *
 * Flushed immediately rather than queued: the tap opens the landing page, the
 * app goes to the background, and an interval that fires in twenty seconds may
 * never fire at all. A click is the event an advertiser cares most about and
 * the one most likely to be lost.
 */
export function noteAdClick(ad: AdCard, categorySlug: string): void {
  const s = states.get(ad.id);
  const dwell = s ? s.dwellMs + (s.since ? Date.now() - s.since : 0) : 0;
  queue.push({
    campaignId: ad.campaignId,
    type: 'click',
    dwellMs: Math.round(dwell),
    categorySlug,
    occurredAt: new Date().toISOString(),
  });
  void flushAdEvents();
}

/** Send whatever has accumulated. Also closes out any ad still on screen, so
 *  leaving the app mid-card does not lose the impression. */
export async function flushAdEvents(): Promise<void> {
  for (const s of states.values()) {
    if (s.reported || s.since === null) continue;
    s.dwellMs += Date.now() - s.since;
    s.since = null;
    report(s);
  }

  if (queue.length === 0 || !deviceId) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  try {
    await postAdEvents(deviceId, batch);
  } catch {
    // Dropped on purpose. Retrying grows a queue that a reader on a poor
    // connection pays for in data, to fix a number nobody will notice.
  }
}

/** Test seam — the module holds process-wide state by design. */
export function __resetAdTracker(): void {
  queue = [];
  states.clear();
  budget = { date: today(), count: 0 };
  budgetLoaded = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
