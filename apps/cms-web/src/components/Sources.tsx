import { useCallback, useMemo } from 'react';
import { api, type SourceRow } from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { relativeTime } from '../lib/format';
import { clampPage, pageCountOf, pageSlice } from '../lib/pagination';
import { ingestHealth, ingestSummary, licenceLook, sourceHaystack } from '../lib/sources';
import { Routes, type LicenceTab, type PerPage, type Role } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  EmptyState,
  Flag,
  Icon,
  LangTag,
  Pagination,
  SearchInput,
  Skeleton,
  TabPanel,
  Tabs,
  type TabDef,
} from '../ui';

/**
 * The publishers.
 *
 * -- Why licence status is the axis and not a chip ---------------------------
 *
 * While Gate 1 is open the daily question is "where have we got to with the
 * five?"; afterwards it is "may we use this one?". Both are questions about
 * licence status, and an alphabetical list with a small status chip on each row
 * answers neither without reading every row. So status is the tab strip, and
 * the counts on those tabs are the Gate 1 dashboard — which is why there is no
 * separate widget for it.
 *
 * -- Why every role can see this ---------------------------------------------
 *
 * `source.read` is granted to author, reviewer and admin. `GET /cms/options`
 * already returns unlicensed publishers marked rather than hidden, for the
 * reason its own comment gives: "An editor who cannot find a publisher they
 * expect needs to know it is a licensing question, not a bug." Until now there
 * was nowhere for them to go and find that out. This is that place.
 */

const ID_BASE = 'publishers';

function SourcesSkeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading publishers">
      {[0, 1, 2, 3].map((i) => (
        <li className="item" key={i} style={{ opacity: 1 - i * 0.18 }}>
          <span className="item-lead">
            <Skeleton width={20} height={20} />
          </span>
          <span className="item-body">
            <Skeleton height={15} width={`${58 - i * 8}%`} />
            <Skeleton height={11} width={220} style={{ marginTop: 7 }} />
          </span>
          <span className="item-tail">
            <Skeleton width={76} height={24} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface SourcesProps {
  tab: LicenceTab;
  page: number;
  perPage: PerPage;
  search: string;
  role: Role;
}

export function Sources({ tab, page, perPage, search, role }: SourcesProps) {
  const { data, error, loading, reload } = useResource<SourceRow[]>(
    async (signal) => (await api.sources(signal)).items,
    'sources',
    'Could not load the publishers.',
  );

  const all = data ?? null;

  /* Counted over everything, not over the current tab — a tab showing its own
     count would always read the same as its contents and say nothing. */
  const counts = useMemo(() => {
    const seed = { all: 0, agreed: 0, pending: 0, refused: 0, unknown: 0 };
    if (all === null) return seed;
    return all.reduce((acc, s) => {
      acc.all += 1;
      const key = s.licence.status;
      if (key in acc) acc[key as keyof typeof acc] += 1;
      return acc;
    }, seed);
  }, [all]);

  const matched = useMemo(() => {
    if (all === null) return null;
    const byTab = tab === 'all' ? all : all.filter((s) => s.licence.status === tab);
    const needle = search.trim().toLowerCase();
    if (needle === '') return byTab;
    return byTab.filter((s) => sourceHaystack(s).includes(needle));
  }, [all, tab, search]);

  const total = matched?.length ?? 0;
  const pageCount = pageCountOf(total, perPage);
  const current = clampPage(page, pageCount);
  const visible = useMemo(
    () => (matched === null ? [] : pageSlice(matched, current, perPage)),
    [matched, current, perPage],
  );

  const goToTab = useCallback(
    (next: LicenceTab) => navigate(Routes.sources({ tab: next, perPage, q: search })),
    [perPage, search],
  );

  const setSearch = useCallback(
    (next: string) =>
      /* Replaced, not pushed — typing "khabar" would otherwise leave six
         history entries and Back would delete it one letter at a time. */
      navigate(Routes.sources({ tab, perPage, q: next }), { replace: true }),
    [tab, perPage],
  );

  const tabs: ReadonlyArray<TabDef<LicenceTab>> = [
    { value: 'all', label: 'All', badge: counts.all },
    { value: 'agreed', label: 'Agreed', icon: 'checkCircle', badge: counts.agreed },
    { value: 'pending', label: 'Pending', icon: 'clock', badge: counts.pending },
    { value: 'refused', label: 'Refused', icon: 'ban', badge: counts.refused },
    { value: 'unknown', label: 'Not asked', icon: 'info', badge: counts.unknown },
  ];

  const searching = search.trim() !== '';

  return (
    <div className="page">
      <h1 className="sr-only">Publishers</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Publishers' })} showBack={false} />
        <div className="detail-bar-actions">
          <p className="page-sub">
            {all === null ? 'Loading…' : `${counts.all} recorded · ${counts.agreed} licensed`}
          </p>
          {role === 'admin' && (
            <Button variant="primary" icon="plus" onClick={() => navigate(Routes.sourceNew())}>
              New publisher
            </Button>
          )}
        </div>
      </div>

      {error !== null && (
        <>
          <Banner tone="error">{error}</Banner>
          <div className="actions actions-plain">
            <Button icon="refresh" onClick={reload}>
              Try again
            </Button>
          </div>
        </>
      )}

      {/*
        * Said once, at the top, because otherwise every row reads "never
        * polled" and an editor files it as a fault. Nothing polls these feeds:
        * recording one is preparation, not activity.
        */}
      {all !== null && all.length > 0 && (
        <Banner tone="info" live={false}>
          <strong>Nothing polls these feeds yet.</strong> Automated ingestion is not built and
          is blocked on publisher licensing. A feed URL recorded here is preparation for it.
        </Banner>
      )}

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={goToTab}
        idBase={ID_BASE}
        aria-label="Filter publishers by licence"
      />

      <TabPanel value={tab} current={tab} idBase={ID_BASE}>
        <div className="toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Filter by name, slug or method"
            aria-label="Filter publishers"
          />
        </div>

        {loading || matched === null ? (
          error === null && <SourcesSkeleton />
        ) : total === 0 ? (
          searching || tab !== 'all' ? (
            <EmptyState
              icon="search"
              title="Nothing here"
              action={
                <Button
                  icon="x"
                  onClick={() => navigate(Routes.sources())}
                >
                  Clear the filter
                </Button>
              }
            >
              {tab === 'all'
                ? `No publisher matches “${search.trim()}”.`
                : `No publisher is ${licenceLook(tab).label.toLowerCase()}${
                    searching ? ` and matches “${search.trim()}”` : ''
                  }.`}
            </EmptyState>
          ) : (
            <EmptyState
              icon="newspaper"
              title="No publishers yet"
              action={
                role === 'admin' ? (
                  <Button variant="primary" icon="plus" onClick={() => navigate(Routes.sourceNew())}>
                    Add the first publisher
                  </Button>
                ) : undefined
              }
            >
              A publisher must be recorded here before a story can be filed against them, and
              licensed before one can be published.
            </EmptyState>
          )
        ) : (
          <>
            <ul className="list">
              {visible.map((source) => {
                const look = licenceLook(source.licence.status);
                const health = ingestHealth(source.ingest);

                return (
                  <li
                    className="item item-selectable"
                    key={source.slug}
                    onClick={() => navigate(Routes.source(source.slug))}
                  >
                    <span className={`item-lead ${look.leadClass}`}>
                      <Icon name={look.icon} />
                    </span>

                    <span className="item-body">
                      <span className="item-title" lang={source.language}>
                        {source.displayName}
                      </span>
                      <span className="item-meta">
                        <span>{source.slug}</span>
                        <span>{ingestSummary(source.ingest)}</span>
                        {!source.isActive && <span>Inactive</span>}
                      </span>
                    </span>

                    <span className="item-tail">
                      <span className="item-when">
                        {source.ingest.lastSuccessAt === null
                          ? '—'
                          : relativeTime(source.ingest.lastSuccessAt)}
                      </span>
                      {source.ingest.consecutiveFailures > 0 && (
                        <Flag icon="alertTriangle" tone="bad" label={health.label} />
                      )}
                      <LangTag language={source.language} />
                      <Badge tone={look.tone} icon={look.icon}>
                        {look.label}
                      </Badge>
                    </span>
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={current}
              perPage={perPage}
              total={total}
              onPageChange={(next) => navigate(Routes.sources({ tab, page: next, perPage, q: search }))}
              onPerPageChange={(next) =>
                navigate(Routes.sources({ tab, page: 1, perPage: next, q: search }))
              }
              noun="publisher"
            />
          </>
        )}
      </TabPanel>
    </div>
  );
}
