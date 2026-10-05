import {
  api,
  type InteractionOptionData,
  type InteractionResultsData,
  type InteractionRow,
  type InteractionTabName,
  type InteractionType,
} from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { countOf, dateTime } from '../lib/format';
import { mediaUrl } from '../lib/media';
import { INTERACTIONS_PER_PAGE, Routes, type InteractionTab } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  EmptyState,
  LangTag,
  Pagination,
  Skeleton,
  TabPanel,
  Tabs,
  type BadgeTone,
  type IconName,
  type TabDef,
} from '../ui';

/**
 * Interactions: star ratings and votes that readers answer in the app's feed.
 *
 * Each one is drawn here as a full-width card, laid out as a reader meets it —
 * a vote's 2×2 grid of candidates, a rating's rows of businesses — with what
 * readers have answered so far on it. The tabs are where each stands: live
 * (open, or published to open later), drafts, and closed.
 */

const PHASE_LOOK: Record<InteractionRow['phase'], { label: string; tone: BadgeTone; icon: IconName }> = {
  open: { label: 'Open', tone: 'ok', icon: 'checkCircle' },
  scheduled: { label: 'Opens later', tone: 'accent', icon: 'clock' },
  draft: { label: 'Draft', tone: 'neutral', icon: 'pencil' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'check' },
};

export const TYPE_LABEL: Record<InteractionType, string> = { vote: 'Vote', rating: 'Rating' };

/**
 * One Interaction as a full-width card: the question and its options, and —
 * when there are any — the results beside each option. Shared with the editor,
 * where it previews what is being typed.
 */
