import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type DispatchReport,
  type NotificationRow,
  type NotifyTargets,
} from '../api';

/**
 * Composing and sending a notification.  Spec Ch. 10.
 *
 * The screen is built around one idea: an editor should never be surprised by
 * what a send did. Reach is shown before the copy is written, quiet hours are
 * warned about rather than discovered, and the result names every reader the
 * gate stopped and why — because "sent to 4 of 60" with no explanation reads as
 * a bug and is usually a policy working correctly.
 */

const TYPES = [
  { value: 'breaking', label: 'Breaking', hint: 'Bypasses the 90-minute gap. Still capped.' },
  { value: 'digest', label: 'Digest', hint: 'Links to the feed. No story needed.' },
  { value: 'category', label: 'Section', hint: 'Off by default on every device.' },
  { value: 'correction', label: 'Correction', hint: 'Exempt from the daily cap.' },
] as const;

/** The gate's machine reasons, said the way an editor would say them. */
const REASON_LABEL: Record<string, string> = {
  disabled: 'notifications switched off',
  channel_off: 'this channel switched off',
  cap_reached: 'already had their daily limit',
  min_gap: 'too soon after their last one',
  quiet_hours: 'quiet hours (21:30–06:30)',
  no_language: 'does not read either language sent',
};

function Reach({ t }: { t: NotifyTargets }) {
  const none = t.devices.withToken === 0;
  return (
    <div className="panel">
      <div className="row-head">Reach</div>
      <p className="field-note">
        <strong>{t.devices.withToken}</strong> of {t.devices.total} registered{' '}
        {t.devices.total === 1 ? 'device' : 'devices'} can receive a push.{' '}
        {t.devices.notifEnabled} have notifications switched on.
      </p>
      {none && (
        <div className="banner banner-error">
          No device holds a push token, so nothing can be delivered yet. A handset only gets one
          after it runs a <strong>development build</strong> — Expo Go cannot receive push on
          Android — and grants notification permission.
        </div>
      )}
      {t.quietHours.active && (
        <div className="banner">
          Quiet hours are in force until{' '}
          {t.quietHours.opensAt ? new Date(t.quietHours.opensAt).toLocaleTimeString() : 'morning'}.
          Breaking news is held; everything else is suppressed. Use a test send to check copy now.
        </div>
      )}
    </div>
  );
}

