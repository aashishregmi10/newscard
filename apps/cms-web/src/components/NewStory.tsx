import { useEffect, useState } from 'react';
import { api, ApiError, type NewStoryOptions } from '../api';

/**
 * Starting a story.
 *
 * Three questions and nothing else: which language, which section, which
 * publisher. Everything else — headline, summary, pull quote, image — is the
 * composer's job, because those are written and rewritten and this screen is
 * answered once.
 *
 * The three that ARE here cannot be deferred: they decide the slug, the feed the
 * story appears in, and whether we are allowed to publish it at all. Asking for
 * them up front is the difference between a draft that can be finished and one
 * that fails at the publish gate an hour later.
 */

interface Props {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function NewStory({ onCreated, onCancel }: Props) {
  const [options, setOptions] = useState<NewStoryOptions | null>(null);
  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [categorySlug, setCategorySlug] = useState('');
  const [sourceSlug, setSourceSlug] = useState('');
  const [headline, setHeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .options()
      .then((o) => {
        setOptions(o);
        setCategorySlug((c) => c || (o.categories[0]?.slug ?? ''));
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Could not load the options.'),
      );
  }, []);

  /**
   * Publishers are filtered to the chosen language. A Nepali story filed against
   * an English-only publisher is an attribution error, and it is easier to make
   * it impossible here than to catch it in review.
   */
  const sources = (options?.sources ?? []).filter((s) => s.language === language);
  const chosen = sources.find((s) => s.slug === sourceSlug);

  useEffect(() => {
    // Keep the publisher valid when the language changes under it.
    if (!sources.some((s) => s.slug === sourceSlug)) {
      setSourceSlug(sources.find((s) => s.licensed)?.slug ?? sources[0]?.slug ?? '');
    }
  }, [language, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categorySlug || !sourceSlug) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.create({
        language,
        categorySlug,
        sourceSlug,
        headline: headline.trim() || undefined,
      });
      onCreated(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the story.');
      setBusy(false);
    }
  };

  if (error && !options) {
    return (
      <>
        <div className="banner banner-error">{error}</div>
        <button className="btn" onClick={onCancel}>
          Back to queue
        </button>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>New story</h1>
        <button className="btn btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>

      <form className="card form" onSubmit={submit}>
        <fieldset className="field">
          <legend>Language</legend>
          <div className="segmented">
            {(['ne', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={`seg ${language === l ? 'seg-on' : ''}`}
                onClick={() => setLanguage(l)}
                aria-pressed={language === l}
              >
                {l === 'ne' ? 'नेपाली' : 'English'}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="field-label">Section</span>
          <select
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
            required
          >
            {(options?.categories ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {language === 'ne' ? c.label.ne : c.label.en}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Publisher</span>
          <select value={sourceSlug} onChange={(e) => setSourceSlug(e.target.value)} required>
            {sources.length === 0 && <option value="">No publisher for this language</option>}
            {sources.map((s) => (
              <option key={s.slug} value={s.slug} disabled={!s.licensed}>
                {s.displayName}
                {s.licensed ? '' : ' — no agreed licence'}
              </option>
            ))}
          </select>
          {chosen && !chosen.licensed && (
            <span className="field-note field-warn">
              This publisher has no agreed licence, so the story could not be published.
            </span>
          )}
        </label>

        <label className="field">
          <span className="field-label">
            Headline <span className="field-optional">optional — you can write it in the composer</span>
          </span>
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={90}
            placeholder={language === 'ne' ? 'शीर्षक' : 'Headline'}
            lang={language}
          />
        </label>

        {error && <div className="banner banner-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy || !sourceSlug}>
          {busy ? 'Creating…' : 'Create draft and open composer'}
        </button>
      </form>
    </>
  );
}