export function InteractionCard({
  type,
  language,
  title,
  options,
  results,
}: {
  type: InteractionType;
  language: 'ne' | 'en';
  title: string;
  options: ReadonlyArray<Pick<InteractionOptionData, 'name' | 'detail' | 'image'> & { id?: string }>;
  results: InteractionResultsData | null;
}) {
  const ne = language === 'ne';
  const voteOf = (i: number) =>
    results?.type === 'vote' ? (results.options[i] ?? null) : null;
  const ratingOf = (i: number) =>
    results?.type === 'rating' ? (results.options[i] ?? null) : null;

  return (
    <article className={`ix-card ix-${type}`} lang={language}>
      <p className="ix-kicker">
        <span className="ix-kicker-icon" aria-hidden="true">
          {type === 'vote' ? '✓' : '★'}
        </span>
        {type === 'vote' ? (ne ? 'मत दिनुहोस्' : 'Vote') : ne ? 'रेटिङ दिनुहोस्' : 'Rate'}
      </p>
      <h3 className="ix-title">{title.trim() || (ne ? 'प्रश्न' : 'Your question')}</h3>

      {type === 'vote' ? (
        <ul className={`ix-grid ix-grid-${Math.max(2, options.length)}`}>
          {options.map((o, i) => {
            const r = voteOf(i);
            const src = mediaUrl(o.image?.urls.md ?? o.image?.urls.sm ?? null);
            return (
              <li className="ix-tile" key={o.id ?? i}>
                <span className="ix-photo">{src !== null ? <img src={src} alt="" /> : <span>Photo</span>}</span>
                <span className="ix-name">{o.name.trim() || `${ne ? 'उम्मेदवार' : 'Candidate'} ${i + 1}`}</span>
                {o.detail && <span className="ix-detail">{o.detail}</span>}
                {r !== null ? (
                  <span className="ix-result">
                    <span className="ix-bar" aria-hidden="true">
                      <span style={{ width: `${r.percent}%` }} />
                    </span>
                    <strong>{r.percent}%</strong> <span>{countOf(r.votes, 'vote')}</span>
                  </span>
                ) : (
                  <span className="ix-button">{ne ? 'मत दिनुहोस्' : 'Vote'}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="ix-rows">
          {options.map((o, i) => {
            const r = ratingOf(i);
            const src = mediaUrl(o.image?.urls.sm ?? o.image?.urls.md ?? null);
            return (
              <li className="ix-row" key={o.id ?? i}>
                <span className="ix-thumb">{src !== null ? <img src={src} alt="" /> : null}</span>
                <span className="ix-row-text">
                  <span className="ix-name">{o.name.trim() || `${ne ? 'व्यवसाय' : 'Business'} ${i + 1}`}</span>
                  {o.detail && <span className="ix-detail">{o.detail}</span>}
                </span>
                <span className="ix-average">
                  {r !== null && r.average !== null ? (
                    <>
                      <strong>★ {r.average.toFixed(1)}</strong> <span>({countOf(r.ratings, 'rating')})</span>
                    </>
                  ) : (
                    <span className="ix-stars" aria-hidden="true">
                      ☆☆☆☆☆
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {results?.type === 'vote' && <p className="ix-total">{countOf(results.total, 'vote')} in all</p>}
    </article>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Interactions">
      {[0, 1].map((i) => (
        <div className="ix-card" key={i} style={{ opacity: 1 - i * 0.3 }}>
          <Skeleton height={14} width="20%" />
          <Skeleton height={20} width="60%" style={{ marginTop: 10 }} />
          <Skeleton height={90} style={{ marginTop: 16 }} />
        </div>
      ))}
    </div>
  );
}

interface ListData {
  items: InteractionRow[];
  total: number;
  perPage: number;
  counts: Record<InteractionTabName, number>;
}

/** "Closes 12 Oct, 6:00 PM", "Opens …", "Closed …" — the date that matters now. */
function when(row: InteractionRow): string | null {
  if (row.phase === 'scheduled') return row.opensAt === null ? null : `Opens ${dateTime(row.opensAt)}`;
  if (row.phase === 'closed') {
    const at = row.closedAt ?? row.closesAt;
    return at === null ? 'Closed' : `Closed ${dateTime(at)}`;
  }
  return row.closesAt === null ? 'No closing date' : `Closes ${dateTime(row.closesAt)}`;
}

export function Interactions({ tab, page }: { tab: InteractionTab; page: number }) {
  const list = useResource<ListData>(
    (signal) => api.interactions(tab, page, signal),
    `interactions:${tab}:${page}`,
    'Could not load the Interactions.',
  );

  const counts = list.data?.counts;
  const tabs: ReadonlyArray<TabDef<InteractionTab>> = [
    { value: 'live', label: 'Live', icon: 'checkCircle', badge: counts?.live || undefined },
    { value: 'drafts', label: 'Drafts', icon: 'pencil', badge: counts?.drafts || undefined },
    { value: 'closed', label: 'Closed', icon: 'check' },
  ];

  return (
    <div className="page">
      <h1 className="sr-only">Interactions</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Interactions' })} showBack={false} />
        <div className="detail-bar-actions">
          <Button size="sm" icon="refresh" onClick={list.reload}>
            Refresh
          </Button>
          <Button variant="primary" icon="plus" onClick={() => navigate(Routes.interactionNew())}>
            New Interaction
          </Button>
        </div>
      </div>

      <p className="field-note ads-explainer">
        Ratings and votes appear as cards in the app’s feed, after the 6th story and every 12th after
        that. Readers sign in with Google to answer, once each, and cannot change an answer.
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
        onChange={(next) => navigate(Routes.interactions({ tab: next }))}
        idBase="interactions"
        aria-label="Filter Interactions"
      />

      <TabPanel value={tab} current={tab} idBase="interactions">
        {list.loading || list.data === null ? (
          list.error === null && <ListSkeleton />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon="star"
            title={tab === 'live' ? 'Nothing is live' : tab === 'drafts' ? 'No drafts' : 'Nothing has closed yet'}
            action={
              <Button variant="primary" icon="plus" onClick={() => navigate(Routes.interactionNew())}>
                New Interaction
              </Button>
            }
          >
            A rating lets readers give businesses one to five stars. A vote lets them choose one of up to
            four candidates.
          </EmptyState>
        ) : (
          <>
            <ul className="ix-list">
              {list.data.items.map((row) => {
                const look = PHASE_LOOK[row.phase];
                const total =
                  row.results.type === 'vote'
                    ? countOf(row.results.total, 'vote')
                    : countOf(
                        row.results.options.reduce((a, o) => a + o.ratings, 0),
                        'rating',
                      );
                return (
                  <li key={row.id} className="ix-list-item">
                    <div className="ix-list-head">
                      <span className="item-meta">
                        <span>{TYPE_LABEL[row.type]}</span>
                        {row.status !== 'draft' && <span>{total}</span>}
                        {when(row) !== null && <span>{when(row)}</span>}
                        {row.categorySlug !== null && <span>{row.categorySlug}</span>}
                      </span>
                      <span className="item-tail published-tail">
                        <LangTag language={row.language} />
                        <Badge tone={look.tone} icon={look.icon}>
                          {look.label}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="pencil"
                          aria-label={`Open “${row.title}”`}
                          title={row.status === 'draft' ? 'Edit the draft' : 'See it, change its closing date, or close it'}
                          onClick={() => navigate(Routes.interaction(row.id))}
                        />
                      </span>
                    </div>
                    <InteractionCard
                      type={row.type}
                      language={row.language}
                      title={row.title}
                      options={row.options}
                      results={row.status === 'draft' ? null : row.results}
                    />
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={page}
              perPage={INTERACTIONS_PER_PAGE}
              total={list.data.total}
              onPageChange={(next) => navigate(Routes.interactions({ tab, page: next }))}
              noun="Interaction"
            />
          </>
        )}
      </TabPanel>
    </div>
  );
}
