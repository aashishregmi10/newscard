import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isAbort } from '../api';

/**
 * Loading something, once, with the failure modes handled.
 *
 * -- The bug this exists to prevent ------------------------------------------
 *
 * The composer fetched an article in an effect keyed on the id. Open a story,
 * go back, open a different one quickly, and two requests are in flight; if the
 * first resolves second — entirely ordinary, they are separate connections —
 * its response overwrites the newer one and the editor is looking at story A's
 * text under story B's heading. Nothing errors. The autosave then writes A's
 * summary onto B.
 *
 * Every screen here had a hand-rolled version of the same effect and none of
 * them guarded against it.
 *
 * -- How it is prevented -----------------------------------------------------
 *
 * Each load owns an AbortController. Changing the key, or unmounting, aborts
 * the one before it: the request is cancelled at the socket rather than merely
 * ignored, and an aborted load is never allowed to touch state. `isAbort`
 * exists so a cancellation is not mistaken for a network failure and shown to
 * the editor as one.
 *
 * -- Why a key and not a dependency array ------------------------------------
 *
 * A `...deps` spread defeats the exhaustive-deps lint rule, which then cannot
 * check any hook in the file. A single string that names the thing being loaded
 * — `article:64f...`, `queue` — is what the dependency array was standing in
 * for anyway, and it reads better at the call site.
 */

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** True while the first load for the current key is outstanding. */
  loading: boolean;
  /** Re-run the loader for the same key. */
  reload: () => void;
  /** Update what is held, without a round trip. */
  setData: (update: T | ((current: T | null) => T | null)) => void;
}

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  fallbackMessage = 'Could not load this.',
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  /*
   * The loader is captured rather than depended on.
   *
   * Callers write it inline, so it is a new function every render and a
   * dependency on it would re-fetch forever. The key is the identity of the
   * request; the function is just how it is made.
   */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const controller = new AbortController();
    let settled = false;

    setLoading(true);
    setError(null);

    loadRef
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        settled = true;
        setData(value);
        setLoading(false);
      })
      .catch((e: unknown) => {
        /* An abort is this component tidying up after itself, not a failure the
           editor should be told about. */
        if (controller.signal.aborted || isAbort(e)) return;
        settled = true;
        setError(e instanceof ApiError ? e.message : fallbackMessage);
        setLoading(false);
      });

    return () => {
      /* Only abort a request still in flight. Calling abort() after a normal
         resolution is harmless but it makes the signal look cancelled to
         anything still holding it. */
      if (!settled) controller.abort();
    };
  }, [key, attempt, fallbackMessage]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, error, loading, reload, setData };
}
