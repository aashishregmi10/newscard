import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

/**
 * Running one thing that can fail, and saying so.
 *
 * -- What this replaces ------------------------------------------------------
 *
 * The composer, the shorts screen and the notifications screen each had their
 * own `act()`: set busy, clear the messages, await, set a notice, catch, set an
 * error, clear busy. Three copies of eleven lines, already subtly different —
 * one of them forgot to clear the previous notice, so a failed publish sat
 * underneath the success message from the save before it.
 *
 * -- The two things it gets right that a copy tends not to -------------------
 *
 * It refuses to run twice at once. A disabled button stops most double
 * submissions but not all of them: the click that arrives in the same frame as
 * the first, or a keyboard shortcut firing while the pointer is mid-click. For
 * `publish` that is the difference between one story going out and two.
 *
 * It does not touch state after the component has gone. Navigating away from
 * the composer while a publish is in flight used to set state on an unmounted
 * tree; React 18 stopped warning about it, which made it quieter rather than
 * correct.
 */

export interface AsyncAction {
  busy: boolean;
  error: string | null;
  notice: string | null;
  /**
   * Run `work`, then show `okMessage` if it succeeded. Resolves true on
   * success, so a caller can follow up — refresh a list, close a panel —
   * without repeating the try/catch.
   */
  run: (work: () => Promise<unknown>, okMessage?: string) => Promise<boolean>;
  setError: (message: string | null) => void;
  clear: () => void;
}

export function useAsyncAction(fallbackMessage = 'Something went wrong.'): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mounted = useRef(true);
  /* A ref, not `busy`: state updates are asynchronous, so two clicks in the
     same tick would both read the stale `false` and both proceed. */
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (work: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;

      setBusy(true);
      setError(null);
      setNotice(null);

      try {
        await work();
        if (mounted.current) setNotice(okMessage ?? null);
        return true;
      } catch (e) {
        /* ApiError already carries a message written for an editor. Anything
           else is a bug in this application and must not be shown raw — a
           stack trace in a banner tells a newsroom nothing it can act on. */
        if (mounted.current) setError(e instanceof ApiError ? e.message : fallbackMessage);
        return false;
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [fallbackMessage],
  );

  const clear = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return { busy, error, notice, run, setError, clear };
}
