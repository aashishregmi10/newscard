import { useEffect, useState } from 'react';
import { api, ApiError, type Staff } from './api';
import { Queue } from './components/Queue';
import { Composer } from './components/Composer';

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>NEWSCARD</h1>
        <p className="sub">Editorial</p>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="field">
          <div className="label">
            <span>Email</span>
          </div>
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="label">
            <span>Password</span>
          </div>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Sign in
        </button>
      </form>
    </div>
  );
}

/** Full-page state while we find out whether the cookie is still valid. Showing
 *  the login form first and then yanking it away is worse than a brief hold. */
function Booting() {
  return (
    <div className="login-page">
      <div style={{ textAlign: 'center', color: 'var(--ink-faint)' }}>
        <span className="spinner" />
      </div>
    </div>
  );
}

export default function App() {
  const [staff, setStaff] = useState<Staff | null | 'loading'>('loading');
  const [openId, setOpenId] = useState<string | null>(null);

  const check = () =>
    api
      .me()
      .then((r) => setStaff(r.staff))
      .catch(() => setStaff(null));

  useEffect(() => {
    void check();
  }, []);

  if (staff === 'loading') return <Booting />;
  if (staff === null) return <Login onDone={() => void check()} />;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">NEWSCARD</span>
        <span className="who">Editorial</span>
        <div className="topbar-spacer" />
        <span className="who">
          {staff.email} · {staff.role}
        </span>
        <button
          className="btn btn-sm"
          onClick={async () => {
            await api.logout().catch(() => undefined);
            setStaff(null);
            setOpenId(null);
          }}
        >
          Sign out
        </button>
      </header>

      <main className="main">
        <div className="wrap">
          {openId ? (
            <Composer id={openId} onBack={() => setOpenId(null)} />
          ) : (
            <Queue onOpen={setOpenId} />
          )}
        </div>
      </main>
    </div>
  );
}
