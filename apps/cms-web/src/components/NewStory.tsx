import { useState, type FormEvent } from 'react';
import { api, ApiError, type NewStoryOptions } from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import { Banner, Breadcrumbs, Button, Field, Fieldset, Segmented, Select, Skeleton } from '../ui';

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
 *
 * -- Derived, not synchronised ----------------------------------------------
 *
 * The publisher used to be state kept in step with the language by an effect,
 * which needed an exhaustive-deps suppression to stop it fighting itself.
 * Switching to Nepali would leave an English-only publisher selected for one
 * render before the effect corrected it — brief, but a submit in that window
 * filed the story against a publisher we have no agreement with.
 *
 * The selection is now DERIVED: whatever the editor last chose, if it is still
 * valid for the chosen language, otherwise the first licensed publisher for it.
 * There is no window in which the two disagree, because there is only one
 * source of truth and the other value is computed from it.
 */

interface Props {
  /** Defaults exist so the screen can be rendered without the router. */
  onCreated?: (id: string) => void;
  onCancel?: () => void;
}

export function NewStory({ onCreated, onCancel }: Props) {
  const { data: options, error: loadError, loading, reload } = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections and publishers.',
  );

  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [sourceChoice, setSourceChoice] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goToQueue = () => (onCancel === undefined ? navigate(Routes.queue()) : onCancel());

  const categories = options?.categories ?? [];
  /*
   * Publishers are filtered to the chosen language. A Nepali story filed
   * against an English-only publisher is an attribution error, and it is easier
   * to make it impossible here than to catch it in review.
   */
  const sources = (options?.sources ?? []).filter((s) => s.language === language);

  const category =
    categories.find((c) => c.slug === categoryChoice) ?? categories[0] ?? null;
  const source =
    sources.find((s) => s.slug === sourceChoice) ??
    sources.find((s) => s.licensed) ??
    sources[0] ??
    null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || category === null || source === null) return;

    setBusy(true);
    setError(null);
    try {
      const { id } = await api.create({
        language,
        categorySlug: category.slug,
        sourceSlug: source.slug,
        headline: headline.trim() === '' ? undefined : headline.trim(),
      });
      if (onCreated === undefined) navigate(Routes.article(id));
      else onCreated(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the story.');
      setBusy(false);
    }
  };

  if (loadError !== null && options === null) {
    return (
      <div className="page page-narrow">
        <Banner tone="error">{loadError}</Banner>
        <div className="actions actions-plain">
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
          <Button icon="arrowLeft" onClick={goToQueue}>
            Back to the queue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <h1 className="sr-only">New story</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Queue', route: Routes.queue() }, { label: 'New story' })}
        />
        {/*
          * Only the control belongs here.
          *
          * A sentence of explanation was in this bar too, and on a 720px form
          * it did not fit beside the trail — so it wrapped onto a second line
          * and sat right-aligned under the breadcrumbs, which read as a
          * layout fault. It is the panel's subtitle now, where it has room.
          */}
        <div className="detail-bar-actions">
          <Button size="sm" disabled={busy} onClick={goToQueue}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="panel">
        <header className="panel-head">
          <h2 className="panel-title">Where this story goes</h2>
          <span className="panel-head-note">Three questions. The rest is the composer’s job.</span>
        </header>
        <form className="panel-body" onSubmit={submit}>
          {loading || options === null ? (
            <div aria-busy="true">
              <Skeleton height={11} width={70} />
              <Skeleton height={38} width={200} style={{ marginTop: 10, marginBottom: 26 }} />
              <Skeleton height={11} width={70} />
              <Skeleton height={40} style={{ marginTop: 10, marginBottom: 26 }} />
              <Skeleton height={11} width={70} />
              <Skeleton height={40} style={{ marginTop: 10 }} />
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
                    required
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {language === 'ne' ? c.label.ne : c.label.en}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                label="Publisher"
                note={
                  source !== null && !source.licensed
                    ? 'This publisher has no agreed licence, so the story could not be published.'
                    : undefined
                }
                noteTone="warn"
              >
                {(f) => (
                  <Select
                    {...f}
                    value={source?.slug ?? ''}
                    onChange={(e) => setSourceChoice(e.target.value)}
                    required
                  >
                    {sources.length === 0 && (
                      <option value="">No publisher for this language</option>
                    )}
                    {sources.map((s) => (
                      <option key={s.slug} value={s.slug} disabled={!s.licensed}>
                        {s.displayName}
                        {s.licensed ? '' : ' — no agreed licence'}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {/*
                * "optional" is one word here, not a sentence.
                *
                * The label sits on the field's border and the notch is cut to
                * its width — so a label reading "Headline optional — you can
                * write it in the composer" cuts a gap most of the way across
                * the top of the box, and fills the empty field with a line of
                * grey text. The explanation belongs in the helper line.
                */}
              <Field
                label="Headline"
                optional="optional"
                note="You can write it in the composer instead."
              >
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    lang={language}
                    value={headline}
                    maxLength={90}
                    placeholder={language === 'ne' ? 'शीर्षक' : 'Headline'}
                    onChange={(e) => setHeadline(e.target.value)}
                  />
                )}
              </Field>

              {error !== null && <Banner tone="error">{error}</Banner>}

              <div className="actions">
                <Button
                  type="submit"
                  variant="primary"
                  icon="plus"
                  block
                  busy={busy}
                  disabled={source === null || category === null}
                >
                  Create the draft and open the composer
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
