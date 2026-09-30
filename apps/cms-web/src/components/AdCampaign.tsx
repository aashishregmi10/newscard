import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type AdCampaignDetail,
  type AdCampaignInput,
  type AdImage,
  type AdPlacement,
  type AdReport,
  type AdvertiserRow,
  type NewStoryOptions,
} from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { percent, rupees } from '../lib/format';
import { countGraphemes } from '../lib/measure';
import { mediaUrl } from '../lib/media';
import { Routes } from '../nav';
import { navigate } from '../useRoute';
import {
  Banner,
  Breadcrumbs,
  Button,
  Counter,
  Field,
  Fieldset,
  FileDrop,
  Icon,
  Listbox,
  Panel,
  Segmented,
  Skeleton,
  ToggleGroup,
} from '../ui';
import { PLACEMENT_LABEL } from './Ads';

/**
 * One campaign: creating it, changing it, and seeing what it bought.
 *
 * -- The share of voice, before saving ----------------------------------------
 *
 * The number a client actually buys is not the price, it is the share of the
 * placement that price commands among everyone else running at the same time.
 * So the form asks the server — the same functions serving draws with — what
 * share this price would get on the campaign's first day, and shows it beside
 * the price as it is typed. The client sees what they are buying before it is
 * sold to them.
 *
 * -- The phone beside the form ------------------------------------------------
 *
 * An advertiser's poster is a designed thing, and the only way to know whether
 * it survives being a card on a 360-pixel phone is to look. The preview is
 * drawn from the same fields the app receives, in the campaign's language.
 *
 * -- Why the report token is shown once ---------------------------------------
 *
 * Only its hash is stored. That is what makes a leaked database worthless for
 * reading an advertiser's figures, and it means there is nothing to look up
 * later: a lost token is replaced, which also revokes the old one.
 */

/** Matches INLINE_AD_TEXT_MAX on the server. */
const INLINE_TEXT_MAX = 24;
const HEADLINE_MAX = 90;
const CTA_MAX = 24;

/** yyyy-mm-dd in the browser's own day — Nepal time, for this newsroom. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
/** A booked day runs from its first moment to its last, so "1 to 7 Oct" is seven days. */
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d.toISOString());
}

interface Draft {
  advertiserId: string;
  name: string;
  placement: AdPlacement;
  language: 'ne' | 'en';
  categories: string[];
  /**
   * Exact instants, not days. The date inputs show and set whole days, but a
   * campaign loaded from the database keeps its stored times until someone
   * actually changes a date — otherwise opening a campaign would quietly
   * round its flight to whole days, and the share of voice shown in the form
   * would disagree with the one serving is using.
   */
  startsAt: string;
  endsAt: string;
  priceRupees: string;
  status: 'draft' | 'live' | 'paused';
  headline: string;
  body: string;
  ctaNe: string;
  ctaEn: string;
  landingUrl: string;
  image: AdImage | null;
}

function blankDraft(): Draft {
  const today = localDay(new Date().toISOString());
  return {
    advertiserId: '',
    name: '',
    placement: 'card',
    language: 'ne',
    categories: [],
    startsAt: dayStart(today),
    endsAt: dayEnd(addDays(today, 6)),
    priceRupees: '',
    status: 'draft',
    headline: '',
    body: '',
    ctaNe: 'थप हेर्नुहोस्',
    ctaEn: 'Learn more',
    landingUrl: 'https://',
    image: null,
  };
}

function draftFrom(c: AdCampaignDetail): Draft {
  return {
    advertiserId: c.advertiserId,
    name: c.name,
    placement: c.placement,
    language: c.language,
    categories: c.categories,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    priceRupees: String(c.pricePaisa / 100),
    status: c.status,
    headline: c.creative.headline,
    body: c.creative.body ?? '',
    ctaNe: c.creative.callToAction.ne,
    ctaEn: c.creative.callToAction.en,
    landingUrl: c.creative.landingUrl,
    image: c.creative.image,
  };
}

