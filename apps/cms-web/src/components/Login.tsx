import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { Routes, routeToHash } from '../nav';
import { Banner, Button, Field, Icon } from '../ui';

/**
 * Signing in.
 *
 * -- Why the fields are not cleared on failure -------------------------------
 *
 * A rejected sign-in is usually a mistyped password against a correct address.
 * Emptying both makes the person retype the part they got right, and emptying
 * only the password is the behaviour that trains people to use shorter ones.
 *
 * -- Why the error is a banner and not a label -------------------------------
 *
 * The server does not say which of the two was wrong, and it should not: that
 * is what turns a login form into a way of discovering which addresses have
 * accounts. A message that belongs to neither field belongs above both.
 *
 * -- Why the left half is a panel and not a photograph -----------------------
 *
 * A stock photograph of a newsroom would be a picture of someone else's office
 * presented as ours, and a real one does not exist yet. The panel says what the
 * product is instead, which is the only thing that half of the screen was ever
 * going to communicate honestly. It collapses below 900px, where a decorative
 * half is a screen of scrolling before the form.
 */
interface LoginProps {
  onSignedIn: () => void;
  /**
   * Why the form is being shown, when it is not simply "you are signed out" —
   * the server being unreachable, most often. Distinct from `error` below,
   * which is what a submitted attempt came back with.
   */
  problem?: string | null;
}

export function Login({ onSignedIn, problem = null }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      /* Deliberately not clearing `busy` on the way out. The caller is about to
         swap this whole screen for the application, and re-enabling the button
         first gives a visible flicker of a live form on a successful login. */
      onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <aside className="signin-side">
        <div className="signin-side-inner">
          <p className="signin-mark">SAAR</p>
          <p className="signin-pitch">The day’s news, in sixty words a story.</p>
          <p className="signin-note">
            Nepali and English in one feed, every card credited to the publisher who reported it.
          </p>
        </div>
      </aside>

      <main className="signin-main">
        <form className="signin-form" onSubmit={submit}>
          {/* The way back out. Someone who reached this screen by following
              "Staff sign in" and is not staff has otherwise no exit but the
              browser's own back button. */}
          <a className="signin-back" href={routeToHash(Routes.home())}>
            <Icon name="arrowLeft" /> Back to the site
          </a>

          <h1 className="signin-title">Editorial</h1>
          <p className="signin-sub">Sign in to the newsroom.</p>

          {/* A connection problem is not a rejected password, and saying so stops
              someone retyping a password that was never wrong. It gives way to
              the real error once an attempt has actually been made. */}
          {error === null && problem !== null && (
            <Banner tone="warn" live={false}>
              {problem} Your sign-in may still be valid — try reloading once it is back.
            </Banner>
          )}
          {error !== null && <Banner tone="error">{error}</Banner>}

          <Field label="Email">
            {(f) => (
              <input
                {...f}
                className="input"
                type="email"
                autoComplete="username"
                autoFocus
                required
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>

          {/*
            * `data-filled` is not optional here, and its absence was a bug.
            *
            * The Field floats its label with a sibling selector on the control.
            * Wrapping the input to hang a reveal button beside it put a span
            * between the two, the selector stopped matching, and the label sat
            * on top of the dots reading "Password" — the exact symptom the
            * autofill fix had just removed, reintroduced by the wrapper.
            *
            * This is the escape hatch Field.tsx documents for a control that
            * wraps its input, and the combo box uses it for the same reason.
            */}
          <Field label="Password">
            {(f) => (
              <span
                className="input-with-affix"
                data-filled={password === '' ? 'false' : 'true'}
              >
                <input
                  {...f}
                  className="input"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="input-affix"
                  aria-label={revealed ? 'Hide the password' : 'Show the password'}
                  aria-pressed={revealed}
                  disabled={busy}
                  onClick={() => setRevealed((r) => !r)}
                >
                  <Icon name={revealed ? 'eyeOff' : 'eye'} />
                </button>
              </span>
            )}
          </Field>

          <div className="actions actions-plain">
            <Button type="submit" variant="primary" block busy={busy}>
              Sign in
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

/**
 * The hold while we find out whether the session cookie is still good.
 *
 * Showing the login form first and taking it away a moment later is worse than
 * a brief blank: it invites someone to start typing an address they did not
 * need to type.
 */
export function Booting() {
  return (
    <div className="login" aria-busy="true">
      <p style={{ color: 'var(--ink-faint)' }}>
        <span className="spinner" aria-hidden="true" />
        <span className="sr-only">Checking your session</span>
      </p>
    </div>
  );
}
