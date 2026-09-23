import { useState } from 'react';
import {
  api,
  ApiError,
  type ImageLicence,
  type NewStoryOptions,
  type UploadedVideo,
} from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { fileSize } from '../lib/format';
import { LICENCES } from '../lib/licences';
import { mediaUrl } from '../lib/media';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import {
  Banner,
  Breadcrumbs,
  Button,
  Counter,
  Field,
  Fieldset,
  FileDrop,
  Panel,
  Segmented,
  Select,
  Skeleton,
} from '../ui';

/**
 * Uploading a short.  Contract §4, "video upload".
 *
 * -- Why this is no longer on the Shorts screen ------------------------------
 *
 * It was: an upload form and the whole library, stacked on one page. Everything
 * was visible at once, which sounds like an advantage until you count what an
 * editor is actually holding in their head — a file, seven metadata fields, and
 * a list of every short ever published, with the publish and withdraw controls
 * for all of them a scroll below the form they are filling in.
 *
 * The queue already made this separation: a list at `#/queue`, a create form at
 * `#/queue/new`. Shorts now matches, which also means an upload has its own
 * address and its own Back.
 *
 * -- Why upload and metadata are two steps -----------------------------------
 *
 * Transcoding takes seconds — three renditions and a poster — and it happens
 * the moment the file is chosen, before the editor writes a title. That is
 * deliberate: the wait overlaps with the typing instead of following it, and a
 * clip that is too long or unreadable is rejected while the editor still has
 * the file in mind rather than after they have written the caption.
 */

const TITLE_MAX = 80;
const CAPTION_MAX = 400;

