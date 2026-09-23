import { useState, type FormEvent } from 'react';
import { api, ApiError, type IngestMethod } from '../api';
import { crumbs } from '../lib/crumbs';
import { suggestSlug } from '../lib/sources';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import { Banner, Breadcrumbs, Button, Field, Fieldset, Segmented, Select } from '../ui';

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
    <div className="page page-narrow">
      <h1 className="sr-only">New publisher</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Publishers', route: Routes.sources() }, { label: 'New publisher' })}
        />
        <div className="detail-bar-actions">
          <Button size="sm" disabled={busy} onClick={goToList}>
            Cancel
          </Button>
        </div>
      </div>

      <Banner tone="info" live={false}>
        A new publisher starts with <strong>no agreed licence</strong>, so nothing can be
        published against them yet. Record the agreement on their page once it is signed.
      </Banner>

      {error !== null && <Banner tone="error">{error}</Banner>}

      <div className="panel">
        <header className="panel-head">
          <h2 className="panel-title">Who they are</h2>
        </header>
        <form className="panel-body" onSubmit={submit}>
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

          <Fieldset
            legend="How their stories reach us"
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

          {method !== 'manual' && (
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
          )}

          {method !== 'manual' && (
            <Field label="Poll every" note="Never below five minutes, out of courtesy to their servers.">
              {(f) => (
                <Select
                  {...f}
                  value={String(pollIntervalMin)}
                  onChange={(e) => setPollIntervalMin(Number(e.target.value))}
                >
                  {POLL_INTERVALS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

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

          <div className="actions">
            <Button type="submit" variant="primary" icon="plus" block busy={busy} disabled={!complete}>
              Add the publisher
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
