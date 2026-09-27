import { useState, type FormEvent } from 'react';
import { api, ApiError, type IngestMethod } from '../api';
import { crumbs } from '../lib/crumbs';
import { suggestSlug } from '../lib/sources';
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
} from '../ui';

/**
 * Adding a publisher.
 *
 * -- Why there is no licence on this screen ----------------------------------
 *
 * Recording that a publisher exists and asserting that they agreed to something
 * are two different acts. The permission matrix already separates them —
 * `source.write` and `source.setLicence` are distinct rows — and the server
 * enforces it by ignoring any licence in a create request: a new publisher
 * always starts `pending`, whatever is sent.
 *
 * So the screen does not offer the field at all, and says why. Offering a
 * control the server will overrule is worse than offering nothing.
 *
 * -- Why the warning moved out of a banner -----------------------------------
 *
 * It was a banner across the top of the form. A banner is read once, before the
 * form is filled in, and then scrolled past — and what it says is the entire
 * reason the next screen exists. Beside the form it is still on screen when the
 * editor presses Add.
 */

const POLL_INTERVALS = [5, 15, 30, 60] as const;

export function NewSource() {
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [homepageUrl, setHomepageUrl] = useState('');
  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [method, setMethod] = useState<IngestMethod>('manual');
  const [feedUrl, setFeedUrl] = useState('');
  const [pollIntervalMin, setPollIntervalMin] = useState(15);
  const [priority, setPriority] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goToList = () => navigate(Routes.sources());

  /*
   * The slug follows the name until somebody types in it, and then stops.
   *
   * A suggestion that keeps overwriting what you typed is worse than no
   * suggestion. Devanagari yields an empty suggestion by design — see
   * suggestSlug — so a Nepali masthead means typing one, which is correct: a
   * romanisation we invented would be permanent and worse than the editor's.
   */
  const onName = (value: string) => {
    setDisplayName(value);
    if (!slugEdited) setSlug(suggestSlug(value));
  };

  const feedMissing = method === 'rss' && feedUrl.trim() === '';
  const complete =
    displayName.trim() !== '' && slug.trim() !== '' && homepageUrl.trim() !== '' && !feedMissing;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !complete) return;

    setBusy(true);
    setError(null);
    try {
      const { slug: created } = await api.createSource({
        slug: slug.trim(),
        displayName: displayName.trim(),
        homepageUrl: homepageUrl.trim(),
        logoUrl: null,
        language,
        ingest: {
          method,
          feedUrl: feedUrl.trim() === '' ? null : feedUrl.trim(),
          pollIntervalMin,
        },
        priority,
        isActive: true,
      });
      /* Straight to the record, which is where the licence is recorded — the
         next thing anyone wants to do. */
      navigate(Routes.source(created));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the publisher.');
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="sr-only">New publisher</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs(
            { label: 'Publishers', route: Routes.sources() },
            { label: 'New publisher' },
          )}
        />
        <div className="detail-bar-actions">
          <Button size="sm" disabled={busy} onClick={goToList}>
            Cancel
          </Button>
        </div>
      </div>

      {error !== null && <Banner tone="error">{error}</Banner>}

      <form onSubmit={submit}>
        <div className="grid">
          <div className="col-8">
            <Panel title="Who they are">
              <div className="grid">
                <div className="col-6">
                  <Field
                    label="Display name"
                    note="Exactly as the publisher writes it on their own masthead, not as their domain spells it."
                  >
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        lang={language}
                        autoFocus
                        value={displayName}
                        onChange={(e) => onName(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

                <div className="col-6">
                  <Field
                    label="Slug"
                    note="Permanent. It is this publisher’s address in the CMS and how every story references them."
                  >
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        value={slug}
                        placeholder="namuna-khabar"
                        onChange={(e) => {
                          setSlugEdited(true);
                          setSlug(e.target.value.toLowerCase());
                        }}
                      />
                    )}
                  </Field>
                </div>

                {/* A URL is the one value here that genuinely runs long, so it
                    keeps the full width rather than being cut to half for the
                    sake of the pattern. */}
                <div className="col-12">
                  <Field label="Homepage URL">
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        type="url"
                        placeholder="https://publisher.example.invalid"
                        value={homepageUrl}
                        onChange={(e) => setHomepageUrl(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

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
                  <Field
                    label="Priority"
                    note="Lower numbers are preferred. Used only as a tiebreaker when several publishers carry the same story."
                  >
                    {(f) => (
                      <input
                        {...f}
                        className="input"
                        type="number"
                        min={0}
                        max={999}
                        value={priority}
                        onChange={(e) => setPriority(Number(e.target.value))}
                      />
                    )}
                  </Field>
                </div>
              </div>
            </Panel>

            <Panel title="How their stories reach us">
              <div className="grid">
                <div className="col-6">
                  <Fieldset
                    legend="Method"
                    note="Recording a feed prepares for automated ingestion. Nothing polls it yet."
                  >
                    {(g) => (
                      <Segmented
                        {...g}
                        aria-label="Ingest method"
                        value={method}
                        onChange={setMethod}
                        options={[
                          { value: 'manual', label: 'Manual' },
                          { value: 'rss', label: 'RSS' },
                          { value: 'api', label: 'API' },
                        ]}
                      />
                    )}
                  </Fieldset>
                </div>

                {method !== 'manual' && (
                  <div className="col-6">
                    <Field
                      label="Poll every"
                      note="Never below five minutes, out of courtesy to their servers."
                    >
                      {(f) => (
                        <Listbox
                          {...f}
                          value={String(pollIntervalMin)}
                          onChange={(v) => setPollIntervalMin(Number(v))}
                          options={POLL_INTERVALS.map((m) => ({
                            value: String(m),
                            label: m + ' minutes',
                          }))}
                        />
                      )}
                    </Field>
                  </div>
                )}

                {method !== 'manual' && (
                  <div className="col-12">
                    <Field
                      label="Feed URL"
                      invalid={feedMissing}
                      note={feedMissing ? 'An RSS publisher needs a feed to poll.' : undefined}
                      noteTone="bad"
                    >
                      {(f) => (
                        <input
                          {...f}
                          className="input"
                          type="url"
                          placeholder="https://publisher.example.invalid/feed"
                          value={feedUrl}
                          onChange={(e) => setFeedUrl(e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                )}
              </div>

              <div className="actions">
                <Button
                  type="submit"
                  variant="primary"
                  icon="plus"
                  busy={busy}
                  disabled={!complete}
                >
                  Add the publisher
                </Button>
                <Button disabled={busy} onClick={goToList}>
                  Cancel
                </Button>
              </div>
            </Panel>
          </div>

          <aside className="col-4 sticky-aside">
            <Panel title="Before you add them">
              <p className="meta-line">
                <Badge tone="warn" icon="alertTriangle">
                  Starts unlicensed
                </Badge>
              </p>
              <p className="prose" style={{ marginTop: 'var(--s3)' }}>
                A new publisher always starts with <strong>no agreed licence</strong>, whatever is
                sent — the server overrules it. Nothing can be published against them until the
                agreement is recorded on their own page.
              </p>

              <h3 className="field-legend" style={{ marginTop: 'var(--s6)' }}>
                What happens next
              </h3>
              <ol className="steps">
                <li>
                  <strong>Added.</strong> You land on their record, which is where the licence is
                  recorded.
                </li>
                <li>
                  <strong>Licensed.</strong> An admin sets the agreed licence, with the agreement
                  reference as the evidence for it.
                </li>
                <li>
                  <strong>Publishable.</strong> Only then can a summary of their reporting reach a
                  reader.
                </li>
              </ol>
            </Panel>
          </aside>
        </div>
      </form>
    </div>
  );
}
