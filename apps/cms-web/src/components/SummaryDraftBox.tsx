import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type SummaryDraftData } from '../api';
import { Banner, Button, Spinner } from '../ui';

/**
 * The summariser's draft, beside the summary box.
 *
 * ── Offered, never forced ───────────────────────────────────────────────────
 *
 * When the draft arrives and the summary box is still empty, it goes in — that
 * is the whole convenience. Once an editor has typed anything, it never
 * overwrites them: it appears underneath as a suggestion with "Use this", and
 * "Dismiss" puts it away. Regenerate asks for a new one on the same terms.
 *
 * ── Said plainly ────────────────────────────────────────────────────────────
 *
 * While the box holds the draft unchanged, a note says what it is. An AI draft
 * is a first draft to check against the original, not a finished summary. A
 * key-sentence draft is the publisher's own sentences, and the note says that
 * it cannot be published until it is rewritten — which the publish gate
 * enforces.
 *
 * ── Waiting ─────────────────────────────────────────────────────────────────
 *
 * The draft is written in the background after promote. This checks a small
 * endpoint every two seconds while it is pending, and gives up after a minute
 * with Regenerate, rather than spinning forever.
 */

const POLL_MS = 2_000;
const GIVE_UP_MS = 60_000;

interface Props {
  articleId: string;
  initial: SummaryDraftData | null;
  /** What is in the summary box now. */
  summary: string;
  /** A promoted story has an original to draft from; a hand-written one does not. */
  canRegenerate: boolean;
  /** The composer fills an empty box; the live-story editor only suggests. */
  fillWhenEmpty: boolean;
  sourceName: string;
  disabled?: boolean;
  onUse: (text: string) => void;
}

export function SummaryDraftBox({
  articleId,
  initial,
  summary,
  canRegenerate,
  fillWhenEmpty,
  sourceName,
  disabled = false,
  onUse,
}: Props) {
  const [draft, setDraft] = useState<SummaryDraftData | null>(initial);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Refs, because the fill effect must read the box as it is NOW — not as it
     was when the draft started being written. */
  const summaryNow = useRef(summary);
  summaryNow.current = summary;
  const onUseNow = useRef(onUse);
  onUseNow.current = onUse;
  const filledFor = useRef<string | null>(null);

  const pendingSince = draft?.status === 'pending' ? draft.requestedAt : null;

  useEffect(() => {
    if (pendingSince === null) return;
    const started = Date.now();
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const { summaryDraft } = await api.summaryDraft(articleId, ctrl.signal);
        if (summaryDraft !== null && summaryDraft.status !== 'pending') {
          setDraft(summaryDraft);
          return;
        }
      } catch {
        if (ctrl.signal.aborted) return;
        /* A dropped check is retried on the next tick; the draft is safe on
           the server either way. */
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setDraft((d) =>
          d === null
            ? d
            : {
                ...d,
                status: 'failed',
                error: 'Still not ready after a minute. Press Regenerate to try again.',
              },
        );
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };

    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      ctrl.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [articleId, pendingSince]);

  useEffect(() => {
    if (!fillWhenEmpty || draft === null || draft.status !== 'ready' || !draft.text) return;
    if (filledFor.current === draft.requestedAt) return;
    filledFor.current = draft.requestedAt;
    if (summaryNow.current.trim() === '') onUseNow.current(draft.text);
  }, [draft, fillWhenEmpty]);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.regenerateSummary(articleId);
      setDraft({
        status: 'pending',
        text: null,
        source: null,
        model: null,
        error: null,
        requestedAt: r.requestedAt,
        finishedAt: null,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not ask for a new draft.');
    } finally {
      setBusy(false);
    }
  };

  const regenerateButton = canRegenerate && (
    <Button
      size="sm"
      icon="refresh"
      busy={busy}
      disabled={disabled || draft?.status === 'pending'}
      onClick={() => void regenerate()}
    >
      {draft === null ? 'Draft a summary' : 'Regenerate'}
    </Button>
  );

  if (draft === null && !canRegenerate) return null;

  const inBox = draft?.text != null && summary.trim() === draft.text.trim();
  const keySentences = draft?.source === 'key_sentences';

  return (
    <div className="summary-draft">
      {error !== null && <Banner tone="error">{error}</Banner>}

      {draft?.status === 'pending' && (
        <p className="summary-draft-status" aria-live="polite">
          <Spinner /> Writing a summary from the original…
        </p>
      )}

      {draft?.status === 'failed' && (
        <Banner tone="info" live={false}>
          <strong>No summary was drafted.</strong> {draft.error}
        </Banner>
      )}

      {draft?.status === 'ready' && inBox && (
        <Banner tone={keySentences ? 'warn' : 'info'} live={false}>
          {keySentences ? (
            <>
              <strong>These are {sourceName}’s own sentences</strong>, picked out because the AI was
              unavailable{draft.error !== null ? ` (${draft.error.replace(/\.$/, '')})` : ''}. Rewrite
              them in your own words — the story cannot be published as it is.
            </>
          ) : (
            <>
              <strong>AI draft.</strong> Check every name, number and claim against the original
              before you submit — it is a first draft, not a finished summary.
            </>
          )}
        </Banner>
      )}

      {draft?.status === 'ready' && !inBox && draft.text && dismissedFor !== draft.requestedAt && (
        <div className="summary-draft-card">
          <p className="summary-draft-label">
            {keySentences ? 'Key sentences from the original' : 'Suggested summary'}
          </p>
          <p className="summary-draft-text">{draft.text}</p>
          <div className="actions actions-plain">
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={disabled}
              onClick={() => onUse(draft.text!)}
            >
              Use this
            </Button>
            <Button size="sm" onClick={() => setDismissedFor(draft.requestedAt)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {regenerateButton && <div className="actions actions-plain">{regenerateButton}</div>}
    </div>
  );
}
