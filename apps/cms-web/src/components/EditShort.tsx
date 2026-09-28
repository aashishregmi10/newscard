import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type ImageLicence,
  type NewStoryOptions,
  type ShortDetail,
  type UploadedVideo,
} from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime, fileSize, relativeTime } from '../lib/format';
import { LICENCES } from '../lib/licences';
import { mediaUrl } from '../lib/media';
import { shortStatus } from '../lib/status';
import { Routes, type Role } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Counter,
  Field,
  Fieldset,
  FileDrop,
  Listbox,
  Panel,
  Segmented,
  Skeleton,
} from '../ui';

/**
 * Editing a short.
 *
 * -- One screen, three sets of rules -----------------------------------------
 *
 * A DRAFT is the newsroom's own business: anyone who may write can change it,
 * nothing is asked of them, and Publish sits beside Save.
 *
 * A LIVE short is what readers are being shown, so it follows the rule a live
 * story follows: only someone who may publish can change it, every change needs
 * a reason, and the time and reason are stamped on the record. Withdraw sits
 * beside Save and shares that reason.
 *
 * A WITHDRAWN short is final. It is shown, and can be watched, but not changed.
 *
 * -- Why the clip can be replaced -------------------------------------------
 *
 * A wrong file is the likeliest mistake there is on a video upload, and the
 * only fix used to be uploading the right one as a second short and leaving
 * the first behind. The replacement is transcoded the moment it is chosen,
 * exactly as on the upload form, and is not attached until Save.
 *
 * -- Why the publisher cannot be changed ------------------------------------
 *
 * It decides which licence the short was filed under. A clip from a different
 * publisher is a different short, and is uploaded as one.
 */

const TITLE_MAX = 80;
const CAPTION_MAX = 400;
/** Matches the server, which refuses anything shorter. */
const REASON_MIN = 10;

interface Data {
  short: ShortDetail;
}

function EditSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="detail-bar">
        <Skeleton height={16} width={240} />
      </div>
      <div className="grid">
        <div className="col-4">
          <div className="panel">
            <div className="panel-body">
              <Skeleton height={320} />
            </div>
          </div>
        </div>
        <div className="col-8">
          <div className="panel">
            <div className="panel-body">
              <Skeleton height={40} style={{ marginBottom: 20 }} />
              <Skeleton height={40} style={{ marginBottom: 20 }} />
              <Skeleton height={90} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The medium rendition when there is one: what most readers are served. */
function previewSrc(renditions: ShortDetail['renditions']): string | null {
  const pick =
    renditions.find((r) => r.quality === 'medium') ??
    renditions.find((r) => r.quality === 'low') ??
    renditions[0];
  return pick === undefined ? null : mediaUrl(pick.url);
}

