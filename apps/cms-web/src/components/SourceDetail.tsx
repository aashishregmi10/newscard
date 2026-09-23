import { useEffect, useState } from 'react';
import { api, type LicenceStatus, type SourceDetail as SourceDetailData } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime, plural } from '../lib/format';
import { ingestHealth, licenceLook } from '../lib/sources';
import { Routes, type Role } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Field,
  Fieldset,
  Panel,
  Segmented,
  Select,
  Skeleton,
} from '../ui';

/**
 * One publisher.
 *
 * Three panels rather than tabs. The licence is the reason the screen exists —
 * it is the legal gate that decides whether a story may be written or published
 * at all — and putting it behind a click would be the opposite of the point.
 *
 * Read-only for anyone who is not an admin. The server holds the same line
 * (`source.write` and `source.setLicence` are admin-only), but disabled fields
 * with a sentence saying why are a better answer than mysteriously absent ones:
 * an author is here precisely because a publisher was missing from the composer
 * and they want to know what happened.
 */

const POLL_INTERVALS = [5, 15, 30, 60] as const;

/** `<input type="date">` wants yyyy-mm-dd; the API speaks ISO-8601. */
function toDateInput(iso: string | null): string {
  return iso === null ? '' : (iso.slice(0, 10) ?? '');
}

