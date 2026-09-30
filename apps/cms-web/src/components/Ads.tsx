import {
  api,
  type AdCampaignRow,
  type AdOverviewPlacement,
  type AdTabName,
} from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { countOf, percent, rupees } from '../lib/format';
import { ADS_PER_PAGE, Routes, type AdTab } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  EmptyState,
  LangTag,
  Pagination,
  Panel,
  Skeleton,
  TabPanel,
  Tabs,
  type BadgeTone,
  type IconName,
  type TabDef,
} from '../ui';

/**
 * Advertising.
 *
 * -- What the top of the screen answers --------------------------------------
 *
 * "Who is paying for what share of each placement, right now?" Advertising is
 * sold by time, and a campaign's share of the slots is its price per day over
 * everyone else's, so the answer changes whenever a campaign starts or ends.
 * The bars are that share — the same number serving draws with, from the same
 * function — and the money beside them is why each bar is the length it is.
 *
 * The two placements are shown apart because they are different products at
 * different prices. A full-card buyer and a small-ad buyer never compete for
 * the same slot.
 *
 * -- Why the list is by status and not by advertiser -------------------------
 *
 * The questions asked of it are "what is running", "what starts next week" and
 * "what did we forget to switch on" — the tabs. Everything for one advertiser
 * is one click away on the advertisers screen.
 */

export const PLACEMENT_LABEL: Record<'card' | 'inline', string> = {
  card: 'Full card',
  inline: 'Small ad',
};

const STATE_LOOK: Record<AdTabName, { label: string; tone: BadgeTone; icon: IconName }> = {
  running: { label: 'Running', tone: 'ok', icon: 'checkCircle' },
  scheduled: { label: 'Scheduled', tone: 'accent', icon: 'clock' },
  paused: { label: 'Paused', tone: 'warn', icon: 'ban' },
  finished: { label: 'Finished', tone: 'neutral', icon: 'check' },
  draft: { label: 'Draft', tone: 'neutral', icon: 'pencil' },
};

