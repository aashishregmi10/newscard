import { useState, type FormEvent } from 'react';
import { api, ApiError, type NewStoryOptions } from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Field,
  Fieldset,
  Listbox,
  Panel,
  Segmented,
  Skeleton,
} from '../ui';

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
 * -- Why the fields sit two to a row ----------------------------------------
 *
 * Four short controls stacked one per row made a column of four boxes down the
 * middle of a 1900px screen, each of them 720px wide for a value that is never
 * longer than a publisher's name. The eye travels the whole height of the
 * window to read four words.
 *
 * They are now a 12-column grid, six each: language beside section, publisher
 * beside headline. Two rows instead of four.
 *
 * The measure went away entirely rather than widening — see layout.css. A page
 * cap makes every field narrower in order to stop one being too wide, which is
 * the wrong end to solve it from; a field that should be short takes fewer
 * columns instead.
 *
 * -- Why there is a column beside the form ----------------------------------
 *
 * Not to fill the space. The licence state of the chosen publisher decides
 * whether this story can ever reach a reader, and it used to be a grey note
 * under the select that said so in passing. It is the single most consequential
 * thing on the screen, so it is stated where it cannot be skimmed past, and it
 * changes as the publisher changes.
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
      <div className="page">
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
    <div className="page">
      <h1 className="sr-only">New story</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Queue', route: Routes.queue() }, { label: 'New story' })}
        />
        <div className="detail-bar-actions">
          <Button size="sm" disabled={busy} onClick={goToQueue}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="grid">
        <div className="col-8">
          <Panel
            title="Where this story goes"
            note="Three questions. The rest is the composer’s job."
          >
            <form onSubmit={submit}>
              {loading || options === null ? (
                <div className="grid" aria-busy="true">
                  <div className="col-6">
                    <Skeleton height={11} width={70} />
                    <Skeleton height={40} style={{ marginTop: 10 }} />
                  </div>
                  <div className="col-6">
                    <Skeleton height={11} width={70} />
                    <Skeleton height={40} style={{ marginTop: 10 }} />
                  </div>
                  <div className="col-6">
                    <Skeleton height={11} width={70} />
                    <Skeleton height={40} style={{ marginTop: 10 }} />
                  </div>
                  <div className="col-6">
                    <Skeleton height={11} width={70} />
                    <Skeleton height={40} style={{ marginTop: 10 }} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid">
                    <div className="col-6">
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
                    </div>

                    <div className="col-6">
                      <Field label="Section">
                        {(f) => (
                          <Listbox
                            {...f}
                            value={category?.slug ?? ''}
                            onChange={(v) => setCategoryChoice(v)}
                            options={categories.map((c) => ({
                              value: c.slug,
                              label: language === 'ne' ? c.label.ne : c.label.en,
                              lang: language,
                            }))}
                          />
                        )}
                      </Field>
                    </div>

                    <div className="col-6">
                      <Field label="Publisher">
                        {(f) => (
                          <Listbox
                            {...f}
                            value={source?.slug ?? ''}
                            onChange={(v) => setSourceChoice(v)}
                            emptyLabel="No publisher for this language"
                            /*
                              * An unlicensed publisher is listed, greyed, with
                              * the reason on its own line rather than glued to
                              * the end of the name. Hiding it would be kinder
                              * to the code and worse for the editor, who would
                              * look for a publisher they know exists and
                              * conclude the list was broken.
                              */
                            options={sources.map((s) => ({
                              value: s.slug,
                              label: s.displayName,
                              disabled: !s.licensed,
                              disabledReason: 'No agreed licence',
                            }))}
                          />
                        )}
                      </Field>
                    </div>

                    {/*
                      * "optional" is one word here, not a sentence.
                      *
                      * The label sits on the field's border and the notch is
                      * cut to its width — so a label reading "Headline
                      * optional — you can write it in the composer" cuts a gap
                      * most of the way across the top of the box, and fills the
                      * empty field with a line of grey text. The explanation
                      * belongs in the helper line.
                      */}
                    <div className="col-6">
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
                    </div>
                  </div>

                  {error !== null && <Banner tone="error">{error}</Banner>}

                  <div className="actions">
                    <Button
                      type="submit"
                      variant="primary"
                      icon="plus"
                      busy={busy}
                      disabled={source === null || category === null}
                    >
                      Create the draft and open the composer
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Panel>
        </div>

        <aside className="col-4">
          <Panel title="Before you start" headingLevel={2}>
            {source === null ? (
              <p className="prose">
                There is no publisher on file for this language yet. A story has to be filed
                against one, so add the publisher first.
              </p>
            ) : source.licensed ? (
              <>
                <p className="meta-line">
                  <Badge tone="ok" icon="checkCircle">
                    Licensed
                  </Badge>
                </p>
                <p className="prose" style={{ marginTop: 'var(--s3)' }}>
                  We have an agreed licence with {source.displayName}, so a summary of their
                  reporting can be published once it has been approved.
                </p>
              </>
            ) : (
              <>
                <p className="meta-line">
                  <Badge tone="bad" icon="alertCircle">
                    No agreed licence
                  </Badge>
                </p>
                <p className="prose" style={{ marginTop: 'var(--s3)' }}>
                  {source.displayName} has not agreed a licence. You can write the draft, but
                  publishing will refuse it — the gate is on the publisher, not on the story, and
                  it is checked again at the moment of publication.
                </p>
              </>
            )}

            <h3 className="field-legend" style={{ marginTop: 'var(--s6)' }}>
              What happens next
            </h3>
            <ol className="steps">
              <li>
                <strong>Draft.</strong> The composer opens with the source article beside the
                summary box. Everything autosaves.
              </li>
              <li>
                <strong>Review.</strong> Another editor reads it. You cannot approve your own
                summary once a second editor is active.
              </li>
              <li>
                <strong>Publish.</strong> The licence, the picture’s credit and the length are all
                checked again before it reaches a reader.
              </li>
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
