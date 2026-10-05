import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  api,
  problemsOf,
  type FieldProblem,
  type InteractionInputData,
  type InteractionRow,
  type InteractionType,
  type NewStoryOptions,
  type OptionImageData,
} from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime } from '../lib/format';
import { INTERACTION_LIMITS, interactionProblems } from '../lib/interactions';
import { mediaUrl } from '../lib/media';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Counter,
  Field,
  FileDrop,
  Fieldset,
  Listbox,
  Panel,
  Segmented,
  Skeleton,
} from '../ui';
import { InteractionCard, TYPE_LABEL } from './Interactions';

/**
 * Making and running one Interaction.
 *
 * A draft is the whole form: rating or vote, the question, its businesses or
 * candidates with their photos, the dates — with the card as a reader will see
 * it alongside, redrawn as the editor types. Each problem is shown on its own
 * field (lib/interactions, the same rules the server enforces), but only once
 * the field has been touched or Save pressed: a new form covered in red before
 * anyone has typed is a form that shouts.
 *
 * Once published, the options are locked — readers answered what they saw.
 * What is left is the card with its results, the closing date, and Close now.
 */

interface OptionDraft {
  /** React's key: stable while the editor types, unlike the name. */
  key: string;
  id?: string;
  name: string;
  detail: string;
  image: OptionImageData | null;
  /** The credit typed before the photo is chosen; the upload needs it. */
  credit: string;
}

interface Draft {
  type: InteractionType;
  language: 'ne' | 'en';
  categorySlug: string;
  title: string;
  options: OptionDraft[];
  /** datetime-local values, '' for "when published" and "never". */
  opensAt: string;
  closesAt: string;
}

const NO_SECTION = '__none';

const count = (n: number, max: number) => (
  <Counter state={n > max ? 'over' : 'ok'}>
    {n} / {max}
  </Counter>
);
let keySeq = 0;
const newKey = () => `o${++keySeq}`;

const blankOption = (): OptionDraft => ({ key: newKey(), name: '', detail: '', image: null, credit: '' });

