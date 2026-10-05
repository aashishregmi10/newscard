import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { endReaderSession, fetchReaderConfig, startReaderSession } from '../api/client';
import {
  googleSignIn,
  googleSignOut,
  loadSession,
  saveSession,
  signInAvailable,
  type StoredSession,
} from '../lib/googleSignIn';

/**
 * The signed-in reader, if any — for voting and rating, and nothing else.
 *
 * Reading never asks. A reader meets sign-in only by pressing Vote or Submit
 * on an Interaction card, and the vote then goes through on its own once they
 * are in (see InteractionCard). The session survives restarts in the phone's
 * keystore until it expires or they sign out in Settings.
 */

export type SignInOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'not_set_up' | 'failed' };

interface ReaderState {
  /** False on a build without the sign-in module: "update the app to vote". */
  available: boolean;
  /** Restored from the keystore yet? Until then, a card waits rather than guessing. */
  ready: boolean;
  session: StoredSession | null;
  signIn: () => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  /** The server said the session has ended (401): forget it, so the next tap asks again. */
  forget: () => void;
}

const ReaderContext = createContext<ReaderState | null>(null);

export function ReaderProvider({ children }: { children: ReactNode }) {
  const [available] = useState(signInAvailable);
  const [ready, setReady] = useState(!available);
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    void loadSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [available]);

  const signIn = useCallback(async (): Promise<SignInOutcome> => {
    if (!available) return { ok: false, reason: 'unavailable' };
    let webClientId: string | null;
    try {
      webClientId = (await fetchReaderConfig()).googleWebClientId;
    } catch {
      return { ok: false, reason: 'failed' };
    }
    if (webClientId === null) return { ok: false, reason: 'not_set_up' };

    const google = await googleSignIn(webClientId);
    if (!google.ok) {
      if (google.reason !== 'cancelled') console.info('[ReaderContext] Google sign-in:', google.reason, google.detail);
      return { ok: false, reason: google.reason };
    }
    try {
      const s = await startReaderSession(google.idToken);
      const stored = { token: s.token, expiresAt: s.expiresAt, name: google.name };
      await saveSession(stored);
      setSession(stored);
      return { ok: true, token: s.token };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }, [available]);

  const forget = useCallback(() => {
    setSession(null);
    void saveSession(null);
  }, []);

  const signOut = useCallback(async () => {
    const token = session?.token;
    forget();
    await googleSignOut();
    if (token) await endReaderSession(token).catch(() => undefined);
  }, [session, forget]);

  const value = useMemo(
    () => ({ available, ready, session, signIn, signOut, forget }),
    [available, ready, session, signIn, signOut, forget],
  );
  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>;
}

export function useReader(): ReaderState {
  const v = useContext(ReaderContext);
  if (v === null) throw new Error('useReader outside ReaderProvider');
  return v;
}
