import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type ArticleImageData, type ImageLicence } from '../api';
import { fileSize } from '../lib/format';
import { LICENCES, licenceLabel } from '../lib/licences';
import { firstMediaUrl } from '../lib/media';
import { Banner, Button, Field, FileDrop, Icon, Listbox } from '../ui';

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
 * -- The three states, and why the middle one exists -------------------------
 *
 *   idle      nothing attached          → the drop zone
 *   chosen    a file picked, not sent   → preview, credit, licence, Upload
 *   attached  uploaded and saved        → preview, editable credit, Replace
 *
 * The middle state used to show a filename and two empty fields and nothing
 * else. An editor filled in a credit, pressed Upload, and only then found out
 * the picture was 358px wide and the server would not take it — after doing the
 * work, and without ever seeing what they had picked. It now shows the file the
 * moment it is chosen and measures it in the browser, so the one rejection that
 * is knowable without a round trip is reported before any work is done.
 *
 * -- Why the size check is duplicated from the server ------------------------
 *
 * MIN_SOURCE_WIDTH is the server's rule and the server stays authoritative.
 * This does not replace that check, it front-runs it. The duplication is worth
 * paying for because the alternative is the editor learning the answer only
 * after filling in two fields and waiting for an upload — and because the
 * number changing is a visible edit to a named constant rather than a silent
 * drift.
 *
 * -- Why removal is one click and replacement is two -------------------------
 *
 * Media keys are immutable: the API serves them with a one-year immutable
 * cache, so a replacement is a new key rather than a rewrite. Replacing
 * therefore uploads afresh, and the old key is simply orphaned — which is the
 * right trade against the alternative, an image that is wrong for a year on
 * every phone that cached it. The attached picture stays attached until the new
 * upload succeeds, so a replacement the editor abandons changes nothing.
 *
 * -- Why the parent is told about a chosen, unsent file ----------------------
 *
 * The chosen state shows the picture full size, which looks exactly like a
 * picture that is on the story. An editor chose one, went on to Submit,
 * Approve and Publish, and the story went live with no image: the file was
 * never uploaded, and nothing said so. `onPendingChange` lets the screen
 * refuse to move the story on while a file is waiting, and the chosen state
 * now says "Not attached yet" in words.
 */

/** The server's floor, in packages/media/src/images.ts. See the note above. */
const MIN_SOURCE_WIDTH = 640;

interface Picked {
  file: File;
  /** An object URL. Revoked when it is replaced, and on unmount. */
  url: string;
  width: number | null;
  height: number | null;
}

interface Props {
  image: ArticleImageData | null;
  disabled: boolean;
  onChange: (image: ArticleImageData | null) => void;
  /** True while a file is chosen but not yet uploaded and attached. */
  onPendingChange?: (pending: boolean) => void;
}