export function EditShort({ id, role }: { id: string; role: Role }) {
  const { data, error: loadError, loading, reload } = useResource<Data>(
    (signal) => api.short(id, signal),
    `short:${id}`,
    'Could not open this short.',
  );
  const { data: options } = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections.',
  );

  const action = useAsyncAction();

  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [categorySlug, setCategorySlug] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState<ImageLicence>('own');
  const [reason, setReason] = useState('');

  /** A replacement clip, transcoded and waiting for Save. Null means unchanged. */
  const [clip, setClip] = useState<UploadedVideo | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  /*
   * Seeded from every load. A reload only ever follows a successful save or
   * publish, at which point the server's copy is what is on screen — so this is
   * what makes the fields, the badge and the record agree afterwards.
   */
  useEffect(() => {
    if (data === null) return;
    const s = data.short;
    setLanguage(s.language);
    setCategorySlug(s.categorySlug);
    setTitle(s.title);
    setCaption(s.caption);
    setCredit(s.credit);
    setLicence(s.licence);
  }, [data]);

  const short = data?.short ?? null;

  const dirty =
    short !== null &&
    (clip !== null ||
      language !== short.language ||
      categorySlug !== short.categorySlug ||
      title !== short.title ||
      caption !== short.caption ||
      credit !== short.credit ||
      licence !== short.licence);

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
          <Button icon="arrowLeft" onClick={() => navigate(Routes.shorts())}>
            Back to shorts
          </Button>
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || short === null) return <EditSkeleton />;

  const look = shortStatus(short.status);
  const isDraft = short.status === 'draft';
  const live = short.status === 'published';
  const withdrawn = short.status === 'retracted';
  /* Publishing, editing a live short and withdrawing one all belong to the
     same two roles on the server. */
  const mayPublish = role !== 'author';
  const readOnly = withdrawn || (live && !mayPublish) || action.busy;

  const categories = options?.categories ?? [];
  const reasonReady = reason.trim().length >= REASON_MIN;
  const complete = title.trim() !== '' && caption.trim() !== '' && credit.trim() !== '';

  const canSave =
    dirty && complete && !readOnly && !uploading && (!live || reasonReady) && categorySlug !== '';

  const blocker = !dirty
    ? 'Nothing has changed yet.'
    : !complete
      ? 'A title, a caption and a credit are all required.'
      : uploading
        ? 'Wait for the new clip to finish transcoding.'
        : live && !reasonReady
          ? `Give a reason of at least ${REASON_MIN} characters.`
          : null;

  const discardClip = () => {
    setClip(null);
    setReplacing(false);
    setUploadError(null);
  };

  const onFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const { video } = await api.uploadVideo(file, credit.trim() === '' ? 'Pending' : credit.trim());
      setClip(video);
      setReplacing(false);
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    const ok = await action.run(
      () =>
        api.editShort(short.id, {
          language,
          categorySlug,
          title: title.trim(),
          caption: caption.trim(),
          credit: credit.trim(),
          licence,
          ...(clip === null
            ? {}
            : {
                clip: {
                  durationSeconds: clip.durationSeconds,
                  posterUrl: clip.posterUrl,
                  posterBlurHash: clip.posterBlurHash,
                  renditions: clip.renditions,
                },
              }),
          ...(live ? { reason: reason.trim() } : {}),
        }),
      live
        ? 'Saved. Readers get the corrected short the next time the tab refreshes.'
        : 'Saved.',
    );
    if (ok) {
      setClip(null);
      setReason('');
      reload();
    }
  };

  const publish = async () => {
    if (dirty) return;
    const ok = await action.run(() => api.publishShort(short.id), 'Published.');
    if (ok) reload();
  };

  const withdraw = async () => {
    if (!reasonReady) return;
    const ok = await action.run(() => api.retractShort(short.id, reason.trim()));
    /* Back to the library, where the short now reads Withdrawn with the reason
       just given — the result seen rather than inferred. */
    if (ok) navigate(Routes.shorts());
  };

  /* The clip on screen: the replacement if there is one, else the saved one. */
  const shownPoster = clip?.posterUrl ?? short.posterUrl;
  const shownRenditions = clip?.renditions ?? short.renditions;
  const shownDuration = clip?.durationSeconds ?? short.durationSeconds;

  const clipPanel = (
    <Panel title={clip === null ? 'The clip' : 'The new clip'}>
      <div className="clip-summary">
        {/*
          * The player, not only the poster. The one question the poster cannot
          * answer is whether the right few seconds were captured, and on this
          * screen someone may be checking exactly that before changing words
          * around it. `preload="none"` so opening the screen fetches only the
          * poster, as the reader app does.
          */}
        <video
          key={shownPoster}
          className="clip-poster clip-player"
          controls
          preload="none"
          poster={mediaUrl(shownPoster)}
          src={previewSrc(shownRenditions) ?? undefined}
        />

        <div>
          <p className="meta-line">
            <span>{shownDuration}s</span>
            <span>{shownRenditions.length} renditions</span>
          </p>
          <ul className="clip-renditions" style={{ marginTop: 'var(--s2)' }}>
            {shownRenditions.map((r) => (
              <li key={r.quality}>
                <span className="clip-quality">{r.quality}</span>
                <span>
                  {r.width}×{r.height}
                </span>
                <span>{fileSize(r.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>

        {clip !== null ? (
          <>
            <p className="field-note">Not attached until you press Save changes.</p>
            <Button size="sm" icon="x" block disabled={action.busy} onClick={discardClip}>
              Keep the current clip
            </Button>
          </>
        ) : readOnly ? null : replacing ? (
          <>
            <FileDrop
              accept="video/*"
              disabled={uploading || action.busy}
              icon="video"
              title="Choose the replacement"
              hint="Up to 90 seconds"
              onSelect={(file) => void onFile(file)}
              onReject={setUploadError}
            />
            {uploading ? (
              <p className="field-note" role="status">
                <span className="spinner" aria-hidden="true" /> Transcoding — this takes a few
                seconds.
              </p>
            ) : (
              <Button size="sm" block onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" icon="upload" block onClick={() => setReplacing(true)}>
            Replace the clip
          </Button>
        )}
      </div>

      <dl className="edit-record">
        <dt>Publisher</dt>
        <dd>{short.sourceName}</dd>
        {short.publishedAt !== null && (
          <>
            <dt>Published</dt>
            <dd>{dateTime(short.publishedAt)}</dd>
          </>
        )}
        {live && (
          <>
            <dt>Last edited</dt>
            <dd>
              {short.lastEditedAt === null
                ? 'Never — this is the short as published.'
                : `${dateTime(short.lastEditedAt) ?? ''} (${relativeTime(short.lastEditedAt)})`}
            </dd>
            {short.lastEditReason !== null && (
              <>
                <dt>Because</dt>
                <dd>{short.lastEditReason}</dd>
              </>
            )}
          </>
        )}
        {withdrawn && (
          <>
            <dt>Withdrawn</dt>
            <dd>{short.retractedAt === null ? 'Yes' : dateTime(short.retractedAt)}</dd>
            {short.retractionReason !== null && (
              <>
                <dt>Because</dt>
                <dd>{short.retractionReason}</dd>
              </>
            )}
          </>
        )}
      </dl>
    </Panel>
  );

  const shownTitle = short.title.trim() === '' ? 'Untitled short' : short.title;

  return (
    <div className="page">
      <h1 className="sr-only">Edit: {shownTitle}</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Shorts', route: Routes.shorts() }, { label: shownTitle })}
        />
        <div className="detail-bar-actions">
          {dirty && <p className="page-sub">Unsaved changes</p>}
          <Badge tone={look.tone} icon={look.icon}>
            {look.label}
          </Badge>
        </div>
      </div>

      {uploadError !== null && <Banner tone="error">{uploadError}</Banner>}
      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      <div className="grid">
        <aside className="col-4 sticky-aside">{clipPanel}</aside>

        <div className="col-8">
          <Panel title={withdrawn ? 'The words' : live ? 'Edit the live short' : 'Edit the draft'}>
            {withdrawn && (
              <Banner tone="info" live={false}>
                <strong>This short was withdrawn.</strong> It is no longer served, and a
                withdrawal is final, so it is shown here but not edited.
              </Banner>
            )}
            {live && mayPublish && (
              <Banner tone="info" live={false}>
                Readers can see this short now. Nothing is saved until you press{' '}
                <strong>Save changes</strong>, and every change is recorded with your reason and
                the time.
              </Banner>
            )}
            {live && !mayPublish && (
              <Banner tone="info" live={false}>
                This short is live. Changing it needs a reviewer or an admin, as publishing it did.
              </Banner>
            )}

            <div className="grid">
              <div className="col-6">
                <Fieldset legend="Language">
                  {(g) => (
                    <Segmented
                      {...g}
                      aria-label="Language"
                      value={language}
                      disabled={readOnly}
                      onChange={setLanguage}
                      options={[
                        { value: 'ne', label: 'नेपाली', lang: 'ne' },
                        { value: 'en', label: 'English', lang: 'en' },
                      ]}
                    />
                  )}
                </Fieldset>
              </div>

              <div className="col-6">
                <Field label="Section">
                  {(f) => (
                    <Listbox
                      {...f}
                      disabled={readOnly || categories.length === 0}
                      value={categorySlug}
                      onChange={(v) => setCategorySlug(v)}
                      options={
                        categories.length === 0
                          ? [{ value: categorySlug, label: categorySlug }]
                          : categories.map((c) => ({
                              value: c.slug,
                              label: language === 'ne' ? c.label.ne : c.label.en,
                              lang: language,
                            }))
                      }
                    />
                  )}
                </Field>
              </div>

              <div className="col-12">
                <Field
                  label="Title"
                  counter={
                    <Counter state={title.length > TITLE_MAX ? 'over' : 'ok'}>
                      {title.length} / {TITLE_MAX}
                    </Counter>
                  }
                  note="Shown over the poster, so it competes with the picture rather than sitting above it."
                >
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      lang={language}
                      maxLength={TITLE_MAX}
                      disabled={readOnly}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="col-12">
                <Field
                  label="Caption"
                  counter={
                    <Counter state={caption.length > CAPTION_MAX ? 'over' : 'ok'}>
                      {caption.length} / {CAPTION_MAX}
                    </Counter>
                  }
                >
                  {(f) => (
                    <textarea
                      {...f}
                      className="textarea"
                      lang={language}
                      rows={4}
                      maxLength={CAPTION_MAX}
                      disabled={readOnly}
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="col-6">
                <Field label="Credit">
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      placeholder="Who shot it"
                      disabled={readOnly}
                      value={credit}
                      onChange={(e) => setCredit(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="col-6">
                <Field label="Licence">
                  {(f) => (
                    <Listbox
                      {...f}
                      disabled={readOnly}
                      value={licence}
                      onChange={(v) => setLicence(v as ImageLicence)}
                      options={LICENCES.map((l) => ({
                        value: l.value,
                        label: l.label,
                        hint: l.hint,
                      }))}
                    />
                  )}
                </Field>
              </div>
            </div>

            {/* Only a live short asks why. A draft is the newsroom's own
                business until it is published, and asking for a reason to fix a
                typo nobody outside has seen is friction with no record to serve. */}
            {live && mayPublish && (
              <div className="edit-reason">
                <h3 className="edit-reason-title">Reason for this change</h3>
                <Field
                  label="Reason (required)"
                  note="Kept with the short and in the audit trail. Readers do not see it. At least ten characters."
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
                      placeholder="The caption named the wrong district"
                      value={reason}
                      disabled={action.busy}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}

            {!withdrawn && !(live && !mayPublish) && (
              <>
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
                  {isDraft && mayPublish && (
                    <Button
                      icon="send"
                      disabled={dirty || action.busy || uploading}
                      onClick={() => void publish()}
                    >
                      Publish
                    </Button>
                  )}
                  <Button
                    icon="arrowLeft"
                    disabled={action.busy}
                    onClick={() => navigate(Routes.shorts())}
                  >
                    Cancel
                  </Button>
                  <span className="actions-spacer" />
                  {live && !confirmingWithdraw && (
                    <Button
                      variant="danger"
                      size="sm"
                      icon="ban"
                      disabled={action.busy || !reasonReady}
                      onClick={() => setConfirmingWithdraw(true)}
                    >
                      Withdraw short
                    </Button>
                  )}
                </div>

                {blocker !== null && !confirmingWithdraw && (
                  <p className="field-note">{blocker}</p>
                )}
                {isDraft && mayPublish && dirty && (
                  <p className="field-note">Save your changes before publishing.</p>
                )}
                {live && !reasonReady && !confirmingWithdraw && (
                  <p className="field-note">Withdrawing needs the same reason.</p>
                )}

                {confirmingWithdraw && (
                  <div className="confirm-strip" role="alert">
                    <p>
                      <strong>Withdraw this short?</strong> Readers stop seeing it at once. This
                      cannot be undone.
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
              </>
            )}

            {(withdrawn || (live && !mayPublish)) && (
              <div className="actions">
                <Button icon="arrowLeft" onClick={() => navigate(Routes.shorts())}>
                  Back to shorts
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
