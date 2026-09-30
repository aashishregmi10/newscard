import { useState } from 'react';
import { api, ApiError } from '../api';

/**
 * "No ads on this story."
 *
 * The small ad rides on every story by default, beside save and share. Some
 * stories should not carry one — a death toll, a disaster, a funeral — and
 * only an editor can know which. This is where they say so.
 *
 * It saves the moment it is changed, with no Save button and no reason asked,
 * because it is a judgement about the ADVERTISING and changes nothing a reader
 * reads. That is also why it works on a live story, where correcting the text
 * needs a reason: this is not a correction. It is still in the audit trail.
 *
 * The full-card ad sits between stories rather than on one, and is not
 * affected.
 */
export function AdsOnStory({ id, suppressed }: { id: string; suppressed: boolean }) {
  const [value, setValue] = useState(suppressed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean) => {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      await api.setArticleAds(id, next);
    } catch (e) {
      /* Put the box back: showing "no ads" on a story that still carries them
         is the one wrong answer here. */
      setValue(previous);
      setError(e instanceof ApiError ? e.message : 'Could not change that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ads-on-story">
      <label className="check-row">
        <input
          type="checkbox"
          checked={value}
          disabled={busy}
          onChange={(e) => void change(e.target.checked)}
        />
        No small ad on this story
      </label>
      <p className={error === null ? 'field-note' : 'field-note field-note-bad'} role="status">
        {error ??
          (value
            ? 'Readers see this story without the small ad beside share. Saved.'
            : 'For a story an ad should not sit beside — a disaster, a death. Saves at once; readers never see this setting.')}
      </p>
    </div>
  );
}