/** yyyy-mm-ddThh:mm in the browser's own time, as datetime-local wants. */
function toLocal(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocal = (v: string): string | null => (v === '' ? null : new Date(v).toISOString());

/** A week from now, at the end of that evening: a sensible default for a vote. */
function aWeekOn(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  d.setHours(20, 0, 0, 0);
  return toLocal(d.toISOString());
}

function blankDraft(): Draft {
  return {
    type: 'vote',
    language: 'ne',
    categorySlug: NO_SECTION,
    title: '',
    options: [blankOption(), blankOption()],
    opensAt: '',
    closesAt: aWeekOn(),
  };
}

function draftFrom(row: InteractionRow): Draft {
  return {
    type: row.type,
    language: row.language,
    categorySlug: row.categorySlug ?? NO_SECTION,
    title: row.title,
    options: row.options.map((o) => ({
      key: newKey(),
      id: o.id,
      name: o.name,
      detail: o.detail ?? '',
      image: o.image,
      credit: o.image?.credit ?? '',
    })),
    opensAt: row.status === 'draft' ? toLocal(row.opensAt) : toLocal(row.opensAt),
    closesAt: toLocal(row.closesAt),
  };
}

function toInput(d: Draft): InteractionInputData {
  return {
    type: d.type,
    language: d.language,
    categorySlug: d.categorySlug === NO_SECTION ? null : d.categorySlug,
    title: d.title,
    options: d.options.map((o) => ({
      ...(o.id !== undefined ? { id: o.id } : {}),
      name: o.name,
      detail: o.detail.trim() === '' ? null : o.detail,
      image: o.image,
    })),
    opensAt: fromLocal(d.opensAt),
    closesAt: fromLocal(d.closesAt),
  };
}

/* ─────────────────────────────────────────────────────────── one option */

function OptionEditor({
  index,
  type,
  o,
  disabled,
  problem,
  onChange,
  onRemove,
  onTouch,
}: {
  index: number;
  type: InteractionType;
  o: OptionDraft;
  disabled: boolean;
  problem: (field: string) => string | null;
  onChange: (next: OptionDraft) => void;
  onRemove: (() => void) | null;
  onTouch: (field: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const noun = type === 'vote' ? 'Candidate' : 'Business';
  const nameProblem = problem(`options.${index}.name`);
  const detailProblem = problem(`options.${index}.detail`);
  const imageProblem = problem(`options.${index}.image`);
  const src = mediaUrl(o.image?.urls.md ?? o.image?.urls.sm ?? null);

  const onFile = async (file: File) => {
    const credit = o.credit.trim();
    if (credit.length < INTERACTION_LIMITS.credit.min) {
      setUploadError('Write the photo credit first — who took it, or whose it is.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('That file is over 15 MB. Use a smaller copy of the photo.');
      return;
    }
    setBusy(true);
    setUploadError(null);
    try {
      const { image } = await api.uploadOptionImage(file, credit);
      onChange({ ...o, image });
      onTouch(`options.${index}.image`);
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ix-option">
      <div className="ix-option-head">
        <p className="field-heading">
          {noun} {index + 1}
        </p>
        {onRemove !== null && (
          <Button size="sm" variant="ghost" icon="trash" disabled={disabled} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid">
        <div className="col-6">
          <Field
            label="Name"
            invalid={nameProblem !== null}
            note={nameProblem ?? undefined}
            noteTone={nameProblem !== null ? 'bad' : 'default'}
            counter={count(o.name.trim().length, INTERACTION_LIMITS.name.max)}
          >
            {(f) => (
              <input
                {...f}
                className="input"
                disabled={disabled}
                maxLength={INTERACTION_LIMITS.name.max + 20}
                value={o.name}
                onChange={(e) => onChange({ ...o, name: e.target.value })}
                onBlur={() => onTouch(`options.${index}.name`)}
              />
            )}
          </Field>
        </div>
        <div className="col-6">
          <Field
            label="Detail"
            optional="optional"
            invalid={detailProblem !== null}
            note={detailProblem ?? (type === 'vote' ? 'A party, a place, a role.' : 'The area, such as “Patan”.')}
            noteTone={detailProblem !== null ? 'bad' : 'default'}
          >
            {(f) => (
              <input
                {...f}
                className="input"
                disabled={disabled}
                maxLength={INTERACTION_LIMITS.detail.max + 20}
                value={o.detail}
                onChange={(e) => onChange({ ...o, detail: e.target.value })}
                onBlur={() => onTouch(`options.${index}.detail`)}
              />
            )}
          </Field>
        </div>

        <div className="col-12">
          {uploadError !== null && <Banner tone="error">{uploadError}</Banner>}
          {src !== null ? (
            <div className="ad-image">
              <img className="ix-option-photo" src={src} alt="" />
              <div className="ad-image-actions">
                <p className="meta-line">
                  <span>Photo: {o.image?.credit}</span>
                  <span>cropped square</span>
                </p>
                <Button
                  size="sm"
                  icon="trash"
                  disabled={disabled || busy}
                  onClick={() => onChange({ ...o, image: null })}
                >
                  Remove photo
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid">
              <div className="col-6">
                <Field
                  label="Photo credit"
                  optional={type === 'rating' ? 'optional' : undefined}
                  invalid={imageProblem !== null}
                  note={imageProblem ?? 'Printed with the photo. Needed before uploading.'}
                  noteTone={imageProblem !== null ? 'bad' : 'default'}
                >
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      disabled={disabled || busy}
                      maxLength={INTERACTION_LIMITS.credit.max}
                      value={o.credit}
                      onChange={(e) => onChange({ ...o, credit: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="col-6">
                <FileDrop
                  accept="image/jpeg,image/png,image/webp"
                  disabled={disabled || busy}
                  icon="image"
                  title={type === 'vote' ? 'Choose the candidate’s photo' : 'Choose a photo or logo'}
                  hint="JPEG, PNG or WebP, at most 15 MB, at least 320px on the shorter side. It is cropped square."
                  onSelect={(file) => void onFile(file)}
                  onReject={setUploadError}
                />
                {busy && (
                  <p className="field-note" role="status">
                    <span className="spinner" aria-hidden="true" /> Uploading…
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── the screen */

export function InteractionEditor({ id }: { id: string | null }) {
  const detail = useResource<{ interaction: InteractionRow } | null>(
    async (signal) => (id === null ? null : api.interaction(id, signal)),
    `interaction:${id ?? 'new'}`,
    'Could not open this Interaction.',
  );
  const options = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections.',
  );

  const action = useAsyncAction('Could not save the Interaction.');
  const [d, setD] = useState<Draft>(blankDraft);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [serverProblems, setServerProblems] = useState<FieldProblem[]>([]);
  const [confirming, setConfirming] = useState<'publish' | 'close' | 'delete' | null>(null);
  const [closesAtLive, setClosesAtLive] = useState('');

  const seededFrom = useRef<string | null>(null);
  useEffect(() => {
    const row = detail.data?.interaction;
    if (!row) return;
    const stamp = JSON.stringify(row);
    if (seededFrom.current === stamp) return;
    seededFrom.current = stamp;
    setD(draftFrom(row));
    setClosesAtLive(toLocal(row.closesAt));
  }, [detail.data]);

  const touch = (field: string) => setTouched((t) => (t.has(field) ? t : new Set(t).add(field)));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setD((prev) => ({ ...prev, [key]: value }));
    setServerProblems([]);
  };

  const problems = useMemo(
    () =>
      interactionProblems({
        type: d.type,
        title: d.title,
        options: d.options.map((o) => ({
          name: o.name,
          detail: o.detail.trim() === '' ? null : o.detail,
          image: o.image,
        })),
        opensAt: fromLocal(d.opensAt),
        closesAt: fromLocal(d.closesAt),
      }),
    [d],
  );

  const problemFor = (field: string): string | null => {
    const server = serverProblems.find((p) => p.field === field);
    if (server) return server.message;
    if (!showAll && !touched.has(field)) return null;
    return problems.find((p) => p.field === field)?.message ?? null;
  };

  const row = detail.data?.interaction ?? null;
  const isDraft = row === null || row.status === 'draft';
  const range = INTERACTION_LIMITS.options[d.type];
  const noun = d.type === 'vote' ? 'candidate' : 'business';
  const categories = options.data?.categories ?? [];

  if (id !== null && detail.error !== null && detail.data === null) {
    return (
      <div className="page">
        <Banner tone="error">{detail.error}</Banner>
        <div className="actions actions-plain">
          <Button icon="arrowLeft" onClick={() => navigate(Routes.interactions())}>
            Back to Interactions
          </Button>
        </div>
      </div>
    );
  }
  if (id !== null && (detail.loading || detail.data === null)) {
    return (
      <div className="page" aria-busy="true">
        <div className="detail-bar">
          <Skeleton height={16} width={240} />
        </div>
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={40} />
            <Skeleton height={140} style={{ marginTop: 20 }} />
          </div>
        </div>
      </div>
    );
  }

  /** Save the draft. Resolves to its id, or null when it was refused. */
  const save = async (): Promise<string | null> => {
    setShowAll(true);
    if (problems.length > 0) {
      action.setError(`Fix ${problems.length === 1 ? 'the problem' : `the ${problems.length} problems`} marked below first.`);
      return null;
    }
    let savedId: string | null = null;
    const ok = await action.run(async () => {
      try {
        const r = id === null ? await api.createInteraction(toInput(d)) : await api.editInteraction(id, toInput(d));
        savedId = r.interaction.id;
      } catch (e) {
        setServerProblems(problemsOf(e));
        throw e;
      }
    }, 'Saved.');
    if (ok && id === null && savedId !== null) navigate(Routes.interaction(savedId), { replace: true });
    else if (ok) detail.reload();
    return ok ? savedId : null;
  };

  const publish = async () => {
    setConfirming(null);
    const savedId = await save();
    if (savedId === null) return;
    const ok = await action.run(() => api.publishInteraction(savedId), 'Published. It is now in the app’s feed.');
    if (ok) {
      if (id === null) navigate(Routes.interaction(savedId), { replace: true });
      else detail.reload();
    }
  };

  const closeNow = async () => {
    if (id === null) return;
    setConfirming(null);
    if (await action.run(() => api.closeInteraction(id), 'Closed. Its results are final.')) detail.reload();
  };

  const remove = async () => {
    if (id === null) return;
    setConfirming(null);
    if (await action.run(() => api.deleteInteraction(id))) navigate(Routes.interactions({ tab: 'drafts' }));
  };

  const moveClosing = async () => {
    if (id === null) return;
    const ok = await action.run(
      () => api.editInteraction(id, { closesAt: fromLocal(closesAtLive) }),
      'Closing date changed.',
    );
    if (ok) detail.reload();
  };

  const title = id === null ? 'New Interaction' : row?.title || 'Interaction';
  const titleProblem = problemFor('title');
  const closesProblem = problemFor('closesAt');
  const opensProblem = problemFor('opensAt');
  const optionsProblem = problemFor('options');

  return (
    <div className="page">
      <h1 className="sr-only">{title}</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Interactions', route: Routes.interactions() }, { label: title })}
        />
        <div className="detail-bar-actions">
          {isDraft ? (
            <>
              {id !== null && (
                <Button size="sm" icon="trash" disabled={action.busy} onClick={() => setConfirming('delete')}>
                  Delete
                </Button>
              )}
              <Button disabled={action.busy} onClick={() => void save()}>
                Save draft
              </Button>
              <Button variant="primary" icon="send" disabled={action.busy} onClick={() => setConfirming('publish')}>
                Publish
              </Button>
            </>
          ) : (
            row?.phase !== 'closed' && (
              <Button icon="ban" disabled={action.busy} onClick={() => setConfirming('close')}>
                Close now
              </Button>
            )
          )}
        </div>
      </div>

      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      {confirming !== null && (
        <div className="confirm-strip" role="alert">
          <p>
            {confirming === 'publish'
              ? `Publish it to the app? Once readers can answer, its ${noun === 'business' ? 'businesses' : 'candidates'}, names and photos cannot change.`
              : confirming === 'close'
                ? 'Close it now? Readers can no longer answer, and the results become final.'
                : 'Delete this draft? This cannot be undone.'}
          </p>
          <div className="actions actions-plain">
            <Button
              variant={confirming === 'delete' ? 'danger' : 'primary'}
              disabled={action.busy}
              onClick={() => void (confirming === 'publish' ? publish() : confirming === 'close' ? closeNow() : remove())}
            >
              {confirming === 'publish' ? 'Publish now' : confirming === 'close' ? 'Close now' : 'Delete'}
            </Button>
            <Button disabled={action.busy} onClick={() => setConfirming(null)}>
              Not yet
            </Button>
          </div>
        </div>
      )}

      <div className="grid">
        <div className="col-7">
          {isDraft ? (
            <Panel title="The question">
              <div className="grid">
                <div className="col-6">
                  <Fieldset legend="Kind">
                    {(g) => (
                      <Segmented
                        {...g}
                        aria-label="Kind"
                        value={d.type}
                        onChange={(v) => {
                          set('type', v);
                          if (v === 'vote' && d.closesAt === '') set('closesAt', aWeekOn());
                        }}
                        options={[
                          { value: 'vote', label: 'Vote' },
                          { value: 'rating', label: 'Rating' },
                        ]}
                      />
                    )}
                  </Fieldset>
                </div>
                <div className="col-6">
                  <Fieldset legend="Readers">
                    {(g) => (
                      <Segmented
                        {...g}
                        aria-label="Language"
                        value={d.language}
                        onChange={(v) => set('language', v)}
                        options={[
                          { value: 'ne', label: 'नेपाली', lang: 'ne' },
                          { value: 'en', label: 'English', lang: 'en' },
                        ]}
                      />
                    )}
                  </Fieldset>
                </div>

                <div className="col-12">
                  <Field
                    label={d.type === 'vote' ? 'Question' : 'Title'}
                    invalid={titleProblem !== null}
                    note={
                      titleProblem ??
                      (d.type === 'vote' ? 'What readers are choosing between.' : 'For example, “Best coffee in Kathmandu”.')
                    }
                    noteTone={titleProblem !== null ? 'bad' : 'default'}
                    counter={count(d.title.trim().length, INTERACTION_LIMITS.title.max)}
                  >
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        lang={d.language}
                        maxLength={INTERACTION_LIMITS.title.max + 40}
                        value={d.title}
                        onChange={(e) => set('title', e.target.value)}
                        onBlur={() => touch('title')}
                      />
                    )}
                  </Field>
                </div>

                <div className="col-12">
                  <Field label="Section" note="Shown in this section and in the top feed. None: the top feed only.">
                    {(f) => (
                      <Listbox
                        {...f}
                        value={d.categorySlug}
                        onChange={(v) => set('categorySlug', v)}
                        options={[
                          { value: NO_SECTION, label: 'No section — top feed only' },
                          ...categories.map((c) => ({
                            value: c.slug,
                            label: d.language === 'ne' ? c.label.ne : c.label.en,
                          })),
                        ]}
                      />
                    )}
                  </Field>
                </div>

                <div className="col-6">
                  <Field
                    label="Opens"
                    optional="optional"
                    invalid={opensProblem !== null}
                    note={opensProblem ?? 'Empty: as soon as it is published.'}
                    noteTone={opensProblem !== null ? 'bad' : 'default'}
                  >
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        type="datetime-local"
                        value={d.opensAt}
                        onChange={(e) => set('opensAt', e.target.value)}
                        onBlur={() => touch('opensAt')}
                      />
                    )}
                  </Field>
                </div>
                <div className="col-6">
                  <Field
                    label="Closes"
                    optional={d.type === 'rating' ? 'optional' : undefined}
                    invalid={closesProblem !== null}
                    note={closesProblem ?? (d.type === 'rating' ? 'Empty: open until you close it.' : undefined)}
                    noteTone={closesProblem !== null ? 'bad' : 'default'}
                  >
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        type="datetime-local"
                        min={d.opensAt || undefined}
                        value={d.closesAt}
                        onChange={(e) => set('closesAt', e.target.value)}
                        onBlur={() => touch('closesAt')}
                      />
                    )}
                  </Field>
                </div>
              </div>

              {d.type === 'vote' && (
                <Banner tone="info" live={false}>
                  A vote about candidates in an election can be restricted during an election period. Check the
                  Election Commission’s code of conduct before publishing one.
                </Banner>
              )}
            </Panel>
          ) : (
            row !== null && (
              <Panel title="Running">
                <p className="meta-line">
                  <Badge tone={row.phase === 'open' ? 'ok' : row.phase === 'scheduled' ? 'accent' : 'neutral'}>
                    {row.phase === 'open' ? 'Open' : row.phase === 'scheduled' ? 'Opens later' : 'Closed'}
                  </Badge>
                  <span>{TYPE_LABEL[row.type]}</span>
                  {row.opensAt !== null && <span>Opened {dateTime(row.opensAt)}</span>}
                  {row.closedAt !== null && <span>Closed {dateTime(row.closedAt)}</span>}
                </p>
                <p className="field-note">
                  Readers have answered what they saw, so its {noun === 'business' ? 'businesses' : 'candidates'}{' '}
                  and photos are locked.
                </p>
                {row.phase !== 'closed' && (
                  <div className="grid">
                    <div className="col-6">
                      <Field
                        label="Closes"
                        optional={row.type === 'rating' ? 'optional' : undefined}
                        note={row.type === 'rating' ? 'Empty: open until you close it.' : undefined}
                      >
                        {(f) => (
                          <input
                            {...f}
                            className="input"
                            type="datetime-local"
                            value={closesAtLive}
                            onChange={(e) => setClosesAtLive(e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                    <div className="col-6">
                      <div className="actions actions-plain">
                        <Button
                          disabled={action.busy || closesAtLive === toLocal(row.closesAt)}
                          onClick={() => void moveClosing()}
                        >
                          Change closing date
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Panel>
            )
          )}

          {isDraft && (
            <Panel
              title={d.type === 'vote' ? 'Candidates' : 'Businesses'}
              note={`${d.options.length} of ${range.max}${d.type === 'vote' ? ' · each needs a photo' : ' · photos optional'}`}
            >
              {optionsProblem !== null && <Banner tone="error">{optionsProblem}</Banner>}
              {d.options.map((o, i) => (
                <OptionEditor
                  key={o.key}
                  index={i}
                  type={d.type}
                  o={o}
                  disabled={action.busy}
                  problem={problemFor}
                  onTouch={touch}
                  onChange={(next) => set('options', d.options.map((x) => (x.key === o.key ? next : x)))}
                  onRemove={
                    d.options.length > range.min
                      ? () => set('options', d.options.filter((x) => x.key !== o.key))
                      : null
                  }
                />
              ))}
              <div className="actions actions-plain">
                <Button
                  icon="plus"
                  disabled={action.busy || d.options.length >= range.max}
                  title={d.options.length >= range.max ? `At most ${range.max}` : undefined}
                  onClick={() => set('options', [...d.options, blankOption()])}
                >
                  Add a {noun}
                </Button>
              </div>
            </Panel>
          )}
        </div>

        <div className="col-5">
          <Panel title={isDraft ? 'In the app' : 'Results'} note={isDraft ? 'How readers will see it' : undefined}>
            <InteractionCard
              type={isDraft ? d.type : row!.type}
              language={isDraft ? d.language : row!.language}
              title={isDraft ? d.title : row!.title}
              options={
                isDraft
                  ? d.options.map((o) => ({ name: o.name, detail: o.detail.trim() || null, image: o.image }))
                  : row!.options
              }
              results={isDraft ? null : row!.results}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
