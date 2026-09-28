import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
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
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-mark">SAAR</h1>
        <p className="login-sub">Editorial</p>

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
          * The reveal toggle.
          *
          * Worth having on exactly this field and not as a general habit: a
          * password is the one input where a typo is invisible by design, and
          * the alternative to showing it is retyping the whole thing to find
          * out which character was wrong.
          *
          * It is a real `<button type="button">` — inside a form, a button
          * without that attribute submits, so a reveal would have tried to sign
          * in with a half-typed password. `aria-pressed` says which state it is
          * in rather than leaving a screen reader to infer it from the label.
          */}
        <Field label="Password">
          {(f) => (
            <span className="input-with-affix">
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
