import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type ArticleDetail,
  type ArticleImageData,
  type ClusterSibling,
  type Limits,
} from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { bandState, measure } from '../lib/measure';
import { articleStatus } from '../lib/status';
import { Routes, type ArticleTab } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Counter,
  EmptyState,
  Field,
  Icon,
  LinkButton,
  Panel,
  Skeleton,
  TabPanel,
  Tabs,
  type TabDef,
} from '../ui';
import { ImagePicker } from './ImagePicker';

/**
 * The composer.  Spec Ch. 5.4.
 *
 * Where an editor spends most of the three minutes, so it gets the most care:
 * the counter is unambiguous, autosave is visible but never in the way, and the
 * source article sits beside the summary rather than behind it.
 *
 * -- On the tabs, and a decision they had to respect -------------------------
 *
 * Ch. 5.4 is explicit that the source article belongs NEXT TO the summary and
 * not behind a tab, and it is right: you are rewriting that text, and a
 * rewrite you have to click back and forth to check is a rewrite that ends up
 * closer to the original than it should be.
 *
 * So the tabs are on the reference column, not across the screen, and Source is
 * the one that is open. What they replace is a stack — source, then reviewer
 * note, then a standing reminder — that simply ran down the page, where the
 * note an editor most needed to see sat below the fold on a laptop. Nothing has
 * moved behind a tab that was previously beside the summary; three things that
 * were BELOW each other are now in one place at the top.
 *
 * -- Three defects fixed here, none of them cosmetic -------------------------
 *
 * 1. A pending autosave was CANCELLED on unmount. The cleanup cleared the
 *    timer and stopped, so leaving the composer within 1.5 seconds of the last
 *    keystroke threw those words away — under a comment promising never to
 *    lose the editor's words. It now flushes instead.
 *
 * 2. Nothing warned before a tab was closed with unsaved text. Same loss, same
 *    window, and the browser will ask on our behalf if we tell it to.
 *
 * 3. Submitting for review did not check that the last save had SUCCEEDED. A
 *    failed autosave followed by a submit sent the reviewer the previous
 *    version of the summary, silently, while the editor watched their own text
 *    on screen.
 */

/** Long enough not to fire on every keystroke, short enough that a closed tab
 *  loses almost nothing (Ch. 5.6). */
const AUTOSAVE_MS = 1500;

/** Shorter than this is not a headline, and the server agrees. */
const HEADLINE_MIN = 10;