export function ImagePicker({ image, disabled, onChange, onPendingChange }: Props) {
  const [picked, setPicked] = useState<Picked | null>(null);

  const pending = picked !== null;
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  // A picker that has gone away is holding nothing back.
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const [replacing, setReplacing] = useState(false);
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState<ImageLicence>('agency');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * An object URL is a manual allocation: the browser keeps the file alive
   * until the URL is revoked, so an editor who tries six photographs holds all
   * six for the lifetime of the tab. The ref is what lets the unmount cleanup
   * revoke the CURRENT url rather than whichever one existed when the effect
   * was created.
   */
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    urlRef.current = picked?.url ?? null;
  }, [picked]);
  useEffect(
    () => () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const reset = () => {
    setPicked((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
    setCredit('');
    setError(null);
    setReplacing(false);
  };

  /*
   * Measured in the browser rather than taken on trust.
   *
   * A File carries a name, a size and a MIME type and no dimensions at all, so
   * the only way to know the width before uploading is to decode the thing.
   * `decode()` rejects on a file that is not really an image, which is the
   * server's other rejection — so both of them are reported at the moment of
   * choosing rather than after the round trip.
   */
  const take = (file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.src = url;

    const settle = (width: number | null, height: number | null) => {
      setPicked((current) => {
        if (current !== null) URL.revokeObjectURL(current.url);
        return { file, url, width, height };
      });
    };

    probe
      .decode()
      .then(() => settle(probe.naturalWidth, probe.naturalHeight))
      .catch(() => {
        settle(null, null);
        setError('That file could not be read as an image.');
      });
  };

  const tooSmall =
    picked !== null && picked.width !== null && picked.width < MIN_SOURCE_WIDTH;

  const doUpload = async () => {
    if (picked === null || busy || tooSmall) return;
    setBusy(true);
    setError(null);
    try {
      const { image: uploaded } = await api.uploadImage(picked.file, credit.trim(), licence);
      onChange(uploaded);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * A heading, not a floating label.
   *
   * It used `.field-label-text`, which is the notched-outline label: absolutely
   * positioned, and relying on the Field shell around it to be the positioned
   * ancestor. This picker has no such shell, so the nearest positioned
   * ancestor was the page itself and "Image optional" was drawn over the
   * SAAR logo in the top-left corner of every composer.
   */
  const label = (
    <p className="field-heading">
      Image <span className="field-optional">optional</span>
    </p>
  );

  /* ── Chosen, not yet uploaded ─────────────────────────────────────────── */

  if (picked !== null) {
    return (
      <div className="field">
        {label}
        <div className="media-edit">
          <figure className="media-edit-figure">
            <img className="media-preview" src={picked.url} alt="" />
            <figcaption className="meta-line">
              <span className="media-pending">
                <Icon name="alertCircle" /> Not attached yet
              </span>
              <span>{picked.file.name}</span>
              <span>{fileSize(picked.file.size)}</span>
              {picked.width !== null && picked.height !== null && (
                <span>
                  {picked.width}×{picked.height}
                </span>
              )}
            </figcaption>
          </figure>

          <div className="media-edit-form">
            {error !== null && <Banner tone="error">{error}</Banner>}
            {tooSmall && (
              <Banner tone="error">
                This picture is {picked.width}px wide. A card needs at least {MIN_SOURCE_WIDTH}px,
                and anything narrower is upscaled — which looks worse on a phone than no picture
                at all. Choose a larger file.
              </Banner>
            )}

            <div className="grid">
              <div className="col-6">
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
              </div>
              <div className="col-6">
                <Field label="Licence">
                  {(f) => (
                    <Listbox
                      {...f}
                      value={licence}
                      disabled={busy}
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

            <p className="field-note">
              An uncredited photograph is the highest legal risk this product carries, and
              publishing refuses an image without a recognised licence. This is the last moment
              anyone knows which it is.
            </p>

            <div className="actions actions-plain">
              <Button
                variant="primary"
                size="sm"
                icon="upload"
                busy={busy}
                disabled={credit.trim() === '' || tooSmall}
                onClick={() => void doUpload()}
              >
                Upload and attach
              </Button>
              <Button size="sm" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Attached ─────────────────────────────────────────────────────────── */

  if (image !== null && !replacing) {
    const preview = firstMediaUrl(image.urls.md, image.urls.sm, image.urls.lg);

    return (
      <div className="field">
        {label}
        <div className="media-edit">
          <figure className="media-edit-figure">
            {preview !== null && (
              /* Empty alt, deliberately. The credit below carries the only
                 information this element has, and a screen reader announcing a
                 filename or repeating the caption is noise. The editor is
                 looking at the picture; the reader app supplies its own alt. */
              <img className="media-preview" src={preview} alt="" />
            )}
            <figcaption className="meta-line">
              <span className="media-attached">
                <Icon name="checkCircle" /> Attached
              </span>
              {image.width !== null && image.height !== null && (
                <span>
                  {image.width}×{image.height}
                </span>
              )}
              <span>{licenceLabel(image.licence)}</span>
            </figcaption>
          </figure>

          <div className="media-edit-form">
            {/*
              * Credit and licence stay editable after the upload.
              *
              * They are fields on the article, not properties of the stored
              * file, so correcting a misspelled photographer does not need the
              * picture uploading again — which is what this screen used to
              * require, and is why a wrong credit tended to simply stay wrong.
              */}
            <div className="grid">
              <div className="col-6">
                <Field
                  label="Credit"
                  invalid={image.credit.trim() === ''}
                  note={
                    image.credit.trim() === ''
                      ? 'A credit is required. Publishing refuses an image without one.'
                      : undefined
                  }
                  noteTone="bad"
                >
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      value={image.credit}
                      disabled={disabled}
                      onChange={(e) => onChange({ ...image, credit: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="col-6">
                <Field label="Licence">
                  {(f) => (
                    <Listbox
                      {...f}
                      value={image.licence}
                      disabled={disabled}
                      onChange={(v) => onChange({ ...image, licence: v as ImageLicence })}
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

            <div className="actions actions-plain">
              <Button
                size="sm"
                icon="upload"
                disabled={disabled}
                onClick={() => {
                  setError(null);
                  setCredit(image.credit);
                  setLicence(image.licence);
                  setReplacing(true);
                }}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                disabled={disabled}
                onClick={() => onChange(null)}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Idle, or choosing a replacement ──────────────────────────────────── */

  return (
    <div className="field">
      {label}

      {error !== null && <Banner tone="error">{error}</Banner>}

      <FileDrop
        accept="image/*"
        disabled={disabled || busy}
        icon="image"
        title={replacing ? 'Choose the replacement' : 'Choose a photograph, or drop one here'}
        hint={'JPEG, PNG or WebP, at least ' + MIN_SOURCE_WIDTH + 'px wide'}
        onSelect={take}
        onReject={setError}
      />

      {replacing && (
        <div className="actions actions-plain">
          <Button size="sm" onClick={reset}>
            Keep the current picture
          </Button>
        </div>
      )}
    </div>
  );
}
