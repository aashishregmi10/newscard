import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

/**
 * Is the connection metered?
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Every other decision about video depends on it. On Wi-Fi a short should
 * autoplay, because that is what the format is. On mobile data it must not
 * fetch a byte until the reader taps, because in this market data is bought in
 * small amounts and a feed that silently spends it is a feed people uninstall.
 *
 * ── Why it errs towards metered ─────────────────────────────────────────────
 *
 * The starting value is FALSE — assume metered — and it stays false until the
 * network is positively identified as Wi-Fi or ethernet. Getting this wrong in
 * one direction costs the reader money; in the other it costs them one tap.
 * That is not a close call, so an unknown connection is treated as expensive.
 */

interface Ctx {
  /** True only when the connection is known to be Wi-Fi or ethernet. */
  unmetered: boolean;
  /** False when there is no usable connection at all. */
  online: boolean;
}

const NetworkCtx = createContext<Ctx>({ unmetered: false, online: true });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Ctx>({ unmetered: false, online: true });

  useEffect(() => {
    let cancelled = false;

    const apply = (s: Network.NetworkState) => {
      if (cancelled) return;
      const next: Ctx = {
        unmetered:
          s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET,
        online: s.isInternetReachable ?? s.isConnected ?? true,
      };
      // Only a real change re-renders: every feed on screen reads this.
      setState((prev) =>
        prev.unmetered === next.unmetered && prev.online === next.online ? prev : next,
      );
    };

    const read = async () => {
      try {
        apply(await Network.getNetworkStateAsync());
      } catch {
        // A failed read means we do not know, and not knowing means metered.
        if (!cancelled) setState({ unmetered: false, online: true });
      }
    };

    void read();

    /*
     * Told when the connection changes, while the app is open.
     *
     * This used to be read on foreground only. But a connection that drops
     * and comes back WHILE someone is reading — a lift, a tunnel, a bus — is
     * the common case here, and the feed stayed on its "could not reach the
     * server" copy until they thought to pull down. The OS pushes this event;
     * nothing polls, so it costs nothing while the network is steady.
     */
    let listener: { remove: () => void } | null = null;
    try {
      listener = Network.addNetworkStateListener(apply);
    } catch {
      // A build without the event still has the foreground re-read below.
    }

    // Kept as well: some Android builds do not deliver the event after a long
    // background, and a foreground read is one cheap call.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void read();
    });

    return () => {
      cancelled = true;
      listener?.remove();
      sub.remove();
    };
  }, []);

  return <NetworkCtx.Provider value={state}>{children}</NetworkCtx.Provider>;
}

export function useNetwork(): Ctx {
  return useContext(NetworkCtx);
}
