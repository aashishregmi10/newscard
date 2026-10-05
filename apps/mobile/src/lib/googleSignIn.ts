import { TurboModuleRegistry } from 'react-native';
import type * as SignInModule from 'react-native-nitro-google-signin';
import type * as SecureStoreModule from 'expo-secure-store';

/**
 * Signing in with Google, and keeping the session — only to vote and rate.
 *
 * ── Two native modules, both loaded lazily ──────────────────────────────────
 *
 * `react-native-nitro-google-signin` (Android's Credential Manager, free —
 * the better-known @react-native-google-signin charges for that part) and
 * `expo-secure-store`. Both arrived with Interactions, so every build made
 * before them lacks their native half, and importing either at module scope
 * would take down the feed that imports this — see apps/mobile/AGENTS.md. So
 * they are required lazily, inside a try, and a build without them reports
 * `available: false`: the card then says to update the app, and reading is
 * untouched.
 *
 * ── What leaves the phone ───────────────────────────────────────────────────
 *
 * Google's ID token, once, to our server, which keeps only an HMAC of the
 * account number. The reader's name and email stay on the phone, for the
 * Settings row that says who is signed in.
 */

type SignIn = typeof SignInModule;
type SecureStore = typeof SecureStoreModule;

let signInModule: SignIn | null | undefined;
let storeModule: SecureStore | null | undefined;

function getSignIn(): SignIn | null {
  if (signInModule !== undefined) return signInModule;
  try {
    /* Ask first: Nitro throws while loading when its native half is missing. */
    signInModule =
      TurboModuleRegistry.get('NitroModules') == null
        ? null
        : (require('react-native-nitro-google-signin') as SignIn);
  } catch {
    signInModule = null;
  }
  if (signInModule === null) {
    console.info('[googleSignIn] Google sign-in is not in this build; voting asks for an update.');
  }
  return signInModule;
}

function getStore(): SecureStore | null {
  if (storeModule !== undefined) return storeModule;
  try {
    storeModule = require('expo-secure-store') as SecureStore;
  } catch {
    storeModule = null;
  }
  return storeModule;
}

/** Can this build sign in at all? */
export function signInAvailable(): boolean {
  return getSignIn() !== null && getStore() !== null;
}

export type GoogleSignInResult =
  | { ok: true; idToken: string; name: string | null }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'not_set_up' | 'failed'; detail: string };

let configuredFor: string | null = null;

/** Google's account chooser, then its ID token. */
export async function googleSignIn(webClientId: string): Promise<GoogleSignInResult> {
  const m = getSignIn();
  if (m === null) return { ok: false, reason: 'unavailable', detail: 'not in this build' };
  try {
    if (configuredFor !== webClientId) {
      m.GoogleOneTapSignIn.configure({ webClientId });
      configuredFor = webClientId;
    }
    await m.GoogleOneTapSignIn.checkPlayServices(true);
    const r = await m.GoogleOneTapSignIn.presentExplicitSignIn();
    if (m.isSuccessResponse(r)) {
      return { ok: true, idToken: r.data.idToken, name: r.data.user.name ?? r.data.user.email ?? null };
    }
    if (m.isCancelledResponse(r)) return { ok: false, reason: 'cancelled', detail: 'cancelled' };
    return { ok: false, reason: 'failed', detail: r.type };
  } catch (e) {
    if (m.isErrorWithCode(e)) {
      if (e.code === m.statusCodes.SIGN_IN_CANCELLED) return { ok: false, reason: 'cancelled', detail: e.code };
      /* Wrong or missing SHA-1, package name or client ID in Google Cloud. */
      if (e.code === m.statusCodes.DEVELOPER_ERROR) return { ok: false, reason: 'not_set_up', detail: e.message };
      return { ok: false, reason: 'failed', detail: `${e.code}: ${e.message}` };
    }
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function googleSignOut(): Promise<void> {
  await getSignIn()
    ?.GoogleOneTapSignIn.signOut()
    .catch(() => undefined);
}

/* ── the session, in the phone's keystore ─────────────────────────────────── */

const SESSION_KEY = 'saar.readerSession.v1';

export interface StoredSession {
  token: string;
  expiresAt: string;
  /** For the Settings row only. Never sent anywhere. */
  name: string | null;
}

export async function loadSession(): Promise<StoredSession | null> {
  const store = getStore();
  if (store === null) return null;
  try {
    const raw = await store.getItemAsync(SESSION_KEY);
    if (raw === null) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (typeof s.token !== 'string' || Date.parse(s.expiresAt) <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export async function saveSession(s: StoredSession | null): Promise<void> {
  const store = getStore();
  if (store === null) return;
  try {
    if (s === null) await store.deleteItemAsync(SESSION_KEY);
    else await store.setItemAsync(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* A session that could not be kept is asked for again next time. */
  }
}
