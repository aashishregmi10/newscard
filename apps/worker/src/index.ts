/**
 * The dispatch worker.
 *
 * It is a library rather than a long-running process today: the CMS calls
 * dispatchNotification directly, so a send is synchronous and the editor sees
 * the real outcome in the response instead of "queued" and a hope.
 *
 * That is the right trade at this size and the wrong one later — a send to a
 * hundred thousand devices cannot sit inside an HTTP request. When that day
 * comes, the change is a queue in front of this function, not a change to it.
 */

export { dispatchNotification, nptDayKey, effectiveSentToday } from './dispatch.js';
export type { DispatchReport, DispatchOptions } from './dispatch.js';
export { sweepDeferred, startDeferredSweep, SWEEP_INTERVAL_MS } from './sweepDeferred.js';
export type { SweepResult } from './sweepDeferred.js';
export {
  reconcileReceipts,
  startReceiptReconciliation,
  RECEIPT_DELAY_MS,
  RECONCILE_INTERVAL_MS,
} from './reconcileReceipts.js';
export type { ReconcileResult } from './reconcileReceipts.js';
export { sendPush, checkReceipts, isValidPushToken } from './push/expoPush.js';
export type { PushTarget, SendOutcome, ReceiptOutcome } from './push/expoPush.js';

/**
 * Ingestion.
 *
 * The collector reads the feeds of publishers we are allowed to read and writes
 * what it finds to `leads`. It never writes an article and never reaches a
 * reader — promoting a lead into a draft is an editor's decision.
 */
export { pollDueSources, startIngestion, AUTO_PAUSE_AFTER_FAILURES } from './ingest/pollSources.js';
export type { PollReport } from './ingest/pollSources.js';
export { fetchFeed, FeedFetchError } from './ingest/fetchFeed.js';
export type { FetchFeedResult, FetchFeedOptions } from './ingest/fetchFeed.js';
export { toLead, detectLanguage, fingerprintOf, MAX_LEAD_AGE_DAYS } from './ingest/toLead.js';
export type { LeadCandidate, SourceContext, RejectReason, ToLeadResult } from './ingest/toLead.js';