function Report({ r }: { r: DispatchReport }) {
  const reasons = Object.entries(r.bySuppression).filter(([, n]) => n > 0);

  return (
    <div className="panel">
      <div className="row-head">Result</div>

      <div className={r.accepted > 0 ? 'banner banner-ok' : 'banner'}>
        {r.accepted > 0
          ? `Accepted for delivery to ${r.accepted} ${r.accepted === 1 ? 'device' : 'devices'}.`
          : 'Nothing was delivered.'}
      </div>

      <p className="field-note">
        {r.devices} registered · {r.noToken} without a push token · {r.attempted} passed the gate ·{' '}
        {r.suppressed} suppressed
      </p>

      {reasons.length > 0 && (
        <ul className="field-note" style={{ marginTop: 4 }}>
          {reasons.map(([reason, n]) => (
            <li key={reason}>
              {n} — {REASON_LABEL[reason] ?? reason}
            </li>
          ))}
        </ul>
      )}

      {r.heldForQuietHours > 0 && (
        <div className="banner banner-error">
          {r.heldForQuietHours} device{r.heldForQuietHours === 1 ? ' was' : 's were'} HELD for quiet
          hours until{' '}
          {r.quietHoursUntil ? new Date(r.quietHoursUntil).toLocaleTimeString() : 'morning'}. Nothing
          schedules that retry yet, so those readers will not receive this at all.
        </div>
      )}

      {r.unregistered > 0 && (
        <p className="field-note">
          {r.unregistered} token{r.unregistered === 1 ? '' : 's'} cleared — the app was uninstalled
          or the token rotated.
        </p>
      )}

      {r.failed.length > 0 && (
        <div className="banner banner-error">
          {r.failed.length} failed. First: {r.failed[0]!.message}
        </div>
      )}
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export function Notify({ onBack }: Props) {
  const [targets, setTargets] = useState<NotifyTargets | null>(null);
  const [history, setHistory] = useState<NotificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<string>('breaking');
  const [articleId, setArticleId] = useState<string>('');
  const [titleNe, setTitleNe] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyNe, setBodyNe] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [langs, setLangs] = useState<string[]>(['ne', 'en']);

  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DispatchReport | null>(null);

  const [testDeviceId, setTestDeviceId] = useState('');
  const [testNote, setTestNote] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void api
      .notifyTargets()
      .then(setTargets)
      .catch((e: ApiError) => setError(e.message));
    void api
      .notifyHistory()
      .then((r) => setHistory(r.items))
      .catch(() => undefined);
  };

  useEffect(load, []);

  const article = useMemo(
    () => targets?.articles.find((a) => a.id === articleId) ?? null,
    [targets, articleId],
  );

  /** Prefill the side we have copy for. The other language is the editor's to
   *  write — we will not machine-translate a headline and call it editorial. */
  const chooseArticle = (id: string) => {
    setArticleId(id);
    const a = targets?.articles.find((x) => x.id === id);
    if (!a) return;
    if (a.language === 'ne' && !titleNe.trim()) setTitleNe(a.headline);
    if (a.language === 'en' && !titleEn.trim()) setTitleEn(a.headline);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await api.notifySend({
        type,
        articleId: articleId || null,
        title: { ne: titleNe.trim(), en: titleEn.trim() },
        body: { ne: bodyNe.trim(), en: bodyEn.trim() },
        audience: { languages: langs, categories: [] },
      });
      setReport(res.report);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Send failed.');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setTestNote(null);
    setError(null);
    try {
      await api.notifyTest({
        deviceId: testDeviceId.trim(),
        title: titleNe.trim() || titleEn.trim() || 'SAAR test',
        body: bodyNe.trim() || bodyEn.trim() || 'If you can read this, push works.',
        deepLink: article ? `saar://article/${article.slug}` : 'saar://feed',
      });
      setTestNote('Sent. It should arrive on that handset within a few seconds.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Test send failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleLang = (l: string) =>
    setLangs((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const complete =
    titleNe.trim() && titleEn.trim() && bodyNe.trim() && bodyEn.trim() && langs.length > 0;
  const needsStory = type !== 'digest' && !articleId;

  return (
    <>
      <div className="page-head">
        <button className="btn btn-sm" onClick={onBack}>
          ← Queue
        </button>
        <h2 style={{ margin: 0 }}>Notifications</h2>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {targets && <Reach t={targets} />}

      <div className="panel">
        <div className="row-head">Compose</div>

        <div className="field">
          <div className="label">
            <span>Type</span>
          </div>
          <div className="segmented">
            {TYPES.map((t) => (
              <button
                key={t.value}
                className={type === t.value ? 'seg seg-on' : 'seg'}
                onClick={() => setType(t.value)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="field-note">{TYPES.find((t) => t.value === type)?.hint}</div>
        </div>

        <div className="field">
          <div className="label">
            <span>Story</span>
            {type === 'digest' && <span className="field-optional">optional</span>}
          </div>
          <select
            className="input"
            value={articleId}
            onChange={(e) => chooseArticle(e.target.value)}
          >
            <option value="">
              {type === 'digest' ? 'None — link to the feed' : 'Choose a published story…'}
            </option>
            {targets?.articles.map((a) => (
              <option key={a.id} value={a.id}>
                [{a.language}] {a.headline || a.slug}
              </option>
            ))}
          </select>
          {needsStory && (
            <div className="field-note field-warn">
              A {type} notification must link to a story. Only published stories are listed — a tap
              has to land on something readable.
            </div>
          )}
        </div>

        <div className="field">
          <div className="label">
            <span>Title</span>
          </div>
          <input
            className="input"
            placeholder="शीर्षक (Nepali)"
            maxLength={160}
            value={titleNe}
            onChange={(e) => setTitleNe(e.target.value)}
          />
          <input
            className="input"
            style={{ marginTop: 6 }}
            placeholder="Title (English)"
            maxLength={160}
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="label">
            <span>Body</span>
          </div>
          <input
            className="input"
            placeholder="विवरण (Nepali)"
            maxLength={160}
            value={bodyNe}
            onChange={(e) => setBodyNe(e.target.value)}
          />
          <input
            className="input"
            style={{ marginTop: 6 }}
            placeholder="Body (English)"
            maxLength={160}
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
          />
          <div className="field-note">
            Both languages are required. A device tells us which languages its reader accepts, and
            we never send copy in one they have not asked for — so a single-language notification
            would simply not reach the other half of the audience.
          </div>
        </div>

        <div className="field">
          <div className="label">
            <span>Send to readers of</span>
          </div>
          <div className="segmented">
            {['ne', 'en'].map((l) => (
              <button
                key={l}
                type="button"
                className={langs.includes(l) ? 'seg seg-on' : 'seg'}
                onClick={() => toggleLang(l)}
              >
                {l === 'ne' ? 'Nepali' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={busy || !complete || needsStory}
            onClick={() => void send()}
          >
            {busy ? <span className="spinner" /> : null} Send
          </button>
        </div>
      </div>

      {report && <Report r={report} />}

      <div className="panel">
        <div className="row-head">Test on one handset</div>
        <p className="field-note">
          Sends to a single device you name, ignoring the cap, the gap and quiet hours. Those rules
          protect readers who did not ask to be interrupted; they are not owed to your own phone
          while you are checking that a tap opens the right card. Every test is written to the audit
          trail.
        </p>
        <div className="field">
          <div className="label">
            <span>Device id</span>
          </div>
          <input
            className="input"
            placeholder="from the app’s Settings screen"
            value={testDeviceId}
            onChange={(e) => setTestDeviceId(e.target.value)}
          />
        </div>
        {testNote && <div className="banner banner-ok">{testNote}</div>}
        <div className="actions">
          <button
            className="btn"
            disabled={busy || testDeviceId.trim().length < 8}
            onClick={() => void sendTest()}
          >
            Send test
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="row-head">Recently sent</div>
        {history.length === 0 ? (
          <p className="empty">Nothing has been sent yet.</p>
        ) : (
          <div className="queue">
            {history.map((h) => (
              <div className="row" key={h.id} style={{ cursor: 'default' }}>
                <span className="chip">{h.type}</span>
                <div>
                  <div>{h.title.en || h.title.ne}</div>
                  <div className="row-meta">
                    {h.sentAt ? new Date(h.sentAt).toLocaleString() : 'not sent'} · {h.deepLink}
                  </div>
                </div>
                <div className="row-right">
                  {h.stats.delivered}/{h.stats.attempted}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