function toInput(d: Draft): AdCampaignInput {
  return {
    advertiserId: d.advertiserId,
    name: d.name.trim(),
    placement: d.placement,
    language: d.language,
    categories: d.categories,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    pricePaisa: Math.round(Number(d.priceRupees || '0') * 100),
    status: d.status,
    creative: {
      headline: d.headline.trim(),
      body: d.placement === 'card' && d.body.trim() !== '' ? d.body.trim() : null,
      callToAction: { ne: d.ctaNe.trim(), en: d.ctaEn.trim() },
      landingUrl: d.landingUrl.trim(),
      image: d.image,
    },
  };
}

/** What stops Save, in words — the same rules the server applies. */
function blockerOf(d: Draft): string | null {
  if (d.advertiserId === '') return 'Choose the advertiser.';
  if (d.name.trim() === '') return 'Give the campaign a name.';
  if (d.startsAt === '' || d.endsAt === '') return 'Set both dates.';
  if (new Date(d.endsAt) <= new Date(d.startsAt)) return 'The end date is before the start.';
  const price = Number(d.priceRupees);
  if (d.priceRupees.trim() === '' || !Number.isFinite(price) || price < 0) {
    return 'Set the price in rupees. Enter 0 for a house ad.';
  }
  if (d.placement === 'inline') {
    if (d.headline.trim().length < 2) return 'Write the small ad’s text.';
    if (countGraphemes(d.headline.trim()) > INLINE_TEXT_MAX) {
      return `The small ad’s text is over ${INLINE_TEXT_MAX} characters.`;
    }
  } else {
    if (d.image === null) return 'Upload the poster.';
    if (d.headline.trim().length < 2) return 'Write the one-line description of the poster.';
    if (d.ctaNe.trim() === '' || d.ctaEn.trim() === '') return 'Set the button text in both languages.';
  }
  if (!/^https:\/\/[^\s/]+\.[^\s]+/.test(d.landingUrl.trim())) {
    return 'The link must be a full https:// address.';
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────── the image */

function AdImageField({
  kind,
  image,
  disabled,
  onChange,
}: {
  kind: 'poster' | 'logo';
  image: AdImage | null;
  disabled: boolean;
  onChange: (next: AdImage | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { image: uploaded } = await api.uploadAdImage(file, kind);
      onChange(uploaded);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const src = image?.urls.md ?? image?.urls.lg ?? image?.urls.sm ?? null;

  return (
    <div className="field">
      <p className="field-heading">
        {kind === 'poster' ? 'Poster' : 'Logo'}{' '}
        {kind === 'logo' && <span className="field-optional">optional</span>}
      </p>
      {error !== null && <Banner tone="error">{error}</Banner>}
      {src !== null ? (
        <div className={kind === 'poster' ? 'ad-image ad-image-poster' : 'ad-image ad-image-logo'}>
          <img src={mediaUrl(src)} alt="" />
          <div className="ad-image-actions">
            {image?.width != null && image.height != null && (
              <p className="meta-line">
                <span>
                  {image.width}×{image.height}
                </span>
              </p>
            )}
            <Button size="sm" icon="trash" disabled={disabled || busy} onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <>
          <FileDrop
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || busy}
            icon="image"
            title={kind === 'poster' ? 'Choose the poster, or drop it here' : 'Choose a logo, or drop it here'}
            hint={
              kind === 'poster'
                ? 'Portrait or square, at least 640px wide. It is shown whole — never cropped.'
                : 'Square works best. It is shown at about 20px beside the text.'
            }
            onSelect={(file) => void onFile(file)}
            onReject={setError}
          />
          {busy && (
            <p className="field-note" role="status">
              <span className="spinner" aria-hidden="true" /> Uploading…
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── the preview */

function PhonePreview({ d, advertiser }: { d: Draft; advertiser: string }) {
  const lang = d.language;
  const name = advertiser || (lang === 'ne' ? 'विज्ञापनदाता' : 'Advertiser');
  const poster = d.image?.urls.md ?? d.image?.urls.lg ?? null;

  if (d.placement === 'inline') {
    const logo = d.image?.urls.sm ?? null;
    return (
      <div className="phone" aria-label="How the small ad appears on a story">
        <div className="phone-photo" />
        <div className="phone-row">
          <span className="phone-source">{lang === 'ne' ? 'नमुना खबर' : 'Sample Post'}</span>
          <span className="phone-pill" lang={lang}>
            {logo !== null && <img src={mediaUrl(logo)} alt="" />}
            <span className="phone-pill-label">{lang === 'ne' ? 'विज्ञापन' : 'Ad'}</span>
            <span className="phone-pill-text">{d.headline.trim() || (lang === 'ne' ? 'तपाईंको सन्देश' : 'Your text')}</span>
            <span aria-hidden="true">›</span>
          </span>
          <span className="phone-icons" aria-hidden="true">♡ ↗</span>
        </div>
        <div className="phone-body">
          <span className="phone-line" style={{ width: '88%' }} />
          <span className="phone-line" style={{ width: '94%' }} />
          <span className="phone-line" style={{ width: '70%' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="phone phone-poster" aria-label="How the full-card ad appears in the feed">
      <div className="phone-sponsor">
        <span className="phone-sponsor-badge">{lang === 'ne' ? 'प्रायोजित' : 'Sponsored'}</span>
        <span>{name}</span>
      </div>
      <div className="phone-poster-frame">
        {poster !== null ? (
          <img src={mediaUrl(poster)} alt={d.headline} />
        ) : (
          <span className="phone-poster-empty">Poster</span>
        )}
      </div>
      <div className="phone-cta" lang={lang}>
        {(lang === 'ne' ? d.ctaNe : d.ctaEn) || '…'} →
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── figures */

function Figures({ report }: { report: AdReport }) {
  const { paid, delivery, engagement, value, reach } = report;
  const stats: Array<{ label: string; value: string; note?: string }> = [
    {
      label: 'Paid',
      value: rupees(paid.pricePaisa),
      note: `${paid.daysElapsed} of ${paid.days} days · ${rupees(paid.pricePerDayPaisa)}/day`,
    },
    {
      label: 'Share of voice now',
      value: paid.shareOfVoiceNow === null ? '—' : percent(paid.shareOfVoiceNow),
      note: paid.shareOfVoiceNow === null ? 'Not running' : 'What its price per day buys today',
    },
    {
      label: 'Share delivered',
      value: percent(delivery.deliveredShare),
      note: 'Of every view in this placement so far',
    },
    {
      label: 'Views',
      value: delivery.impressions.toLocaleString('en-IN'),
      note: `${delivery.viewableImpressions.toLocaleString('en-IN')} on screen ≥1s (${percent(delivery.viewabilityRate)})`,
    },
    {
      label: 'Clicks',
      value: engagement.clicks.toLocaleString('en-IN'),
      note: `${percent(engagement.clickThroughRate)} of views`,
    },
    {
      label: 'People reached',
      value: reach.devices.toLocaleString('en-IN'),
      note: `${reach.averageFrequency} views each on average`,
    },
    {
      label: 'Cost per 1,000 views',
      value: value.costPerThousandViewsPaisa === null ? '—' : rupees(value.costPerThousandViewsPaisa),
      note: `${rupees(value.spentToDatePaisa)} of the price has run`,
    },
    {
      label: 'Cost per click',
      value: value.costPerClickPaisa === null ? '—' : rupees(value.costPerClickPaisa),
    },
  ];

  return (
    <>
      <dl className="stat-grid">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <dt>{s.label}</dt>
            <dd>
              <strong>{s.value}</strong>
              {s.note !== undefined && <span>{s.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {report.byCategory.length > 0 && (
        <p className="meta-line" style={{ marginTop: 'var(--s3)' }}>
          {report.byCategory.slice(0, 6).map((c) => (
            <span key={c.category}>
              {c.category}: {c.impressions.toLocaleString('en-IN')}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/* ───────────────────────────────────────────────────────────── report link */

function ReportLink({ id, hasLink }: { id: string; hasLink: boolean }) {
  const action = useAsyncAction('Could not issue the link.');
  const [issued, setIssued] = useState<{ token: string; replaced: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const reportUrl = `${window.location.origin}/report/`;

  const issue = async () => {
    await action.run(async () => {
      const r = await api.issueReportLink(id);
      setIssued({ token: r.token, replaced: r.replaced });
      setConfirming(false);
    });
  };

  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(label),
      () => setCopied(null),
    );
  };

  const lines = issued
    ? `Report   ${reportUrl}\nCampaign ${id}\nToken    ${issued.token}`
    : '';

  return (
    <Panel title="Advertiser’s report">
      <p className="field-note">
        The advertiser opens <strong>{reportUrl}</strong> and enters the campaign ID and a token.
        They need no account. The token is shown once, here, and only a fingerprint of it is
        stored.
      </p>
      {action.error !== null && <Banner tone="error">{action.error}</Banner>}

      {issued !== null && (
        <div className="token-box" role="status">
          <p>
            <strong>{issued.replaced ? 'New link issued — the previous one has stopped working.' : 'Link issued.'}</strong>{' '}
            Send these three lines to the advertiser now; the token cannot be shown again.
          </p>
          <pre>{lines}</pre>
          <div className="actions actions-plain">
            <Button size="sm" icon="copy" onClick={() => copy('all', lines)}>
              {copied === 'all' ? 'Copied' : 'Copy all three lines'}
            </Button>
            <Button size="sm" icon="copy" onClick={() => copy('token', issued.token)}>
              {copied === 'token' ? 'Copied' : 'Copy the token'}
            </Button>
          </div>
        </div>
      )}

      {issued === null && !confirming && (
        <div className="actions actions-plain">
          <Button
            icon="send"
            busy={action.busy}
            onClick={() => (hasLink ? setConfirming(true) : void issue())}
          >
            {hasLink ? 'Replace the report link' : 'Issue a report link'}
          </Button>
        </div>
      )}
      {confirming && (
        <div className="confirm-strip" role="alert">
          <p>
            <strong>Replace the link?</strong> The advertiser’s current token stops working the
            moment a new one is issued.
          </p>
          <Button size="sm" variant="danger" busy={action.busy} onClick={() => void issue()}>
            Yes, replace it
          </Button>
          <Button size="sm" disabled={action.busy} onClick={() => setConfirming(false)}>
            Keep the current link
          </Button>
        </div>
      )}
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────── the screen */

export function AdCampaign({ id }: { id: string | null }) {
  const isNew = id === null;

  const detail = useResource<{ campaign: AdCampaignDetail; report: AdReport | null } | null>(
    async (signal) => (id === null ? null : api.adCampaign(id, signal)),
    `ad:${id ?? 'new'}`,
    'Could not open this campaign.',
  );
  const advertisers = useResource<{ items: AdvertiserRow[] }>(
    (signal) => api.advertisers(signal),
    'advertisers',
    'Could not load the advertisers.',
  );
  const options = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections.',
  );

  const action = useAsyncAction('Could not save the campaign.');
  const [d, setD] = useState<Draft>(blankDraft);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setD((prev) => ({ ...prev, [key]: value }));

  /* Seed from the loaded campaign, and again after each save reloads it. */
  const seededFrom = useRef<string | null>(null);
  useEffect(() => {
    const c = detail.data?.campaign;
    if (!c) return;
    const stamp = JSON.stringify(c);
    if (seededFrom.current === stamp) return;
    seededFrom.current = stamp;
    setD(draftFrom(c));
  }, [detail.data]);

  /* Share of voice for the price being typed, from the server, debounced. */
  const [sov, setSov] = useState<{ share: number; perDay: number; alongside: number; at: string } | null>(null);
  const priceOk = d.priceRupees.trim() !== '' && Number.isFinite(Number(d.priceRupees));
  const datesOk = d.startsAt !== '' && d.endsAt !== '' && new Date(d.endsAt) > new Date(d.startsAt);
  useEffect(() => {
    if (!priceOk || !datesOk) {
      setSov(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .adSharePreview(
          {
            placement: d.placement,
            pricePaisa: Math.round(Number(d.priceRupees) * 100),
            startsAt: d.startsAt,
            endsAt: d.endsAt,
            ...(id !== null ? { excludeId: id } : {}),
          },
          controller.signal,
        )
        .then((r) =>
          setSov({ share: r.shareOfVoice, perDay: r.pricePerDayPaisa, alongside: r.alongside, at: r.at }),
        )
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [d.placement, d.priceRupees, d.startsAt, d.endsAt, id, priceOk, datesOk]);

  if (!isNew && detail.error !== null && detail.data === null) {
    return (
      <div className="page">
        <Banner tone="error">{detail.error}</Banner>
        <div className="actions actions-plain">
          <Button icon="arrowLeft" onClick={() => navigate(Routes.ads())}>
            Back to advertising
          </Button>
        </div>
      </div>
    );
  }

  if (!isNew && (detail.loading || detail.data === null)) {
    return (
      <div className="page" aria-busy="true">
        <div className="detail-bar">
          <Skeleton height={16} width={240} />
        </div>
        <div className="panel">
          <div className="panel-body">
            <Skeleton height={40} />
            <Skeleton height={40} style={{ marginTop: 20 }} />
          </div>
        </div>
      </div>
    );
  }

  const campaign = detail.data?.campaign ?? null;
  const report = detail.data?.report ?? null;
  const advertiserRows = advertisers.data?.items ?? [];
  const advertiserName = advertiserRows.find((a) => a.id === d.advertiserId)?.displayName ?? '';
  const categories = options.data?.categories ?? [];
  const blocker = blockerOf(d);
  const inlineCount = countGraphemes(d.headline.trim());

  const save = async () => {
    if (blocker !== null) return;
    const input = toInput(d);
    const ok = await action.run(async () => {
      if (id === null) {
        const { id: created } = await api.createAdCampaign(input);
        navigate(Routes.ad(created), { replace: true });
      } else {
        await api.editAdCampaign(id, input);
      }
    }, id === null ? undefined : 'Saved.');
    if (ok && id !== null) detail.reload();
  };

  const title = isNew ? 'New campaign' : campaign?.name || 'Campaign';

  return (
    <div className="page">
      <h1 className="sr-only">{title}</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Advertising', route: Routes.ads() }, { label: title })} />
        <div className="detail-bar-actions">
          <Button size="sm" disabled={action.busy} onClick={() => navigate(Routes.ads())}>
            Cancel
          </Button>
        </div>
      </div>

      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      <div className="grid">
        <div className="col-8">
          <Panel title="The campaign">
            {advertisers.data !== null && advertiserRows.length === 0 && (
              <Banner tone="warn" live={false}>
                There are no advertisers yet. Add the business first, then come back.{' '}
                <Button size="sm" variant="ghost" onClick={() => navigate(Routes.advertisers())}>
                  Add an advertiser
                </Button>
              </Banner>
            )}

            <div className="grid">
              <div className="col-6">
                <Field label="Advertiser">
                  {(f) => (
                    <Listbox
                      {...f}
                      value={d.advertiserId}
                      placeholder="Choose the business"
                      onChange={(v) => set('advertiserId', v)}
                      options={advertiserRows.map((a) => ({
                        value: a.id,
                        label: a.displayName,
                        hint: a.name,
                        disabled: !a.isActive,
                        disabledReason: 'Inactive',
                      }))}
                    />
                  )}
                </Field>
              </div>
              <div className="col-6">
                <Field label="Campaign name" note="For the newsroom and the advertiser’s report. Readers do not see it.">
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      maxLength={120}
                      placeholder="Dashain offer"
                      value={d.name}
                      onChange={(e) => set('name', e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="col-6">
                <Fieldset legend="Placement">
                  {(g) => (
                    <Segmented
                      {...g}
                      aria-label="Placement"
                      value={d.placement}
                      onChange={(v) => {
                        /* The image means something different in each: a poster
                           or a logo. Keeping one across a switch would put a
                           poster where a 20px logo goes. */
                        setD((prev) => ({ ...prev, placement: v, image: null }));
                      }}
                      options={[
                        { value: 'card', label: PLACEMENT_LABEL.card },
                        { value: 'inline', label: PLACEMENT_LABEL.inline },
                      ]}
                    />
                  )}
                </Fieldset>
              </div>
              <div className="col-6">
                <Fieldset legend="Readers">
                  {(g) => (
                    <Segmented
                      {...g}
                      aria-label="Language"
                      value={d.language}
                      onChange={(v) => set('language', v)}
                      options={[
                        { value: 'ne', label: 'नेपाली', lang: 'ne' },
                        { value: 'en', label: 'English', lang: 'en' },
                      ]}
                    />
                  )}
                </Fieldset>
              </div>

              <div className="col-12">
                <Fieldset
                  legend="Sections"
                  note={
                    d.categories.length === 0
                      ? 'None chosen: shown in every section.'
                      : 'Shown only in these sections, and on the Top feed where their stories appear.'
                  }
                >
                  {(g) => (
                    <ToggleGroup
                      {...g}
                      aria-label="Sections"
                      value={d.categories}
                      onChange={(v) => set('categories', v)}
                      options={categories.map((c) => ({
                        value: c.slug,
                        label: d.language === 'ne' ? c.label.ne : c.label.en,
                        lang: d.language,
                      }))}
                    />
                  )}
                </Fieldset>
              </div>

              <div className="col-6">
                <Field label="Starts">
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      type="date"
                      value={d.startsAt === '' ? '' : localDay(d.startsAt)}
                      onChange={(e) => set('startsAt', e.target.value === '' ? '' : dayStart(e.target.value))}
                    />
                  )}
                </Field>
              </div>
              <div className="col-6">
                <Field label="Ends (the last day it runs)">
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      type="date"
                      min={d.startsAt === '' ? undefined : localDay(d.startsAt)}
                      value={d.endsAt === '' ? '' : localDay(d.endsAt)}
                      onChange={(e) => set('endsAt', e.target.value === '' ? '' : dayEnd(e.target.value))}
                    />
                  )}
                </Field>
              </div>

              <div className="col-6">
                <Field
                  label="Price for the whole period (Rs)"
                  note="Enter 0 for a house ad: shown only when no paying campaign can fill the slot."
                >
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="5000"
                      value={d.priceRupees}
                      onChange={(e) => set('priceRupees', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <div className="col-6">
                <div className="sov-preview" aria-live="polite">
                  <span className="sov-preview-label">Share of voice</span>
                  {sov === null ? (
                    <span className="sov-preview-value">—</span>
                  ) : (
                    <>
                      <span className="sov-preview-value">{percent(sov.share)}</span>
                      <span className="sov-preview-note">
                        {rupees(sov.perDay)} a day,{' '}
                        {sov.alongside === 0
                          ? `with no other ${PLACEMENT_LABEL[d.placement].toLowerCase()} campaign running`
                          : `beside ${sov.alongside} other ${sov.alongside === 1 ? 'campaign' : 'campaigns'}`}{' '}
                        on{' '}
                        {new Date(sov.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        .
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="col-12">
                <Fieldset
                  legend="Status"
                  note="Live runs it between its dates. Draft and Paused keep it off the app."
                >
                  {(g) => (
                    <Segmented
                      {...g}
                      aria-label="Status"
                      value={d.status}
                      onChange={(v) => set('status', v)}
                      options={[
                        { value: 'draft', label: 'Draft' },
                        { value: 'live', label: 'Live' },
                        { value: 'paused', label: 'Paused' },
                      ]}
                    />
                  )}
                </Fieldset>
              </div>
            </div>
          </Panel>

          <Panel title={d.placement === 'card' ? 'The poster' : 'The small ad'}>
            <div className="grid">
              {d.placement === 'card' ? (
                <>
                  <div className="col-12">
                    <AdImageField
                      kind="poster"
                      image={d.image}
                      disabled={action.busy}
                      onChange={(next) => set('image', next)}
                    />
                  </div>
                  <div className="col-12">
                    <Field
                      label="One-line description"
                      note="Read aloud to readers who use a screen reader, and shown instead of the poster to anyone saving data."
                      counter={
                        <Counter state={d.headline.length > HEADLINE_MAX ? 'over' : 'ok'}>
                          {d.headline.length} / {HEADLINE_MAX}
                        </Counter>
                      }
                    >
                      {(f) => (
                        <input
                          {...f}
                          className="input"
                          lang={d.language}
                          maxLength={HEADLINE_MAX}
                          value={d.headline}
                          onChange={(e) => set('headline', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="col-6">
                    <Field label="Button (नेपाली)">
                      {(f) => (
                        <input
                          {...f}
                          className="input"
                          lang="ne"
                          maxLength={CTA_MAX}
                          value={d.ctaNe}
                          onChange={(e) => set('ctaNe', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="col-6">
                    <Field label="Button (English)">
                      {(f) => (
                        <input
                          {...f}
                          className="input"
                          lang="en"
                          maxLength={CTA_MAX}
                          value={d.ctaEn}
                          onChange={(e) => set('ctaEn', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <div className="col-12">
                    <Field
                      label="Text"
                      note="Sits beside the publisher’s name, after the word “Ad”. Keep it to the business and the offer."
                      counter={
                        <Counter state={inlineCount > INLINE_TEXT_MAX ? 'over' : 'ok'}>
                          {inlineCount} / {INLINE_TEXT_MAX}
                        </Counter>
                      }
                    >
                      {(f) => (
                        <input
                          {...f}
                          className="input"
                          lang={d.language}
                          placeholder="Hotel X · Dashain offer"
                          value={d.headline}
                          onChange={(e) => set('headline', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="col-12">
                    <AdImageField
                      kind="logo"
                      image={d.image}
                      disabled={action.busy}
                      onChange={(next) => set('image', next)}
                    />
                  </div>
                </>
              )}

              <div className="col-12">
                <Field label="Where a tap goes" note="Opens outside the app, in the phone’s browser.">
                  {(f) => (
                    <input
                      {...f}
                      className="input"
                      type="url"
                      inputMode="url"
                      value={d.landingUrl}
                      onChange={(e) => set('landingUrl', e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </div>

            <div className="actions">
              <Button
                variant="primary"
                icon="check"
                busy={action.busy}
                disabled={blocker !== null}
                onClick={() => void save()}
              >
                {isNew ? 'Create campaign' : 'Save changes'}
              </Button>
              <Button disabled={action.busy} onClick={() => navigate(Routes.ads())}>
                Cancel
              </Button>
            </div>
            {blocker !== null && <p className="field-note">{blocker}</p>}
          </Panel>

          {!isNew && campaign !== null && (
            <Panel title="What it has delivered" note={report === null ? 'Not started yet' : undefined}>
              {report === null ? (
                <p className="field-note">Figures appear here once the campaign’s first day has begun.</p>
              ) : (
                <Figures report={report} />
              )}
            </Panel>
          )}

          {!isNew && campaign !== null && <ReportLink id={campaign.id} hasLink={campaign.hasReportLink} />}
        </div>

        <aside className="col-4 sticky-aside">
          <Panel title="On the phone">
            <PhonePreview d={d} advertiser={advertiserName} />
            <p className="field-note">
              <Icon name="info" /> Always labelled as an ad, in the reader’s language.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
