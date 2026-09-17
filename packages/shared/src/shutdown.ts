import type { Server } from 'node:http';

/**
 * Stop accepting connections, then wait for the ones in flight.  Spec Ch. 17.7.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * Both servers did this:
 *
 *   server.close();
 *   await closeDatabase();
 *   process.exit(0);
 *
 * `server.close()` is asynchronous — it stops accepting NEW connections and
 * reports completion through a callback, which nothing awaited. So the database
 * closed and the process exited while requests were still being served. Every
 * one of them died mid-response.
 *
 * On a rolling deploy that is a burst of failed reads for real readers, every
 * deploy, attributed to nothing. It is the classic "deploys cause a blip" that
 * never gets tracked down, because the logs show a clean shutdown: the process
 * did exactly what it was told, and what it was told was wrong.
 *
 * ── Why there is a timeout ──────────────────────────────────────────────────
 *
 * A keep-alive connection that never sends another request would hold the close
 * open indefinitely, and a deploy that hangs is worse than one that drops a
 * straggler. So the drain is bounded: finish properly if we can, give up
 * loudly if we cannot.
 */

export const DRAIN_TIMEOUT_MS = 10_000;

export interface DrainResult {
  drained: boolean;
  waitedMs: number;
}

export async function drainHttpServer(
  server: Pick<Server, 'close' | 'closeIdleConnections'>,
  timeoutMs: number = DRAIN_TIMEOUT_MS,
): Promise<DrainResult> {
  const started = Date.now();

  return new Promise<DrainResult>((resolve) => {
    let settled = false;
    const finish = (drained: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ drained, waitedMs: Date.now() - started });
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    // Do not keep the process alive purely to run out the clock.
    timer.unref?.();

    server.close(() => {
      clearInterval(sweep);
      finish(true);
    });

    /**
     * Keep closing idle connections for as long as the drain runs.
     *
     * Calling this once is not enough, and the difference is measurable: a
     * keep-alive socket is BUSY while its request is being served and becomes
     * IDLE the moment the response goes out. A single call at the start misses
     * it, so the server then waits out Node's five-second keep-alive timeout
     * before close() fires — turning every clean shutdown into a five-second
     * one. Repeating it closes each socket shortly after it finishes.
     *
     * Requests actually in progress are never touched; only idle sockets are.
     */
    server.closeIdleConnections?.();
    const sweep = setInterval(() => server.closeIdleConnections?.(), 100);
    sweep.unref?.();
  });
}
