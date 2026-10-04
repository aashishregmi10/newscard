import { useEffect, useRef, useState } from 'react';
import { api, type ArticleDetail, type ArticleImageData, type Limits } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime, relativeTime } from '../lib/format';
import { bandState, measure } from '../lib/measure';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Counter,
  EmptyState,
  Field,
  Panel,
  Skeleton,
} from '../ui';
import { ImagePicker } from './ImagePicker';
import { SummaryDraftBox } from './SummaryDraftBox';
import { AdsOnStory } from './AdsOnStory';

/**
 * Correcting a story that is already live.
 *
 * -- Why this is not the composer --------------------------------------------
 *
 * The composer autosaves every 1.5 seconds and records nothing about what
 * changed. That is right for a draft nobody has seen and wrong for a story that
 * is out, where the question asked afterwards is always "what did it say
 * before, who changed it, and why". So this screen saves nothing until asked,
 * asks for the whole change at once, and will not save it without a reason.
 * The server stamps the time and keeps the before and after.
 *
 * -- Why the right-hand column shows the live story --------------------------
 *
 * In the composer that column holds the source being summarised. Here the
 * thing being changed is our own published text, so that is what sits beside
 * the fields — unchanged while you type, so the difference is always visible.
 *
 * -- Why withdraw is here too, and asks twice --------------------------------
 *
 * Correcting and withdrawing are the two things that can be done to a live
 * story, and both need the same reason. They share the field. Withdrawal is
 * final — there is no transition out of it — so it takes a second, explicit
 * click rather than one that can be made by accident on the way to Save.
 */

/** Matches the server, which refuses anything shorter. */
const REASON_MIN = 10;
/** Shorter than this is not a headline; the publish gate agrees. */
const HEADLINE_MIN = 10;

interface Data {
  article: ArticleDetail;
  limits: Limits;
  /** Whether a lead's original is still on file to draft from. */
  hasOriginal: boolean;
}

function EditSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="detail-bar">
        <Skeleton height={16} width={260} />
      </div>
      <div className="composer">
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={40} style={{ marginBottom: 24 }} />
            <Skeleton height={170} />
          </div>
        </div>
        <div className="panel sticky-aside">
          <div className="panel-body">
            <Skeleton height={13} />
            <Skeleton height={13} width="88%" style={{ marginTop: 8 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function EditPublished({ id }: { id: string }) {
  const { data, error: loadError, loading, reload } = useResource<Data>(
    async (signal) => {
      const r = await api.article(id, signal);
      return { article: r.article, limits: r.limits, hasOriginal: r.original !== null };
    },
    `article:${id}:edit`,
    'Could not open this story.',
  );

  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [image, setImage] = useState<ArticleImageData | null>(null);
  const [reason, setReason] = useState('');
  /** A picture chosen but not yet uploaded, which Save would otherwise leave off. */
  const [imagePending, setImagePending] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  const action = useAsyncAction();

  /*
   * Re-seeded from every load, not only the first.
   *
   * The composer seeds once so a reload after a transition does not overwrite
   * typing in progress. Here a reload only ever follows a successful save, at
   * which point the server's copy IS what was typed — and seeding from it is
   * what makes the fields, the live column and the timestamp agree.
   */
  const seededFrom = useRef<string | null>(null);
  useEffect(() => {
    if (data === null) return;
    const stamp = `${data.article.id}:${data.article.lastEditedAt ?? ''}`;
    if (seededFrom.current === stamp) return;
    seededFrom.current = stamp;
    setHeadline(data.article.headline);
    setSummary(data.article.summary);
    setImage(data.article.image);
  }, [data]);

  const article = data?.article ?? null;

  const dirty =
    article !== null &&
    (headline !== article.headline ||
      summary !== article.summary ||
      JSON.stringify(image) !== JSON.stringify(article.image));

  /* The tab-close guard the composer has, for the same reason: a correction
     half-typed into a closed tab is simply gone. */
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (loadError !== null && data === null) {
    return (
      <div className="page">
        <Banner tone="error">{loadError}</Banner>
        <div className="actions actions-plain">
          <Button icon="arrowLeft" onClick={() => navigate(Routes.published())}>
            Back to published stories
          </Button>
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || data === null || article === null) return <EditSkeleton />;

  const { limits } = data;
  const language = article.language;
  const listCrumb = { label: 'Published', route: Routes.published() };

  /* Only a live story is corrected here. A draft belongs in the composer and a
     withdrawn story is final — say which, and offer the way there. */
  if (article.status !== 'published') {
    const withdrawn = article.status === 'retracted';
    return (
      <div className="page">
        <div className="detail-bar">
          <Breadcrumbs items={crumbs(listCrumb, { label: article.headline || 'Untitled' })} />
        </div>
        <EmptyState
          icon={withdrawn ? 'ban' : 'fileText'}
          title={withdrawn ? 'This story was withdrawn' : 'This story is not live'}
        >
          {withdrawn ? (
            <>
              It was withdrawn {article.retractedAt !== null && relativeTime(article.retractedAt)}
              {article.retractionReason !== null && <> because: “{article.retractionReason}”</>}.
              A withdrawal is final, so it is no longer edited.
            </>
          ) : (
            'A story that has not been published yet is edited in the composer, where it autosaves as you type.'
          )}
        </EmptyState>
        <div className="actions actions-plain">
          <Button
            icon="arrowLeft"
            onClick={() => navigate(withdrawn ? Routes.published({ tab: 'retracted' }) : Routes.published())}
          >
            Back to published stories
          </Button>
          {!withdrawn && (
            <Button variant="primary" icon="pencil" onClick={() => navigate(Routes.article(article.id))}>
              Open in the composer
            </Button>
          )}
        </div>
      </div>
    );
  }

  const band = limits.limits[language];
  const count = measure(summary, limits, language);
  const state = bandState(count, band);
  const headlineShort = headline.trim().length < HEADLINE_MIN;
  const reasonReady = reason.trim().length >= REASON_MIN;

  const canSave =
    dirty && reasonReady && state === 'ok' && !headlineShort && !imagePending && !action.busy;

  /* Why Save is unavailable, in words — the same rule the composer follows
     rather than a tooltip on a disabled button. */
  const blocker = imagePending
    ? 'A picture is chosen but not attached. Press "Upload and attach", or Cancel it.'
    : !dirty
    ? 'Nothing has changed yet.'
    : headlineShort
      ? `The headline needs at least ${HEADLINE_MIN} characters.`
      : state !== 'ok'
        ? `The summary must be ${band.min}–${band.max} ${limits.limitType}.`
        : !reasonReady
          ? `Give a reason of at least ${REASON_MIN} characters.`
          : null;

  const save = async () => {
    if (!canSave) return;
    const ok = await action.run(
      () =>
        api.editPublished(article.id, {
          headline: headline.trim(),
          summary,
          /* Sent only when it changed. Absent means "leave the picture alone",
             which is not the same as null, which removes it. */
          ...(JSON.stringify(image) !== JSON.stringify(article.image) ? { image } : {}),
          reason: reason.trim(),
        }),
      'Saved. Readers get the corrected story the next time their feed refreshes.',
    );
    if (ok) {
      setReason('');
      reload();
    }
  };

  const withdraw = async () => {
    if (!reasonReady) return;
    const ok = await action.run(() => api.retractArticle(article.id, reason.trim()));
    if (ok) {
      /* To the withdrawn list, so the result is visible rather than inferred:
         the story is there, with the reason just given. */
      navigate(Routes.published({ tab: 'retracted' }));
    }
  };

  return (
    <div className="page">
      <h1 className="sr-only">Edit: {article.headline}</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs(listCrumb, { label: article.headline })} />
        <div className="detail-bar-actions">
          {dirty && <p className="page-sub">Unsaved changes</p>}
          <Badge tone="ok" icon="checkCircle">
            Live
          </Badge>
        </div>
      </div>

      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      <div className="composer">
        <Panel title="Edit the live story" headingLevel={2}>
          <Banner tone="info" live={false}>
            Readers can see this story now. Nothing here is saved until you press{' '}
            <strong>Save changes</strong>, and every change is recorded with your reason and the
            time.
          </Banner>

          <Field
            label="Headline"
            counter={
              <Counter state={headline.length > limits.headlineMaxChars ? 'over' : 'ok'}>
                {headline.length} / {limits.headlineMaxChars}
              </Counter>
            }
            note={
              headlineShort && headline.length > 0
                ? `A headline needs at least ${HEADLINE_MIN} characters.`
                : undefined
            }
            noteTone="warn"
          >
            {(f) => (
              <input
                {...f}
                className="input"
                lang={language}
                value={headline}
                maxLength={limits.headlineMaxChars}
                disabled={action.busy}
                onChange={(e) => setHeadline(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Summary"
            counter={
              <Counter state={state}>
                {count} / {band.min}–{band.max} {limits.limitType}
              </Counter>
            }
            note={
              state === 'under'
                ? `${band.min - count} more to go.`
                : state === 'over'
                  ? `${count - band.max} over the limit.`
                  : undefined
            }
            noteTone={state === 'over' ? 'bad' : 'warn'}
          >
            {(f) => (
              <textarea
                {...f}
                className="textarea textarea-prose"
                lang={language}
                value={summary}
                rows={7}
                disabled={action.busy}
                onChange={(e) => setSummary(e.target.value)}
              />
            )}
          </Field>

          {/* Suggests only: a live story's summary changes when Save is pressed
              with a reason, never because a draft arrived. */}
          <SummaryDraftBox
            articleId={data.article.id}
            initial={data.article.summaryDraft}
            summary={summary}
            canRegenerate={data.hasOriginal}
            fillWhenEmpty={false}
            sourceName={data.article.sourceName}
            disabled={action.busy}
            onUse={setSummary}
          />

          {/* Held on this screen until Save, unlike the composer, which attaches
              an upload the moment it finishes. A picture swapped on a live
              story is a correction like any other, and needs the same reason. */}
          <ImagePicker
            image={image}
            disabled={action.busy}
            onChange={setImage}
            onPendingChange={setImagePending}
          />

          <div className="edit-reason">
            <h3 className="edit-reason-title">Reason for this change</h3>
            <Field
              label="Reason (required)"
              note="Kept with the story and in the audit trail. Readers do not see it. At least ten characters."
              counter={
                <Counter state={reasonReady ? 'ok' : 'under'}>
                  {reason.trim().length} / {REASON_MIN}+
                </Counter>
              }
            >
              {(f) => (
                <input
                  {...f}
                  className="input"
                  required
                  aria-required="true"
                  maxLength={300}
                  placeholder="The minister’s name was misspelled in the headline"
                  value={reason}
                  disabled={action.busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="actions">
            <Button
              variant="primary"
              icon="check"
              busy={action.busy && !confirmingWithdraw}
              disabled={!canSave}
              onClick={() => void save()}
            >
              Save changes
            </Button>
            <Button
              icon="arrowLeft"
              disabled={action.busy}
              onClick={() => navigate(Routes.published())}
            >
              Cancel
            </Button>
            <span className="actions-spacer" />
            {!confirmingWithdraw && (
              <Button
                variant="danger"
                size="sm"
                icon="ban"
                disabled={action.busy || !reasonReady}
                onClick={() => setConfirmingWithdraw(true)}
              >
                Withdraw story
              </Button>
            )}
          </div>

          {blocker !== null && !confirmingWithdraw && <p className="field-note">{blocker}</p>}
          {!reasonReady && !confirmingWithdraw && (
            <p className="field-note">Withdrawing needs the same reason.</p>
          )}

          {confirmingWithdraw && (
            <div className="confirm-strip" role="alert">
              <p>
                <strong>Withdraw this story?</strong> Readers stop seeing it at once, and anyone
                holding its link gets a withdrawal notice. This cannot be undone.
              </p>
              <Button
                variant="danger"
                size="sm"
                icon="ban"
                busy={action.busy}
                disabled={!reasonReady}
                onClick={() => void withdraw()}
              >
                Yes, withdraw it
              </Button>
              <Button
                size="sm"
                disabled={action.busy}
                onClick={() => setConfirmingWithdraw(false)}
              >
                Keep it live
              </Button>
            </div>
          )}
        </Panel>

        <div className="panel sticky-aside">
          <div className="panel-body">
            <h2 className="panel-title">What readers see now</h2>
            <figure className="edit-live">
              <p className="edit-live-headline" lang={language}>
                {article.headline}
              </p>
              <p className="edit-live-summary" lang={language}>
                {article.summary}
              </p>
            </figure>

            <AdsOnStory key={article.id} id={article.id} suppressed={article.adsSuppressed} />

            <dl className="edit-record">
              <dt>Publisher</dt>
              <dd>{article.sourceName}</dd>
              {article.publishedAt !== null && (
                <>
                  <dt>Published</dt>
                  <dd title={dateTime(article.publishedAt) ?? undefined}>
                    {dateTime(article.publishedAt)}
                  </dd>
                </>
              )}
              <dt>Last edited</dt>
              <dd>
                {article.lastEditedAt === null ? (
                  'Never — this is the text as published.'
                ) : (
                  <>
                    {dateTime(article.lastEditedAt)} ({relativeTime(article.lastEditedAt)})
                  </>
                )}
              </dd>
              {article.lastEditReason !== null && (
                <>
                  <dt>Because</dt>
                  <dd>{article.lastEditReason}</dd>
                </>
              )}

            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