export function NewShort() {
  const { data: options, error: loadError, loading, reload } = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections and publishers.',
  );

  const action = useAsyncAction();

  // The transcoded clip, held until the editor has written the words for it.
  const [uploaded, setUploaded] = useState<UploadedVideo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [sourceChoice, setSourceChoice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState<ImageLicence>('own');

  const categories = options?.categories ?? [];
  const sources = options?.sources ?? [];
  const category = categories.find((c) => c.slug === categoryChoice) ?? categories[0] ?? null;
  const source =
    sources.find((s) => s.slug === sourceChoice) ??
    sources.find((s) => s.licensed) ??
    sources[0] ??
    null;

  const goToList = () => navigate(Routes.shorts());

  const discard = () => {
    setUploaded(null);
    setTitle('');
    setCaption('');
    setCredit('');
    setUploadError(null);
  };

  const onFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      /* The credit travels with the upload because the transcoder records it in
         the audit trail; it is confirmed again below before anything is saved. */
      const { video } = await api.uploadVideo(
        file,
        credit.trim() === '' ? 'Pending' : credit.trim(),
      );
      setUploaded(video);
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const complete =
    uploaded !== null &&
    title.trim() !== '' &&
    caption.trim() !== '' &&
    credit.trim() !== '' &&
    category !== null &&
    source !== null;

  const save = async () => {
    if (uploaded === null || category === null || source === null) return;
    const ok = await action.run(() =>
      api.createShort({
        language,
        categorySlug: category.slug,
        sourceSlug: source.slug,
        title: title.trim(),
        caption: caption.trim(),
        credit: credit.trim(),
        licence,
        durationSeconds: uploaded.durationSeconds,
        posterUrl: uploaded.posterUrl,
        posterBlurHash: uploaded.posterBlurHash,
        renditions: uploaded.renditions,
      }),
    );
    /* Back to the library, where the new draft is now the thing to publish.
       Staying here would leave an empty form and no sign of where it went. */
    if (ok) goToList();
  };

  return (
    <div className="page page-narrow">
      <h1 className="sr-only">New short</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Shorts', route: Routes.shorts() }, { label: 'New short' })}
        />
        <div className="detail-bar-actions">
          <Button size="sm" disabled={action.busy} onClick={goToList}>
            Cancel
          </Button>
        </div>
      </div>

      {loadError !== null && (
        <Banner tone="error">
          {loadError}{' '}
          <Button variant="ghost" size="sm" onClick={reload}>
            Try again
          </Button>
        </Banner>
      )}
      {uploadError !== null && <Banner tone="error">{uploadError}</Banner>}
      {action.error !== null && <Banner tone="error">{action.error}</Banner>}

      <Panel title="The clip">
        {uploaded === null ? (
          <Field
            label="Video file"
            /* Plain: the drop zone draws its own dashed box, and a label
               floating on a dashed border is nonsense. */
            variant="plain"
            note="Transcoded to three sizes the player chooses between, plus a cover frame. Capped at 90 seconds — past that the data cost stops being something a reader can absorb without noticing."
          >
            {(f) => (
              <>
                <FileDrop
                  {...f}
                  accept="video/*"
                  disabled={uploading || action.busy}
                  icon="video"
                  title="Choose a clip, or drop one here"
                  hint="Up to 90 seconds"
                  onSelect={(file) => void onFile(file)}
                  onReject={setUploadError}
                />
                {uploading && (
                  <p className="field-note" role="status">
                    <span className="spinner" aria-hidden="true" /> Transcoding — this takes a few
                    seconds.
                  </p>
                )}
              </>
            )}
          </Field>
        ) : (
          <div className="media-row">
            <img className="media-poster" src={mediaUrl(uploaded.posterUrl)} alt="" />
            <div>
              <p className="meta-line">
                <span>{uploaded.durationSeconds}s</span>
                <span>{uploaded.renditions.length} renditions</span>
              </p>
              <ul className="stack-tight" style={{ marginTop: 'var(--s2)', listStyle: 'none' }}>
                {uploaded.renditions.map((r) => (
                  <li className="meta-line" key={r.quality}>
                    <span>{r.quality}</span>
                    <span>
                      {r.width}×{r.height}
                    </span>
                    <span>{fileSize(r.bytes)}</span>
                  </li>
                ))}
              </ul>
              <div className="actions actions-plain">
                <Button size="sm" icon="x" disabled={action.busy} onClick={discard}>
                  Choose a different clip
                </Button>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/*
        * The words only appear once there is a clip to attach them to.
        *
        * Seven fields that cannot be submitted yet are seven fields in the way.
        * They arrive when the transcode finishes, which is also the moment the
        * editor's attention comes back from the file picker.
        */}
      {uploaded !== null && (
        <Panel title="The words">
          {loading || options === null ? (
            <div aria-busy="true">
              <Skeleton height={40} style={{ marginBottom: 20 }} />
              <Skeleton height={40} style={{ marginBottom: 20 }} />
              <Skeleton height={40} />
            </div>
          ) : (
            <>
              <Fieldset legend="Language">
                {(g) => (
                  <Segmented
                    {...g}
                    aria-label="Language"
                    value={language}
                    onChange={setLanguage}
                    options={[
                      { value: 'ne', label: 'नेपाली', lang: 'ne' },
                      { value: 'en', label: 'English', lang: 'en' },
                    ]}
                  />
                )}
              </Fieldset>

              <Field label="Section">
                {(f) => (
                  <Select
                    {...f}
                    value={category?.slug ?? ''}
                    onChange={(e) => setCategoryChoice(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {language === 'ne' ? c.label.ne : c.label.en}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Publisher">
                {(f) => (
                  <Select
                    {...f}
                    value={source?.slug ?? ''}
                    onChange={(e) => setSourceChoice(e.target.value)}
                  >
                    {sources.map((s) => (
                      <option key={s.slug} value={s.slug} disabled={!s.licensed}>
                        {s.displayName}
                        {s.licensed ? '' : ' — no agreed licence'}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

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
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Caption"
                counter={
                  <Counter state={caption.length > CAPTION_MAX ? 'over' : 'ok'}>
                    {caption.length} / {CAPTION_MAX}
                  </Counter>
                }
                note="A short without words is a clip; with them it is journalism."
              >
                {(f) => (
                  <textarea
                    {...f}
                    className="textarea"
                    lang={language}
                    rows={3}
                    maxLength={CAPTION_MAX}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Credit">
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    placeholder="Who shot it"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Licence"
                note="Same discipline as a photograph. Publication is blocked without a recognised licence and a credit."
              >
                {(f) => (
                  <Select
                    {...f}
                    value={licence}
                    onChange={(e) => setLicence(e.target.value as ImageLicence)}
                  >
                    {LICENCES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label} — {l.hint}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <div className="actions">
                <Button
                  variant="primary"
                  icon="check"
                  busy={action.busy}
                  disabled={!complete}
                  onClick={() => void save()}
                >
                  Save as a draft
                </Button>
                <Button disabled={action.busy} onClick={goToList}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
