import { useState } from 'react';
import { api, ApiError, type ArticleImageData, type ImageLicence } from '../api';
import { fileSize } from '../lib/format';
import { LICENCES, licenceLabel } from '../lib/licences';
import { firstMediaUrl } from '../lib/media';
import { Banner, Button, Field, FileDrop, Select } from '../ui';

/**
 * Attaching a photograph to a story.  Contract §4, "image attachment".
 *
 * -- Why the licence is asked for here ---------------------------------------
 *
 * Publishing refuses an image without a recognised licence, and that check is
 * deliberate and unbypassable. But if the question is only asked at publish,
 * the editor has finished the story and is then told the picture cannot be
 * used — with no memory of where it came from. The moment the file is chosen is
 * the only point at which the person still knows the answer.
 *
 * -- Why removal is one click and replacement is two -------------------------
 *
 * Media keys are immutable: the API serves them with a one-year immutable
 * cache, so a replacement is a new key rather than a rewrite. Replacing
 * therefore uploads afresh, and the old key is simply orphaned — which is the
 * right trade against the alternative, an image that is wrong for a year on
 * every phone that cached it.
 */

interface Props {
  image: ArticleImageData | null;
  disabled: boolean;
  onChange: (image: ArticleImageData | null) => void;
}

export function ImagePicker({ image, disabled, onChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState<ImageLicence>('agency');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setCredit('');
    setError(null);
  };

  const doUpload = async () => {
    if (file === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { image: uploaded } = await api.uploadImage(file, credit.trim(), licence);
      onChange(uploaded);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  if (image !== null) {
    const preview = firstMediaUrl(image.urls.md, image.urls.sm, image.urls.lg);

    return (
      <div className="field">
        <div className="field-label">
          <span className="field-label-text">Image</span>
        </div>
        <div className="panel panel-sunk">
          <div className="panel-body">
            {preview !== null && (
              /* Empty alt, deliberately. The credit below carries the only
                 information this element has, and a screen reader announcing a
                 filename or repeating the caption is noise. The editor is
                 looking at the picture; the reader app supplies its own alt. */
              <img className="media-preview" src={preview} alt="" />
            )}
            <p className="meta-line" style={{ marginTop: 'var(--s3)' }}>
              <span>{image.credit}</span>
              <span>{licenceLabel(image.licence)}</span>
              {image.width !== null && image.height !== null && (
                <span>
                  {image.width}×{image.height}
                </span>
              )}
            </p>
            <div className="actions actions-plain">
              <Button size="sm" icon="trash" disabled={disabled} onClick={() => onChange(null)}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <div className="field-label">
        <span className="field-label-text">
          Image
          <span className="field-optional">optional</span>
        </span>
      </div>

      {error !== null && <Banner tone="error">{error}</Banner>}

      {file === null ? (
        <FileDrop
          accept="image/*"
          disabled={disabled || busy}
          icon="image"
          title="Choose a photograph, or drop one here"
          hint="JPEG, PNG or WebP"
          onSelect={setFile}
          onReject={setError}
        />
      ) : (
        <>
          <p className="meta-line" style={{ marginBottom: 'var(--s3)' }}>
            <span>{file.name}</span>
            <span>{fileSize(file.size)}</span>
          </p>

          <Field label="Credit">
            {(f) => (
              <input
                {...f}
                className="input"
                placeholder="Reuters / Navesh Chitrakar"
                value={credit}
                disabled={busy}
                onChange={(e) => setCredit(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Licence"
            note="An uncredited photograph is the highest legal risk this product carries, and publishing refuses an image without a recognised licence. This is the last moment anyone knows which it is."
          >
            {(f) => (
              <Select
                {...f}
                value={licence}
                disabled={busy}
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

          <div className="actions actions-plain">
            <Button
              variant="primary"
              size="sm"
              icon="upload"
              busy={busy}
              disabled={credit.trim() === ''}
              onClick={() => void doUpload()}
            >
              Upload
            </Button>
            <Button size="sm" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
