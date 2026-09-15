import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

    const read = async () => {
      try {
        const s = await Network.getNetworkStateAsync();
        if (cancelled) return;
        setState({
          unmetered:
            s.type === Network.NetworkStateType.WIFI ||
            s.type === Network.NetworkStateType.ETHERNET,
          online: s.isInternetReachable ?? s.isConnected ?? true,
        });
      } catch {
        // A failed read means we do not know, and not knowing means metered.
        if (!cancelled) setState({ unmetered: false, online: true });
      }
    };

    void read();

    // Re-read on foreground rather than subscribing to every change: a reader
    // who walks out of Wi-Fi range usually backgrounds the app on the way, and
    // a polling subscription costs battery for a value that changes rarely.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void read();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <NetworkCtx.Provider value={value}>{children}</NetworkCtx.Provider>;
}

export function useNetwork(): Ctx {
  return useContext(NetworkCtx);
}
