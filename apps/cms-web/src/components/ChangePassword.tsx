import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { Banner, Button, Field } from '../ui';

/**
 * Change one's own password: the current one, then the new one twice.
 *
 * A native <dialog>, so focus is held inside it and Escape closes it without
 * anything written here. Accounts are made with generated passwords
 * (scripts/staff.ts), so this is the first thing a new person does — and what
 * anyone does who thinks theirs was seen: every other session ends.
 */
export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setCurrent('');
      setNext('');
      setAgain('');
      setError(null);
      setDone(false);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = again.length > 0 && again !== next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 12 || next !== again) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} aria-labelledby="change-password-title">
      <form className="dialog-body" onSubmit={(e) => void submit(e)}>
        <h2 id="change-password-title" className="dialog-title">
          Change password
        </h2>

        {done ? (
          <>
            <Banner tone="ok" live>
              Password changed. Every other session has been signed out; this one stays signed in.
            </Banner>
            <div className="dialog-actions">
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            {error !== null && <Banner tone="error">{error}</Banner>}
            <Field label="Current password">
              {(f) => (
                <input
                  {...f}
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="New password"
              note={tooShort ? 'At least 12 characters.' : 'At least 12 characters. A phrase of a few words is fine.'}
              noteTone={tooShort ? 'bad' : 'default'}
              invalid={tooShort}
            >
              {(f) => (
                <input
                  {...f}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="New password again"
              note={mismatch ? 'The two new passwords differ.' : undefined}
              noteTone={mismatch ? 'bad' : 'default'}
              invalid={mismatch}
            >
              {(f) => (
                <input
                  {...f}
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              )}
            </Field>
            <div className="dialog-actions">
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={current === '' || next.length < 12 || next !== again}
              >
                Change password
              </Button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
