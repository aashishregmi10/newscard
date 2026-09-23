import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, isAbort, type Staff } from './api';
import { Routes, resolveRoute, screenKeyOf, sectionOf, type Role, type Route } from './nav';
import { navigate, useRoute } from './useRoute';
import { AppShell } from './components/AppShell';
import { Booting, Login } from './components/Login';
import { Composer } from './components/Composer';
import { NewShort } from './components/NewShort';
import { NewSource } from './components/NewSource';
import { NewStory } from './components/NewStory';
import { Notify } from './components/Notify';
import { Queue } from './components/Queue';
import { Shorts } from './components/Shorts';
import { SourceDetail } from './components/SourceDetail';
import { Sources } from './components/Sources';

/**
 * The root.
 *
 * Its whole job is three decisions: are we signed in, where are we, and is this
 * person allowed to be there. Everything else belongs to a screen.
 *
 * Note what is NOT here any more — the four booleans that used to encode the
 * current screen, and the nested ternary that read them. See nav.ts for why.
 */

/** 'pending' is distinct from null: unknown is not the same as signed out. */
type Session = Staff | null | 'pending';

export default function App() {
  const [session, setSession] = useState<Session>('pending');
  /** Why there is no session, when the reason is not "you are signed out". */
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  /**
   * Last known queue depth, for the badge on the rail.
   *
   * Reported by the queue when it loads rather than fetched again here. It goes
   * stale while another section is open, which is the right trade: a count that
   * is a few minutes old still answers "is there a pile waiting", and a poll to
   * keep it exact would be a request every few seconds for a number nobody acts
   * on that precisely.
   */
  const [queueCount, setQueueCount] = useState<number | null>(null);

  const requested = useRoute();

  /**
   * Is there a usable session?
   *
   * Three outcomes, and collapsing them is what broke this.
   *
   * 1. ABORTED. Our own cleanup cancelled the request. In StrictMode React runs
   *    an effect, tears it down and runs it again, so the first check is always
   *    aborted in development. A bare `catch` read that as "not signed in" and
   *    set the session to null; the second check then raced to put it back, and
   *    against a server on localhost that race is close enough to lose — which
   *    is why a reload sometimes landed on the login screen with a perfectly
   *    good cookie. An abort is not an answer, so it is ignored.
   *
   * 2. REFUSED (401/403). A genuine answer: there is no session. Straight to
   *    the login form with nothing to explain.
   *
   * 3. UNREACHABLE. The server is down or the network dropped. This says
   *    nothing about the cookie, so presenting a bare login form is a lie — it
   *    invites someone to retype a password that was never the problem. The
   *    form is shown (there is nothing else to show) with the real reason
   *    above it.
   */
  const checkSession = useCallback(async (signal?: AbortSignal) => {
    try {
      const { staff } = await api.me(signal);
      setSession(staff);
      setSessionError(null);
    } catch (e) {
      if (isAbort(e)) return;

      const refused = e instanceof ApiError && (e.status === 401 || e.status === 403);
      setSession(null);
      setSessionError(
        refused ? null : e instanceof ApiError ? e.message : 'Could not reach the CMS server.',
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    /* A failed logout still signs you out locally. The cookie may already have
       expired — which is the most likely reason the call failed — and refusing
       to clear the screen because the server did not confirm leaves someone
       staring at a queue they can no longer act on. */
    await api.logout().catch(() => undefined);
    setSession(null);
    setSigningOut(false);
    setQueueCount(null);
    navigate(Routes.queue(), { replace: true });
  }, []);

  if (session === 'pending') return <Booting />;
  if (session === null) {
    return <Login problem={sessionError} onSignedIn={() => void checkSession()} />;
  }

  /*
   * A route this role cannot open resolves to the queue.
   *
   * The server enforces the same rule and would refuse the request; this is so
   * that an author who follows a link to the notification screen lands
   * somewhere usable instead of on an error they can do nothing about.
   */
  const route = resolveRoute(requested, session.role);

  return (
    <AppShell
      staff={session}
      section={sectionOf(route)}
      queueCount={queueCount}
      /* The SCREEN, not the route: paging a list or switching a tab must not
         count as arriving somewhere new, or the column would scroll to the top
         and take focus on every keystroke in the search box. */
      routeKey={screenKeyOf(route)}
      onSignOut={() => void signOut()}
      signingOut={signingOut}
    >
      <Screen route={route} role={session.role} onQueueCount={setQueueCount} />
    </AppShell>
  );
}

/**
 * The route, rendered.
 *
 * A switch over the union rather than a ternary chain, so adding a route is a
 * compile error here until it is handled — `Route` has no default case and
 * TypeScript checks the switch is exhaustive.
 */
function Screen({
  route,
  role,
  onQueueCount,
}: {
  route: Route;
  /* Threaded down so a screen can render read-only rather than empty. The
     server holds the same line; this decides what is worth offering. */
  role: Role;
  onQueueCount: (count: number) => void;
}) {
  switch (route.name) {
    case 'queue':
      return (
        <Queue page={route.page} perPage={route.perPage} search={route.q} onCount={onQueueCount} />
      );
    case 'new':
      return <NewStory />;
    case 'article':
      /* Keyed by id so that moving between two stories rebuilds the composer
         rather than reusing it. Without the key, the previous story's text
         would sit in the fields until the new one arrived. The TAB is not part
         of the key — switching tabs must not discard unsaved edits. */
      return <Composer key={route.id} id={route.id} tab={route.tab} />;
    case 'shorts':
      return <Shorts page={route.page} perPage={route.perPage} />;
    case 'shortNew':
      return <NewShort />;
    case 'sources':
      return (
        <Sources
          tab={route.tab}
          page={route.page}
          perPage={route.perPage}
          search={route.q}
          role={role}
        />
      );
    case 'sourceNew':
      return <NewSource />;
    case 'source':
      /* Keyed by slug so moving between two publishers rebuilds the form
         rather than leaving the previous one's values in the fields. */
      return <SourceDetail key={route.slug} slug={route.slug} role={role} />;
    case 'notifications':
      return <Notify tab={route.tab} />;
  }
}