/** "1 Oct – 7 Oct", the flight at a glance. */
function flight(startsAt: string, endsAt: string): string {
  const f = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${f(startsAt)} – ${f(endsAt)}`;
}

function PlacementCard({ p }: { p: AdOverviewPlacement }) {
  return (
    <Panel
      title={PLACEMENT_LABEL[p.placement]}
      note={
        p.running.length === 0
          ? 'Nothing running'
          : `${p.running.length} running · ${rupees(p.totalPerDayPaisa)} a day`
      }
    >
      <p className="meta-line">
        <span>{countOf(p.today.views, 'view')} today</span>
        <span>{countOf(p.today.clicks, 'click')}</span>
      </p>

      {p.running.length === 0 ? (
        <p className="field-note">
          {p.placement === 'card'
            ? 'No full-card campaign is running, so no full-card ads are being served.'
            : 'No small-ad campaign is running, so stories carry no small ad.'}
        </p>
      ) : (
        <ul className="sov-list" aria-label={`Share of ${PLACEMENT_LABEL[p.placement]} slots`}>
          {p.running.map((r) => (
            <li key={r.id} className="sov-row">
              <button
                type="button"
                className="sov-name"
                onClick={() => navigate(Routes.ad(r.id))}
                title="Open the campaign"
              >
                <span className="sov-advertiser">{r.advertiser}</span>
                <span className="sov-campaign">{r.name}</span>
              </button>
              <span className="sov-track" aria-hidden="true">
                <span className="sov-fill" style={{ width: `${Math.max(1, r.shareOfVoice * 100)}%` }} />
              </span>
              <span className="sov-figures">
                <strong>{percent(r.shareOfVoice)}</strong>
                <span>{rupees(r.pricePerDayPaisa)}/day</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ListSkeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading campaigns">
      {[0, 1, 2].map((i) => (
        <li className="item published-item" key={i} style={{ opacity: 1 - i * 0.2 }}>
          <span className="item-body">
            <Skeleton height={17} width={`${60 - i * 8}%`} />
            <Skeleton height={12} width="40%" style={{ marginTop: 8 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface ListData {
  items: AdCampaignRow[];
  total: number;
  counts: Record<AdTabName, number>;
}

export function Ads({ tab, page }: { tab: AdTab; page: number }) {
  const overview = useResource<{ placements: AdOverviewPlacement[] }>(
    (signal) => api.adsOverview(signal),
    'ads:overview',
    'Could not load the advertising overview.',
  );
  const list = useResource<ListData>(
    (signal) => api.adCampaigns(tab, page, ADS_PER_PAGE, signal),
    `ads:${tab}:${page}`,
    'Could not load the campaigns.',
  );

  const counts = list.data?.counts;
  const tabs: ReadonlyArray<TabDef<AdTab>> = [
    { value: 'running', label: 'Running', icon: 'checkCircle', badge: counts?.running || undefined },
    { value: 'scheduled', label: 'Scheduled', icon: 'clock', badge: counts?.scheduled || undefined },
    { value: 'paused', label: 'Paused', icon: 'ban', badge: counts?.paused || undefined },
    { value: 'finished', label: 'Finished', icon: 'check' },
    { value: 'draft', label: 'Drafts', icon: 'pencil', badge: counts?.draft || undefined },
  ];

  const reload = () => {
    overview.reload();
    list.reload();
  };

  return (
    <div className="page">
      <h1 className="sr-only">Advertising</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Advertising' })} showBack={false} />
        <div className="detail-bar-actions">
          <Button size="sm" icon="refresh" onClick={reload}>
            Refresh
          </Button>
          <Button size="sm" icon="layers" onClick={() => navigate(Routes.advertisers())}>
            Advertisers
          </Button>
          <Button variant="primary" icon="plus" onClick={() => navigate(Routes.adNew())}>
            New campaign
          </Button>
        </div>
      </div>

      {overview.error !== null && <Banner tone="error">{overview.error}</Banner>}
      <div className="grid">
        {overview.data === null
          ? [0, 1].map((i) => (
              <div className="col-6" key={i}>
                <div className="panel">
                  <div className="panel-body">
                    <Skeleton height={16} width="40%" />
                    <Skeleton height={12} style={{ marginTop: 14 }} />
                    <Skeleton height={12} width="80%" style={{ marginTop: 8 }} />
                  </div>
                </div>
              </div>
            ))
          : overview.data.placements.map((p) => (
              <div className="col-6" key={p.placement}>
                <PlacementCard p={p} />
              </div>
            ))}
      </div>

      <p className="field-note ads-explainer">
        Each campaign’s share of a placement is its price per day, divided by the total per day
        of every campaign running in that placement. Paying twice as much per day means being
        shown twice as often; a new campaign starting takes a little from everyone else.
      </p>

      {list.error !== null && (
        <>
          <Banner tone="error">{list.error}</Banner>
          <div className="actions actions-plain">
            <Button icon="refresh" onClick={list.reload}>
              Try again
            </Button>
          </div>
        </>
      )}

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(next) => navigate(Routes.ads({ tab: next }))}
        idBase="ads"
        aria-label="Filter campaigns"
      />

      <TabPanel value={tab} current={tab} idBase="ads">
        {list.loading || list.data === null ? (
          list.error === null && <ListSkeleton />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon="megaphone"
            title={
              tab === 'running'
                ? 'Nothing is running'
                : tab === 'draft'
                  ? 'No drafts'
                  : `No ${tab} campaigns`
            }
            action={
              <Button variant="primary" icon="plus" onClick={() => navigate(Routes.adNew())}>
                New campaign
              </Button>
            }
          >
            {tab === 'running'
              ? 'A campaign runs when it is set to Live and today is within its dates.'
              : 'Campaigns move between these tabs by their status and their dates.'}
          </EmptyState>
        ) : (
          <>
            <ul className="list">
              {list.data.items.map((c) => {
                const look = STATE_LOOK[c.state];
                const ctr = c.impressions === 0 ? null : c.clicks / c.impressions;
                return (
                  <li className="item published-item" key={c.id}>
                    <span className="item-body">
                      <span className="lead-title">{c.name}</span>
                      <span className="item-meta">
                        <span>{c.advertiser}</span>
                        <span>{PLACEMENT_LABEL[c.placement]}</span>
                        <span>{flight(c.startsAt, c.endsAt)}</span>
                        <span>
                          {rupees(c.pricePaisa)} · {rupees(c.pricePerDayPaisa)}/day
                        </span>
                        {c.shareOfVoice !== null && <span>{percent(c.shareOfVoice)} share</span>}
                        <span>
                          {countOf(c.impressions, 'view')} · {countOf(c.clicks, 'click')}
                          {ctr !== null && ` · ${percent(ctr)}`}
                        </span>
                      </span>
                    </span>

                    <span className="item-tail published-tail">
                      <LangTag language={c.language} />
                      <Badge tone={look.tone} icon={look.icon}>
                        {look.label}
                      </Badge>
                      <span className="row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="pencil"
                          aria-label={`Edit “${c.name}”`}
                          title="Edit the campaign and see its figures"
                          onClick={() => navigate(Routes.ad(c.id))}
                        />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={page}
              perPage={ADS_PER_PAGE}
              total={list.data.total}
              onPageChange={(next) => navigate(Routes.ads({ tab, page: next }))}
              noun="campaign"
            />
          </>
        )}
      </TabPanel>
    </div>
  );
}
