import { useEffect, useRef, useState, useCallback } from 'react';
import { api, ApiError, type ArticleDetail, type ClusterSibling, type Limits } from '../api';

/**
 * The composer.  Spec Ch. 5.4.
 *
 * Where an editor spends most of the three minutes, so it gets the most care:
 * the counter is unambiguous, autosave is visible but never in the way, and the
 * source article sits beside the summary rather than behind a tab.
 */

/** Grapheme-cluster count — क्ष is ONE character, not three (Ch. 11.4).
 *  Counting code points would show Nepali summaries as a third longer than they
 *  are and push editors to write too little. */
function countGraphemes(text: string, locale = 'ne'): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)) n++;
    return n;
  }
  return [...text].length;
}

function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/u).filter(Boolean).length;
}

function measure(text: string, limits: Limits, lang: 'ne' | 'en'): number {
  return limits.limitType === 'graphemes' ? countGraphemes(text, lang) : countWords(text);
}

function ComposerSkeleton() {
  return (
    <div className="composer" aria-busy="true">
      <div className="panel">
        <div className="skel" style={{ height: 11, width: 80, marginBottom: 10 }} />
        <div className="skel" style={{ height: 42, marginBottom: 24 }} />
        <div className="skel" style={{ height: 11, width: 80, marginBottom: 10 }} />
        <div className="skel" style={{ height: 160 }} />
      </div>
      <div className="panel">
        <div className="skel" style={{ height: 11, width: 110, marginBottom: 14 }} />
        <div className="skel" style={{ height: 13, marginBottom: 8 }} />
        <div className="skel" style={{ height: 13, width: '92%', marginBottom: 8 }} />
        <div className="skel" style={{ height: 13, width: '78%' }} />
      </div>
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  id: string;
  onBack: () => void;
}

export function Composer({ id, onBack }: Props) {
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [cluster, setCluster] = useState<ClusterSibling[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    api
      .article(id)
      .then((r) => {
        setDetail(r.article);
        setCluster(r.cluster);
        setLimits(r.limits);
        setHeadline(r.article.headline);
        setSummary(r.article.summary);
        dirty.current = false;
      })
      .catch((e: ApiError) => setError(e.message));
  }, [id]);

  const persist = useCallback(
    async (patch: { headline?: string; summary?: string }) => {
      setSave('saving');
      try {
        await api.save(id, patch);
        setSave('saved');
        dirty.current = false;
      } catch {
        // Never lose the editor's words to a failed request — the text stays in
        // the field and the next keystroke schedules another attempt.
        setSave('error');
      }
    },
    [id],
  );

  /** Autosave 1.5s after typing stops (Ch. 5.6). Long enough not to fire on
   *  every keystroke, short enough that a closed tab loses almost nothing. */
  const scheduleSave = useCallback(
    (patch: { headline?: string; summary?: string }) => {
      dirty.current = true;
      setSave('idle');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(patch), 1500);
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) await persist({ headline, summary });
      await fn();
      setNotice(ok);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) {
    return (
      <>
        <div className="banner banner-error">{error}</div>
        <button className="btn" onClick={onBack}>
          Back to queue
        </button>
      </>
    );
  }

  if (!detail || !limits) return <ComposerSkeleton />;

  const lang = detail.language;
  const band = limits.limits[lang];
  const count = measure(summary, limits, lang);
  const state = count < band.min ? 'under' : count > band.max ? 'over' : 'ok';
  const canSubmit = state === 'ok' && headline.trim().length >= 10 && !busy;

  return (
    <>
      <div className="page-head">
        <button className="btn btn-sm" onClick={onBack}>
          ← Queue
        </button>
        <h1 style={{ fontSize: 17 }}>
          {lang === 'ne' ? 'नेपाली' : 'English'} · {detail.sourceName}
        </h1>
        <div className="topbar-spacer" />
        <span className="savehint">
          {save === 'saving' && (
            <>
              <span className="spinner" /> saving…
            </>
          )}
          {save === 'saved' && 'saved'}
          {save === 'error' && <span style={{ color: 'var(--bad)' }}>save failed — will retry</span>}
        </span>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-ok">{notice}</div>}

      <div className="composer">
        <div className="panel">
          {cluster.length > 0 && (
            <div className="cluster-note">
              <b>{cluster.length + 1} sources are covering this story.</b> Summarise it once — the
              others will be spiked as duplicates.
              <ul>
                {cluster.map((c) => (
                  <li key={c.id}>{c.sourceName}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="field">
            <div className="label">
              <span>Headline</span>
              <span
                className="counter"
                data-state={headline.length > limits.headlineMaxChars ? 'over' : 'ok'}
              >
                {headline.length} / {limits.headlineMaxChars}
              </span>
            </div>
            <input
              className="input"
              lang={lang}
              value={headline}
              maxLength={limits.headlineMaxChars}
              onChange={(e) => {
                setHeadline(e.target.value);
                scheduleSave({ headline: e.target.value, summary });
              }}
            />
          </div>

          <div className="field">
            <div className="label">
              <span>Summary</span>
              <span className="counter" data-state={state}>
                {count} / {band.min}–{band.max} {limits.limitType}
              </span>
            </div>
            <textarea
              className="textarea"
              lang={lang}
              value={summary}
              rows={9}
              onChange={(e) => {
                setSummary(e.target.value);
                scheduleSave({ headline, summary: e.target.value });
              }}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter submits for review (Ch. 5.5).
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSubmit) {
                  void act(() => api.transition(id, 'in_review'), 'Submitted for review.');
                }
              }}
            />
            {state === 'under' && (
              <div className="savehint">
                {band.min - count} more to go. A short summary reads as low effort.
              </div>
            )}
            {state === 'over' && (
              <div className="savehint" style={{ color: 'var(--bad)' }}>
                {count - band.max} over the limit.
              </div>
            )}
          </div>

          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={!canSubmit}
              onClick={() => void act(() => api.transition(id, 'in_review'), 'Submitted for review.')}
            >
              {busy ? <span className="spinner" /> : null} Submit for review
            </button>
            <button
              className="btn"
              disabled={busy || detail.status !== 'approved'}
              title={detail.status !== 'approved' ? 'Only an approved article can be published' : ''}
              onClick={() => void act(() => api.publish(id), 'Published.')}
            >
              Publish
            </button>
            <div className="spacer" />
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => void act(() => api.transition(id, 'spiked'), 'Spiked.')}
            >
              Spike
            </button>
          </div>
          <div className="savehint" style={{ marginTop: 10 }}>
            <span className="kbd">Ctrl</span> + <span className="kbd">↵</span> submits
          </div>
        </div>

        <div className="panel">
          <div className="label" style={{ marginBottom: 12 }}>
            <span>Source article</span>
          </div>
          <div className="row-head" lang={lang} style={{ marginBottom: 6 }}>
            {detail.headline}
          </div>
          <div className="row-meta" style={{ marginBottom: 14 }}>
            {detail.sourceName}
            {detail.publisherAuthor ? ` · ${detail.publisherAuthor}` : ''}
          </div>
          <a
            className="btn btn-sm"
            href={detail.publisherUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            Open original ↗
          </a>

          {detail.editorialNotes && (
            <>
              <div className="label" style={{ marginTop: 24, marginBottom: 8 }}>
                <span>Reviewer note</span>
              </div>
              <div className="source-body">{detail.editorialNotes}</div>
            </>
          )}

          <div className="label" style={{ marginTop: 24, marginBottom: 8 }}>
            <span>Reminder</span>
          </div>
          <div className="source-body">
            Write the summary in your own words. Pasting the publisher’s sentences and lightly
            editing them is the fastest route to a copyright complaint.
          </div>
        </div>
      </div>
    </>
  );
}