export function SourceDetail({ slug, role }: { slug: string; role: Role }) {
  const { data, error: loadError, loading, reload } = useResource<SourceDetailData>(
    async (signal) => (await api.source(slug, signal)).source,
    `source:${slug}`,
    'Could not open this publisher.',
  );

  const details = useAsyncAction('Could not save the publisher.');
  const licence = useAsyncAction('Could not change the licence.');
  const isAdmin = role === 'admin';

  // Details panel
  const [displayName, setDisplayName] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [language, setLanguage] = useState<'ne' | 'en'>('ne');
  const [priority, setPriority] = useState(50);
  const [active, setActive] = useState<'active' | 'inactive'>('active');

  // Ingestion panel
  const [method, setMethod] = useState<'manual' | 'rss' | 'api'>('manual');
  const [feedUrl, setFeedUrl] = useState('');
  const [pollIntervalMin, setPollIntervalMin] = useState(15);

  // Licence panel
  const [status, setStatus] = useState<LicenceStatus>('unknown');
  const [agreementRef, setAgreementRef] = useState('');
  const [agreedAt, setAgreedAt] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  /* Seeded from the server on every load, including the reload after a save —
     unlike the composer, nothing here is typed continuously, so there is no
     half-finished sentence for a refresh to overwrite. */
  useEffect(() => {
    if (data === null) return;
    setDisplayName(data.displayName);
    setHomepageUrl(data.homepageUrl);
    setLogoUrl(data.logoUrl ?? '');
    setLanguage(data.language);
    setPriority(data.priority);
    setActive(data.isActive ? 'active' : 'inactive');
    setMethod(data.ingest.method);
    setFeedUrl(data.ingest.feedUrl ?? '');
    setPollIntervalMin(data.ingest.pollIntervalMin);
    setStatus(data.licence.status);
    setAgreementRef(data.licence.agreementRef ?? '');
    setAgreedAt(toDateInput(data.licence.agreedAt));
    setContactEmail(data.licence.contactEmail ?? '');
    setNote('');
    setConfirming(false);
  }, [data]);

  if (loadError !== null && data === null) {
    return (
      <div className="page page-narrow">
        <Banner tone="error">{loadError}</Banner>
        <div className="actions actions-plain">
          <Button icon="arrowLeft" onClick={() => navigate(Routes.sources())}>
            Back to publishers
          </Button>
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || data === null) {
    return (
      <div className="page page-narrow" aria-busy="true">
        <div className="detail-bar">
          <Skeleton height={16} width={240} />
        </div>
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={40} style={{ marginBottom: 20 }} />
            <Skeleton height={40} style={{ marginBottom: 20 }} />
            <Skeleton height={40} />
          </div>
        </div>
      </div>
    );
  }

  const look = licenceLook(data.licence.status);
  const health = ingestHealth(data.ingest);

  /* Against the STORED status, not the one selected in the form — the warning
     has to describe what the save will actually do. */
  const wouldWithdraw = data.licence.status === 'agreed' && status !== 'agreed';
  const needsContact = status === 'agreed' && contactEmail.trim() === '';
  const needsNote = wouldWithdraw && note.trim().length < 10;
  const feedMissing = method === 'rss' && feedUrl.trim() === '';

  const saveDetails = () =>
    void details
      .run(() =>
        api.saveSource(slug, {
          displayName: displayName.trim(),
          homepageUrl: homepageUrl.trim(),
          logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
          language,
          priority,
          isActive: active === 'active',
          ingest: {
            method,
            feedUrl: feedUrl.trim() === '' ? null : feedUrl.trim(),
            pollIntervalMin,
          },
        }),
      )
      .then((ok) => {
        if (ok) reload();
      });

  const saveLicence = () => {
    if (wouldWithdraw && !confirming) {
      setConfirming(true);
      return;
    }
    void licence
      .run(() =>
        api.setSourceLicence(slug, {
          status,
          agreementRef: agreementRef.trim() === '' ? null : agreementRef.trim(),
          agreedAt: agreedAt === '' ? null : new Date(`${agreedAt}T00:00:00Z`).toISOString(),
          contactEmail: contactEmail.trim() === '' ? null : contactEmail.trim(),
          ...(note.trim() !== '' && { note: note.trim() }),
        }),
      )
      .then((ok) => {
        if (ok) reload();
      });
  };

  return (
    <div className="page page-narrow">
      <h1 className="sr-only">{data.displayName}</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs(
            { label: 'Publishers', route: Routes.sources() },
            { label: data.displayName },
          )}
        />
        <div className="detail-bar-actions">
          <Badge tone={look.tone} icon={look.icon}>
            {look.label}
          </Badge>
        </div>
      </div>

      {!isAdmin && (
        <Banner tone="info" live={false}>
          Publishers are managed by an administrator. This is the record of who we may file
          stories against, and why.
        </Banner>
      )}

      {/* ------------------------------------------------------- licence */}

      <Panel title="Licence">
        <Banner tone={look.tone === 'ok' ? 'ok' : look.tone === 'bad' ? 'error' : 'warn'} live={false}>
          {look.blurb}
          {data.licence.agreedAt !== null && ` Agreed ${dateTime(data.licence.agreedAt)}.`}
          {data.licence.agreementRef !== null && ` Reference: ${data.licence.agreementRef}.`}
        </Banner>

        {/* Stories filed under an agreement that has since lapsed. They stay
            live and keep their attribution; only new work is blocked. */}
        {data.licence.status !== 'agreed' && data.articles.published > 0 && (
          <Banner tone="warn" live={false}>
            <strong>{plural(data.articles.published, 'published story', 'published stories')}</strong>{' '}
            were filed under a previous agreement. They remain live and keep their attribution;
            nothing new can be written or published against this publisher.
          </Banner>
        )}

        {licence.error !== null && <Banner tone="error">{licence.error}</Banner>}

        {isAdmin ? (
          <>
            <Fieldset legend="Status">
              {(g) => (
                <Segmented
                  {...g}
                  aria-label="Licence status"
                  value={status}
                  onChange={(next) => {
                    setStatus(next);
                    setConfirming(false);
                  }}
                  options={[
                    { value: 'unknown', label: 'Not asked' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'agreed', label: 'Agreed' },
                    { value: 'refused', label: 'Refused' },
                  ]}
                />
              )}
            </Fieldset>

            <Field label="Agreement reference" optional="optional">
              {(f) => (
                <input
                  {...f}
                  className="input"
                  placeholder="Signed MOU, 12 Sept 2026"
                  value={agreementRef}
                  onChange={(e) => setAgreementRef(e.target.value)}
                />
              )}
            </Field>

            <Field label="Agreed on" optional="optional">
              {(f) => (
                <input
                  {...f}
                  className="input"
                  type="date"
                  value={agreedAt}
                  onChange={(e) => setAgreedAt(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Takedown contact"
              invalid={needsContact}
              note={
                needsContact
                  ? 'A licensed publisher needs a takedown contact — we promise a 24-hour response and cannot meet it without one.'
                  : 'Where a takedown demand goes. Required once a licence is agreed.'
              }
              noteTone={needsContact ? 'bad' : 'default'}
            >
              {(f) => (
                <input
                  {...f}
                  className="input"
                  type="email"
                  placeholder="legal@publisher.example.invalid"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              )}
            </Field>

            {wouldWithdraw && (
              <Field
                label="Why"
                invalid={needsNote && confirming}
                note="Granting a licence is evidenced by the reference above. Withdrawing one is evidenced by nothing unless you say so here."
                noteTone={needsNote && confirming ? 'bad' : 'default'}
              >
                {(f) => (
                  <textarea
                    {...f}
                    className="textarea"
                    rows={2}
                    style={{ minHeight: 'auto' }}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
            )}

            {/*
              * Two steps to withdraw, with the count in the button.
              *
              * The number comes from the record already loaded, so the
              * consequence is on screen BEFORE the click rather than in the
              * response to it.
              */}
            {confirming && wouldWithdraw && (
              <Banner tone="warn">
                <strong>Stop using {data.displayName}?</strong>{' '}
                {plural(data.articles.published, 'published story', 'published stories')} stay live
                and keep their attribution.{' '}
                {plural(
                  data.articles.total - data.articles.published,
                  'story in progress',
                  'stories in progress',
                )}{' '}
                can no longer be published, and no new ones can be started. This is reversible.
              </Banner>
            )}

            <div className="actions">
              <Button
                variant={wouldWithdraw ? 'danger' : 'primary'}
                icon={wouldWithdraw ? 'ban' : 'checkCircle'}
                busy={licence.busy}
                disabled={needsContact || (confirming && needsNote)}
                onClick={saveLicence}
              >
                {wouldWithdraw
                  ? confirming
                    ? 'Yes, withdraw the licence'
                    : 'Withdraw the licence'
                  : 'Save the licence'}
              </Button>
              {confirming && (
                <Button disabled={licence.busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="meta-line">
            <span>{look.label}</span>
            {data.licence.contactEmail !== null && <span>{data.licence.contactEmail}</span>}
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------------- details */}

      <Panel title="Details">
        {details.error !== null && <Banner tone="error">{details.error}</Banner>}
        {details.notice !== null && (
          <Banner tone="ok" onDismiss={details.clear}>
            {details.notice}
          </Banner>
        )}

        {/* Static text, not a disabled input — a greyed box invites clicking. */}
        <div className="field">
          <p className="field-plain-label">Slug</p>
          <p className="item-title">{data.slug}</p>
          <p className="field-note">
            This publisher’s address in the CMS, and how stories reference them. It cannot be
            changed — rename the display name instead.
          </p>
        </div>

        <Field
          label="Display name"
          note="Exactly as the publisher writes it on their own masthead, not as their domain spells it."
        >
          {(f) => (
            <input
              {...f}
              className="input"
              lang={language}
              value={displayName}
              disabled={!isAdmin}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
        </Field>

        <Field label="Homepage URL">
          {(f) => (
            <input
              {...f}
              className="input"
              type="url"
              value={homepageUrl}
              disabled={!isAdmin}
              onChange={(e) => setHomepageUrl(e.target.value)}
            />
          )}
        </Field>

        <Field label="Logo URL" optional="optional">
          {(f) => (
            <input
              {...f}
              className="input"
              type="url"
              value={logoUrl}
              disabled={!isAdmin}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
          )}
        </Field>

        <Fieldset legend="Language">
          {(g) => (
            <Segmented
              {...g}
              aria-label="Language"
              disabled={!isAdmin}
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'ne', label: 'नेपाली', lang: 'ne' },
                { value: 'en', label: 'English', lang: 'en' },
              ]}
            />
          )}
        </Fieldset>

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
              disabled={!isAdmin}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          )}
        </Field>

        <Fieldset
          legend="Status"
          note="Deactivating stops new stories being filed and blocks publication of existing drafts. Published stories stay live."
        >
          {(g) => (
            <Segmented
              {...g}
              aria-label="Active"
              disabled={!isAdmin}
              value={active}
              onChange={setActive}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          )}
        </Fieldset>
      </Panel>

      {/* ----------------------------------------------------- ingestion */}

      <Panel title="Ingestion">
        <Fieldset legend="Method">
          {(g) => (
            <Segmented
              {...g}
              aria-label="Ingest method"
              disabled={!isAdmin}
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

        {/* Absent from the DOM entirely when it does not apply. A field that is
            permanently visible and only sometimes required teaches people to
            ignore its validation. */}
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
                disabled={!isAdmin}
                onChange={(e) => setFeedUrl(e.target.value)}
              />
            )}
          </Field>
        )}

        {method !== 'manual' && (
          <Field
            label="Poll every"
            note="Never below five minutes — a courtesy to the publisher’s servers, enforced in the database as well as here."
          >
            {(f) => (
              <Select
                {...f}
                value={String(pollIntervalMin)}
                disabled={!isAdmin}
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

        <div className="actions actions-plain">
          <p className="meta-line">
            <span>Last polled {dateTime(data.ingest.lastPolledAt) ?? '—'}</span>
            <span>Last success {dateTime(data.ingest.lastSuccessAt) ?? '—'}</span>
            <span>{health.label}</span>
            <span>{data.pollable ? 'Would be polled' : 'Would not be polled'}</span>
          </p>
        </div>
        <p className="field-note">
          Nothing polls these feeds yet — ingestion is not built and is blocked on publisher
          licensing. These three figures are written by the poller when it exists.
        </p>

        {isAdmin && (
          <div className="actions">
            <Button
              variant="primary"
              icon="check"
              busy={details.busy}
              disabled={feedMissing}
              onClick={saveDetails}
            >
              Save changes
            </Button>
            <Button disabled={details.busy} onClick={() => navigate(Routes.sources())}>
              Back to publishers
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
