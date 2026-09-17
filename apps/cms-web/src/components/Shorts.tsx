import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type ImageLicence,
  type NewStoryOptions,
  type ShortItem,
  type UploadedVideo,
} from '../api';

/**
 * Shorts — uploading and publishing video.  Contract §4, "video upload".
 *
 * ── Why this is its own screen ──────────────────────────────────────────────
 *
 * A short is its own document, not an article with a clip attached: no summary,
 * no word limit, a different lifecycle. Putting it inside the story composer
 * would mean every field on that screen growing an "unless it is a video"
 * caveat.
 *
 * ── Why upload and metadata are two steps ───────────────────────────────────
 *
 * Transcoding takes seconds — three renditions and a poster — and it happens
 * the moment the file is chosen, before the editor writes a title. That is
 * deliberate: the wait overlaps with the typing instead of following it, and a
 * clip that is too long or unreadable is rejected while the editor still has
 * the file in mind rather than after they have written the caption.
 */

const MEDIA_ORIGIN: string = import.meta.env.VITE_MEDIA_BASE ?? 'http://localhost:3000';
const mediaUrl = (u: string): string => (/^https?:\/\//i.test(u) ? u : `${MEDIA_ORIGIN}${u}`);

const LICENCES: Array<{ value: ImageLicence; label: string }> = [
  { value: 'publisher_licensed', label: 'Publisher licensed' },
  { value: 'agency', label: 'Agency' },
  { value: 'cc_by', label: 'Creative Commons BY' },
  { value: 'own', label: 'Our own' },
];

const STATUS_CHIP: Record<string, string> = {
  draft: 'chip-draft',
  published: 'chip-approved',
  retracted: 'chip-flag',
};

function bytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

interface Props {
  onBack: () => void;
}

export function Shorts({ onBack }: Props) {
  const [items, setItems] = useState<ShortItem[] | null>(null);
  const [options, setOptions] = useState<NewStoryOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The transcoded clip, held until the editor has written the words for it.
  const [uploaded, setUploaded] = useState<UploadedVideo | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [categorySlug, setCategorySlug] = useState('');
  const [sourceSlug, setSourceSlug] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState<ImageLicence>('own');

  const load = useCallback(() => {
    setError(null);
    void api
      .shorts()
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setError(e.message));
    void api
      .options()
      .then((o) => {
        setOptions(o);
        setCategorySlug((c) => c || (o.categories[0]?.slug ?? ''));
        setSourceSlug((s) => s || (o.sources.find((x) => x.licensed)?.slug ?? ''));
      })
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const reset = () => {
    setUploaded(null);
    setTitle('');
    setCaption('');
    setCredit('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // The credit travels with the upload because the transcoder records it in
      // the audit trail; it is confirmed again below before anything is saved.
      const { video } = await api.uploadVideo(file, credit.trim() || 'Pending');
      setUploaded(video);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed.');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!uploaded) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createShort({
        language,
        categorySlug,
        sourceSlug,
        title: title.trim(),
        caption: caption.trim(),
        credit: credit.trim(),
        licence,
        durationSeconds: uploaded.durationSeconds,
        posterUrl: uploaded.posterUrl,
        posterBlurHash: uploaded.posterBlurHash,
        renditions: uploaded.renditions,
      });
      setNotice('Saved as a draft. Publish it when you are ready.');
      reset();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const complete = uploaded && title.trim() && caption.trim() && credit.trim() && categorySlug && sourceSlug;

  return (
    <>
      <div className="page-head">
        <button className="btn btn-sm" onClick={onBack}>
          ← Queue
        </button>
        <h2 style={{ margin: 0 }}>Shorts</h2>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-ok">{notice}</div>}

      <div className="panel">
        <div className="row-head">New short</div>

        <div className="field">
          <div className="label">
            <span>Video file</span>
          </div>
          <input
            id="short-file"
            ref={fileRef}
            className="input"
            type="file"
            accept="video/*"
            disabled={uploading || busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <div className="field-note">
            Transcoded to three sizes the player chooses between, plus a cover frame. Capped at 90
            seconds — past that the data cost stops being something a reader can absorb without
            noticing.
          </div>
          {uploading && (
            <div className="field-note">
              <span className="spinner" /> Transcoding — this takes a few seconds.
            </div>
          )}
        </div>

        {uploaded && (
          <>
            <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <img
                  src={mediaUrl(uploaded.posterUrl)}
                  alt=""
                  style={{
                    width: 96,
                    aspectRatio: '9 / 16',
                    objectFit: 'cover',
                    borderRadius: 4,
                    background: '#e8ebe6',
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div className="field-note" style={{ marginTop: 0 }}>
                    {uploaded.durationSeconds}s · {uploaded.renditions.length} renditions
                  </div>
                  {uploaded.renditions.map((r) => (
                    <div className="field-note" key={r.quality} style={{ marginTop: 2 }}>
                      {r.quality} · {r.width}×{r.height} · {bytes(r.bytes)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="field">
              <div className="label">
                <span>Language</span>
              </div>
              <div className="segmented">
                {(['ne', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={language === l ? 'seg seg-on' : 'seg'}
                    onClick={() => setLanguage(l)}
                  >
                    {l === 'ne' ? 'नेपाली' : 'English'}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="label">
                <span>Section</span>
              </div>
              <select
                id="short-category"
                className="input"
                value={categorySlug}
                onChange={(e) => setCategorySlug(e.target.value)}
              >
                {options?.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label.ne} · {c.label.en}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <div className="label">
                <span>Publisher</span>
              </div>
              <select
                id="short-source"
                className="input"
                value={sourceSlug}
                onChange={(e) => setSourceSlug(e.target.value)}
              >
                {options?.sources.map((s) => (
                  <option key={s.slug} value={s.slug} disabled={!s.licensed}>
                    {s.displayName}
                    {s.licensed ? '' : ' — no agreed licence'}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <div className="label">
                <span>Title</span>
                <span className="counter">{title.length} / 80</span>
              </div>
              <input
                id="short-title"
                className="input"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div className="field-note">
                Shown over the poster, so it competes with the picture rather than sitting above it.
              </div>
            </div>

            <div className="field">
              <div className="label">
                <span>Caption</span>
                <span className="counter">{caption.length} / 400</span>
              </div>
              <textarea
                id="short-caption"
                className="textarea"
                rows={3}
                maxLength={400}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <div className="field-note">
                A short without words is a clip; with them it is journalism.
              </div>
            </div>

            <div className="field">
              <div className="label">
                <span>Credit and licence</span>
              </div>
              <input
                id="short-credit"
                className="input"
                placeholder="Who shot it"
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
              />
              <select
                id="short-licence"
                className="input"
                style={{ marginTop: 8 }}
                value={licence}
                onChange={(e) => setLicence(e.target.value as ImageLicence)}
              >
                {LICENCES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <div className="field-note">
                Same discipline as a photograph. Publication is blocked without a recognised licence
                and a credit.
              </div>
            </div>

            <div className="actions">
              <button className="btn btn-primary" disabled={busy || !complete} onClick={() => void save()}>
                {busy ? <span className="spinner" /> : null} Save as draft
              </button>
              <button className="btn" disabled={busy} onClick={reset}>
                Discard
              </button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="row-head">All shorts</div>
        {items === null ? (
          <p className="field-note">Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty">No shorts yet.</p>
        ) : (
          <div className="queue">
            {items.map((v) => (
              <div className="row" key={v.id} style={{ cursor: 'default' }}>
                <span className={`chip ${STATUS_CHIP[v.status] ?? ''}`}>{v.status}</span>
                <div>
                  <div>{v.title}</div>
                  <div className="row-meta">
                    {v.sourceName} · {v.categorySlug} · {v.durationSeconds}s · {v.credit}
                  </div>
                </div>
                <div className="row-right">
                  {v.status === 'draft' && (
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void act(() => api.publishShort(v.id), 'Published.')}
                    >
                      Publish
                    </button>
                  )}
                  {v.status === 'published' && (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => void act(() => api.retractShort(v.id), 'Withdrawn.')}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