interface ComposerData {
  article: ArticleDetail;
  cluster: ClusterSibling[];
  limits: Limits;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function ComposerSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="detail-bar">
        <Skeleton height={16} width={220} />
      </div>
      <div className="composer">
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={11} width={80} />
            <Skeleton height={40} style={{ marginTop: 10, marginBottom: 28 }} />
            <Skeleton height={11} width={80} />
            <Skeleton height={170} style={{ marginTop: 10 }} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={11} width={110} style={{ marginBottom: 16 }} />
            <Skeleton height={13} />
            <Skeleton height={13} width="92%" style={{ marginTop: 8 }} />
            <Skeleton height={13} width="76%" style={{ marginTop: 8 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Composer({ id, tab }: { id: string; tab: ArticleTab }) {
  const { data, error: loadError, loading, reload } = useResource<ComposerData>(
    async (signal) => {
      const r = await api.article(id, signal);
      return { article: r.article, cluster: r.cluster, limits: r.limits };
    },
    `article:${id}`,
    'Could not open this story.',
  );

  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [image, setImage] = useState<ArticleImageData | null>(null);
  const [save, setSave] = useState<SaveState>('idle');

  const action = useAsyncAction();

  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  /*
   * The current text, readable from a callback that was created earlier.
   *
   * Assigning to a ref during render is deliberate here and elsewhere in this
   * codebase: it is what lets the autosave timer and the unmount cleanup read
   * what is on screen NOW, rather than what was on screen when they were
   * scheduled. Both are fire-once callbacks that outlive the render that made
   * them, which is exactly the case the pattern exists for.
   */
  const latest = useRef({ headline, summary });
  latest.current = { headline, summary };

  /*
   * Seeded once, from the first load.
   *
   * The story is reloaded after a transition so the header shows the new
   * status, and without this guard that reload would overwrite whatever the
   * editor had typed in the meantime with the server's copy.
   */
  const seeded = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (data === null || seeded.current) return;
    seeded.current = true;
    setHeadline(data.article.headline);
    setSummary(data.article.summary);
    setImage(data.article.image);
    dirty.current = false;
  }, [data]);

  /** Save now. Resolves true only if the server accepted it. */
  const persist = useCallback(
    async (patch: {
      headline?: string;
      summary?: string;
      image?: ArticleImageData | null;
    }): Promise<boolean> => {
      if (mounted.current) setSave('saving');
      try {
        await api.save(id, patch);
        dirty.current = false;
        if (mounted.current) setSave('saved');
        return true;
      } catch {
        /* The editor's words stay in the field. The next keystroke schedules
           another attempt, and the header says the last one failed — losing
           text to a dropped request is not an acceptable outcome, and a retry
           that overwrites what they are typing is not either. */
        if (mounted.current) setSave('error');
        return false;
      }
    },
    [id],
  );

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSave('idle');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void persist({ headline: latest.current.headline, summary: latest.current.summary });
    }, AUTOSAVE_MS);
  }, [persist]);

  /**
   * Leaving the composer flushes, rather than cancelling.
   *
   * The request is fired from the cleanup and outlives the component; there is
   * nowhere left to report a failure to, which is why the tab-close guard below
   * exists as well. Between them the only way to lose text is to close the tab
   * and then tell the browser you meant it.
   */
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (dirty.current) {
        void api
          .save(id, { headline: latest.current.headline, summary: latest.current.summary })
          .catch(() => undefined);
      }
    };
  }, [id]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      /* Both, on purpose: the modern spec says preventDefault, and older
         engines only honour returnValue. The browser shows its own wording —
         ours would be ignored — so there is no message to write. */
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /**
   * Run a lifecycle action, having first made sure the server has the text.
   *
   * The flush is not a nicety. Submitting with an unsaved edit outstanding
   * hands the reviewer the previous draft; submitting after a FAILED save does
   * the same thing and looks identical on screen, which is why the failure
   * stops the action rather than being logged past.
   */
  const act = useCallback(
    async (work: () => Promise<unknown>, okMessage: string) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      if (dirty.current) {
        const saved = await persist({
          headline: latest.current.headline,
          summary: latest.current.summary,
        });
        if (!saved) {
          action.setError(
            'Your last edit has not been saved, so nothing has been submitted. Check your connection and try again.',
          );
          return;
        }
      }

      const ok = await action.run(work, okMessage);
      if (ok) reload();
    },
    [action, persist, reload],
  );

  if (loadError !== null && data === null) {
    return (
      <div className="page">
        <Banner tone="error">{loadError}</Banner>
        <div className="actions actions-plain">
          <Button icon="arrowLeft" onClick={() => navigate(Routes.queue())}>
            Back to the queue
          </Button>
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || data === null) return <ComposerSkeleton />;

  const { article, cluster, limits } = data;
  const language = article.language;
  const band = limits.limits[language];
  const count = measure(summary, limits, language);
  const state = bandState(count, band);
  const look = articleStatus(article.status);

  const headlineTooShort = headline.trim().length < HEADLINE_MIN;
  const canSubmit = state === 'ok' && !headlineTooShort && !action.busy;
  const canPublish = article.status === 'approved' && !action.busy;

  const shownHeadline = headline.trim() === '' ? 'Untitled draft' : headline;

  const tabs: ReadonlyArray<TabDef<ArticleTab>> = [
    {
      value: 'source',
      label: 'Source',
      icon: 'fileText',
      /* The publisher plus everyone else running the story. A count is the
         whole reason to look, so it goes on the tab. */
      badge: cluster.length > 0 ? cluster.length + 1 : undefined,
    },
    {
      value: 'notes',
      label: 'Reviewer note',
      icon: 'pencil',
      badge: article.editorialNotes !== null ? 1 : undefined,
    },
    { value: 'guidance', label: 'Guidance', icon: 'info' },
  ];

  const idBase = `composer-${id}`;
  const goToTab = (next: ArticleTab) => navigate(Routes.article(id, next));

  return (
    <div className="page">
      <h1 className="sr-only">{shownHeadline}</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Queue', route: Routes.queue() }, { label: shownHeadline })}
        />
        <div className="detail-bar-actions">
          <SaveHint state={save} />
          <Badge tone={look.tone} icon={look.icon}>
            {look.label}
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
        <Panel title="Summary" headingLevel={2}>
          {cluster.length > 0 && (
            <Banner tone="info" live={false}>
              <strong>{cluster.length + 1} sources are covering this story.</strong> Summarise it
              once — the others will be spiked as duplicates. They are listed under Source.
            </Banner>
          )}

          <Field
            label="Headline"
            counter={
              <Counter state={headline.length > limits.headlineMaxChars ? 'over' : 'ok'}>
                {headline.length} / {limits.headlineMaxChars}
              </Counter>
            }
            note={
              headlineTooShort && headline.length > 0
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
                onChange={(e) => {
                  setHeadline(e.target.value);
                  scheduleSave();
                }}
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
                ? `${band.min - count} more to go. A short summary reads as low effort.`
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
                rows={9}
                onChange={(e) => {
                  setSummary(e.target.value);
                  scheduleSave();
                }}
                onKeyDown={(e) => {
                  // Ctrl/Cmd+Enter submits for review (Ch. 5.5).
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSubmit) {
                    e.preventDefault();
                    void act(() => api.transition(id, 'in_review'), 'Submitted for review.');
                  }
                }}
              />
            )}
          </Field>

          {/*
            * Saved the moment it changes rather than on the autosave timer. An
            * upload is a deliberate act with a visible result, and leaving it
            * unsaved for 1.5 seconds means a closed tab loses a file the editor
            * watched finish uploading.
            */}
          <ImagePicker
            image={image}
            disabled={action.busy}
            onChange={(next) => {
              setImage(next);
              void persist({ image: next });
            }}
          />

          <div className="actions">
            <Button
              variant="primary"
              icon="send"
              busy={action.busy}
              disabled={!canSubmit}
              onClick={() => void act(() => api.transition(id, 'in_review'), 'Submitted for review.')}
            >
              Submit for review
            </Button>
            <Button
              icon="checkCircle"
              disabled={!canPublish}
              onClick={() => void act(() => api.publish(id), 'Published.')}
            >
              Publish
            </Button>
            <span className="actions-spacer" />
            <Button
              variant="danger"
              size="sm"
              icon="ban"
              disabled={action.busy}
              onClick={() => void act(() => api.transition(id, 'spiked'), 'Spiked.')}
            >
              Spike
            </Button>
          </div>

          {/*
            * Why Publish is unavailable, in text.
            *
            * It was a `title` attribute, which never appears on a touch device,
            * is not read by most screen readers on a disabled control, and
            * requires hovering a button you have already decided not to press.
            */}
          {article.status !== 'approved' && (
            <p className="field-note">
              Publishing is available once a reviewer has approved this story.
            </p>
          )}

          <p className="field-note">
            <span className="kbd">Ctrl</span> <span className="kbd">↵</span> submits for review.
          </p>
        </Panel>

        <div className="panel">
          <div className="panel-body">
            <Tabs
              tabs={tabs}
              value={tab}
              onChange={goToTab}
              idBase={idBase}
              aria-label="Reference material for this story"
            />

            <TabPanel value="source" current={tab} idBase={idBase}>
              <p className="item-title" lang={language}>
                {article.headline}
              </p>
              <p className="meta-line" style={{ marginTop: 4 }}>
                <span>{article.sourceName}</span>
                {article.publisherAuthor !== null && <span>{article.publisherAuthor}</span>}
              </p>

              <div className="actions actions-plain">
                <LinkButton
                  size="sm"
                  iconAfter="externalLink"
                  href={article.publisherUrl}
                  target="_blank"
                >
                  Open the original
                </LinkButton>
              </div>

              {cluster.length > 0 && (
                <>
                  <h3 className="field-legend" style={{ marginTop: 'var(--s6)' }}>
                    Also covering this
                  </h3>
                  <ul className="stack-tight" style={{ listStyle: 'none' }}>
                    {cluster.map((sibling) => (
                      <li className="meta-line" key={sibling.id}>
                        <span>{sibling.sourceName}</span>
                        <span lang={sibling.language}>{sibling.headline}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </TabPanel>

            <TabPanel value="notes" current={tab} idBase={idBase}>
              {article.editorialNotes === null ? (
                <EmptyState icon="pencil" title="No reviewer note" compact>
                  A reviewer can leave a note when they send a story back. There is none on this
                  one.
                </EmptyState>
              ) : (
                <p className="prose prose-scroll">{article.editorialNotes}</p>
              )}
            </TabPanel>

            <TabPanel value="guidance" current={tab} idBase={idBase}>
              <h3 className="field-legend">Write it in your own words</h3>
              <p className="prose">
                Pasting the publisher’s sentences and lightly editing them is the fastest route to a
                copyright complaint. Read the original, then close it and write the summary from
                what you remember of it.
              </p>

              <h3 className="field-legend" style={{ marginTop: 'var(--s6)' }}>
                Pictures
              </h3>
              <p className="prose">
                An uncredited photograph is the highest legal risk this product carries. Publishing
                refuses an image without a recognised licence, and the moment you attach the file is
                the last point at which anyone still knows where it came from.
              </p>

              <h3 className="field-legend" style={{ marginTop: 'var(--s6)' }}>
                Length
              </h3>
              <p className="prose">
                The band is {band.min}–{band.max} {limits.limitType} for{' '}
                {language === 'ne' ? 'Nepali' : 'English'}. Nepali is counted in characters as a
                reader sees them, so a conjunct counts once rather than three times.
              </p>
            </TabPanel>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Autosave, reported.
 *
 * `role="status"` so the outcome is announced politely rather than silently —
 * an editor who cannot see the header is otherwise given no indication that a
 * save failed. The element keeps a minimum height whatever it says, so the
 * header does not shift every time the word changes.
 */
function SaveHint({ state }: { state: SaveState }) {
  return (
    <p className={state === 'error' ? 'savehint savehint-error' : 'savehint'} role="status">
      {state === 'saving' && (
        <>
          <span className="spinner" aria-hidden="true" /> Saving…
        </>
      )}
      {state === 'saved' && (
        <>
          <Icon name="checkCircle" /> Saved
        </>
      )}
      {state === 'error' && (
        <>
          <Icon name="alertCircle" /> Not saved — will retry
        </>
      )}
    </p>
  );
}
