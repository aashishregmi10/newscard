import { useRef, useState } from 'react';
import { api, ApiError, type ArticleImageData, type ImageLicence } from '../api';

/**
 * Attaching a photograph to a story.  Contract §4, "image attachment".
 *
 * ── Why the licence is asked for here ───────────────────────────────────────
 *
 * Publishing refuses an image without a recognised licence, and that check is
 * deliberate and unbypassable. But if the question is only asked at publish,
 * the editor has finished the story and is then told the picture cannot be
 * used — with no memory of where it came from. The moment the file is chosen is
 * the only point at which the person still knows the answer.
 *
 * ── Why removal is one click and replacement is two ─────────────────────────
 *
 * Media keys are immutable: the API serves them with a one-year immutable
 * cache, so a replacement is a new key rather than a rewrite. Replacing
 * therefore uploads afresh, and the old key is simply orphaned — which is the
 * right trade against the alternative, an image that is wrong for a year on
 * every phone that cached it.
 */

/**
 * Where media is served from.
 *
 * Not the CMS API. The editorial backend is on 3001 and media is served by the
 * READ api on 3000, so a preview built from the CMS origin 404s — which looks
 * like a broken upload and is not.
 */
const MEDIA_ORIGIN: string = import.meta.env.VITE_MEDIA_BASE ?? 'http://localhost:3000';

function mediaUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `${MEDIA_ORIGIN}${u}`;
}

const LICENCES: Array<{ value: ImageLicence; label: string; hint: string }> = [
  {
    value: 'publisher_licensed',
    label: 'Publisher licensed',
    hint: 'Supplied by the publisher under our agreement with them',
  },
  { value: 'agency', label: 'Agency', hint: 'Reuters, AFP, AP and the like' },
  { value: 'cc_by', label: 'Creative Commons BY', hint: 'Attribution required in the credit' },
  { value: 'own', label: 'Our own', hint: 'Shot by us' },
];

interface Props {
  image: ArticleImageData | null;
  disabled: boolean;
  onChange: (image: ArticleImageData | null) => void;
}

export function ImagePicker({ image, disabled, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState<ImageLicence>('agency');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setCredit('');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const doUpload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { image: uploaded } = await api.uploadImage(file, credit.trim(), licence);
      onChange(uploaded);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  if (image) {
    const preview = mediaUrl(image.urls.md ?? image.urls.sm ?? image.urls.lg);
    return (
      <div className="field">
        <div className="label">
          <span>Image</span>
        </div>
        <div className="panel" style={{ padding: 12 }}>
          {preview && (
            <img
              src={preview}
              alt=""
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                objectFit: 'cover',
                borderRadius: 4,
                display: 'block',
                // The stored average colour, so the box does not flash white
                // before the file arrives — the same placeholder the app uses.
                background: '#e8ebe6',
              }}
            />
          )}
          <div className="field-note" style={{ marginTop: 8 }}>
            {image.credit} · {LICENCES.find((l) => l.value === image.licence)?.label ?? image.licence}
            {image.width ? ` · ${image.width}×${image.height}` : ''}
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" disabled={disabled} onClick={() => onChange(null)}>
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <div className="label">
        <span>Image</span>
        <span className="field-optional">optional</span>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <input
        id="composer-image-file"
        ref={fileRef}
        className="input"
        type="file"
        accept="image/*"
        disabled={disabled || busy}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
        }}
      />

      {file && (
        <>
          <input
            id="composer-image-credit"
            className="input"
            style={{ marginTop: 8 }}
            placeholder="Credit — e.g. Reuters / Navesh Chitrakar"
            value={credit}
            disabled={busy}
            onChange={(e) => setCredit(e.target.value)}
          />
          <select
            id="composer-image-licence"
            className="input"
            style={{ marginTop: 8 }}
            value={licence}
            disabled={busy}
            onChange={(e) => setLicence(e.target.value as ImageLicence)}
          >
            {LICENCES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label} — {l.hint}
              </option>
            ))}
          </select>
          <div className="field-note">
            An uncredited photograph is the highest legal risk this product carries, and publishing
            refuses an image without a recognised licence. This is the last moment anyone knows
            which it is.
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !credit.trim()}
              onClick={() => void doUpload()}
            >
              {busy ? <span className="spinner" /> : null} Upload
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
