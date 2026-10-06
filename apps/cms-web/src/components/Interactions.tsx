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
  Icon,
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
 * ── The list is results first ───────────────────────────────────────────────
 *
 * What an editor opens this screen to learn is "how is it going": so each row
 * is the question, where it stands, and then the answers — a vote's candidates
 * as bars, leader first, with percent and count (as X shows a poll's results);
 * a rating's businesses with their average in a coloured pill and in stars,
 * and how many rated (as Google Play and food apps show a rating). A draft,
 * which has no answers yet, shows its candidates' photos instead.
 *
 * How the card looks to a reader is the editor's business while making it, so
 * the phone preview (PhonePreview) lives in the editor, beside the form.
 */

const PHASE_LOOK: Record<InteractionRow['phase'], { label: string; tone: BadgeTone; icon: IconName }> = {
  open: { label: 'Open', tone: 'ok', icon: 'checkCircle' },
  scheduled: { label: 'Opens later', tone: 'accent', icon: 'clock' },
  draft: { label: 'Draft', tone: 'neutral', icon: 'pencil' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'check' },
};

export const TYPE_LABEL: Record<InteractionType, string> = { vote: 'Vote', rating: 'Rating' };
export const TYPE_ICON: Record<InteractionType, IconName> = { vote: 'layers', rating: 'star' };

type Option = Pick<InteractionOptionData, 'name' | 'detail' | 'image'> & { id?: string };

/** "3 days left", "5 hours left", from now to a date — or null when past. */
export function timeLeft(iso: string | null, now = Date.now()): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours} hour${hours === 1 ? '' : 's'} left` : 'Closing soon';
}

/** The colour of an average, as the app shows it. */
export function toneOf(average: number | null): 'good' | 'fair' | 'poor' | 'new' {
  if (average === null) return 'new';
  if (average >= 4) return 'good';
  if (average >= 3) return 'fair';
  return 'poor';
}

/** A steady colour for an option without a photo, from its name. */
function initialColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${h}, 42%, 42%)`;
}

export function OptionThumb({ option, size = 36 }: { option: Option; size?: number }) {
  const src = mediaUrl(option.image?.urls.sm ?? option.image?.urls.md ?? null);
  return (
    <span
      className="ix-thumb"
      style={{ width: size, height: size, background: src === null ? initialColour(option.name || '?') : undefined }}
      aria-hidden="true"
    >
      {src !== null ? <img src={src} alt="" /> : <span>{[...(option.name.trim() || '?')][0]}</span>}
    </span>
  );
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <span className="ix-stars" style={{ fontSize: size }} aria-label={`${value.toFixed(1)} out of 5`}>
      {'★'.repeat(full)}
      <span className="ix-stars-empty">{'★'.repeat(5 - full)}</span>
    </span>
  );
}

/* ── results ──────────────────────────────────────────────────────────────── */

export function VoteResults({ options, results }: { options: readonly Option[]; results: InteractionResultsData }) {
  if (results.type !== 'vote') return null;
  const rows = options
    .map((o, i) => ({ o, r: results.options[i] ?? { votes: 0, percent: 0 } }))
    .sort((a, b) => b.r.votes - a.r.votes);
  const top = rows[0]?.r.votes ?? 0;
  const tied = rows.filter((x) => x.r.votes === top).length > 1;
  return (
    <ul className="ix-bars">
      {rows.map(({ o, r }, k) => {
        const lead = k === 0 && top > 0 && !tied;
        return (
          <li key={o.id ?? o.name} className={lead ? 'ix-bar ix-bar-lead' : 'ix-bar'}>
            <OptionThumb option={o} size={28} />
            <span className="ix-bar-name">{o.name}</span>
            <span className="ix-bar-track" aria-hidden="true">
              <span style={{ width: `${Math.max(r.percent, r.votes > 0 ? 2 : 0)}%` }} />
            </span>
            <span className="ix-bar-figure">
              <strong>{r.percent}%</strong> · {r.votes.toLocaleString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RatingResults({ options, results }: { options: readonly Option[]; results: InteractionResultsData }) {
  if (results.type !== 'rating') return null;
  return (
    <ul className="ix-rates">
      {options.map((o, i) => {
        const r = results.options[i] ?? { ratings: 0, average: null };
        const tone = toneOf(r.average);
        return (
          <li key={o.id ?? o.name} className="ix-rate">
            <OptionThumb option={o} size={32} />
            <span className="ix-rate-text">
              <span className="ix-rate-name">{o.name}</span>
              {o.detail && <span className="ix-rate-detail">{o.detail}</span>}
            </span>
            {r.average !== null && <Stars value={r.average} />}
            <span className="ix-rate-count">{countOf(r.ratings, 'rating')}</span>
            <span className={`ix-avg ix-avg-${tone}`}>{r.average !== null ? `${r.average.toFixed(1)} ★` : 'New'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ── the phone preview, as the app draws it ─────────────────────────────────── */

/**
 * The card as a reader meets it in the app — the redesign of 6 Oct 2026: a
 * vote's photo tiles with their names, the confirm bar, the results washed over
 * the photos; a rating's rows with the average pill and stars. Drawn from the
 * same fields the app receives, so what the editor sees is what readers get.
 */
export function PhonePreview({
  type,
  language,
  title,
  options,
  results,
}: {
  type: InteractionType;
  language: 'ne' | 'en';
  title: string;
  options: readonly Option[];
  results: InteractionResultsData | null;
}) {
  const ne = language === 'ne';
  const voteShown = type === 'vote' && results?.type === 'vote';
  return (
    <div className="ix-phone" lang={language}>
      <div className="ix-phone-head">
        <span className="ix-phone-pill">
          <Icon name={TYPE_ICON[type]} />
          {type === 'vote' ? (ne ? 'मतदान' : 'Vote') : ne ? 'रेटिङ' : 'Rate'}
        </span>
      </div>
      <p className="ix-phone-title">{title.trim() || (ne ? 'प्रश्न' : 'Your question')}</p>

      {type === 'vote' ? (
        <>
          <div className={`ix-phone-grid ix-phone-grid-${Math.min(4, Math.max(2, options.length))}`}>
            {options.map((o, i) => {
              const src = mediaUrl(o.image?.urls.md ?? o.image?.urls.sm ?? null);
              const r = voteShown ? (results.options[i] ?? null) : null;
              return (
                <div key={o.id ?? i} className="ix-phone-tile" style={{ background: src === null ? 'var(--surface-sunk)' : undefined }}>
                  {src !== null ? <img src={src} alt="" /> : <span className="ix-phone-empty">Photo</span>}
                  {r !== null && <span className="ix-phone-wash">{r.percent}%</span>}
                  <span className="ix-phone-caption">{o.name.trim() || `${ne ? 'उम्मेदवार' : 'Candidate'} ${i + 1}`}</span>
                </div>
              );
            })}
          </div>
          <div className="ix-phone-confirm">{ne ? 'मत दिनुहोस्' : 'Vote'}</div>
        </>
      ) : (
        <div className="ix-phone-rows">
          {options.map((o, i) => {
            const r = results?.type === 'rating' ? (results.options[i] ?? null) : null;
            const tone = toneOf(r?.average ?? null);
            return (
              <div key={o.id ?? i} className="ix-phone-row">
                <OptionThumb option={o} size={30} />
                <span className="ix-phone-row-text">
                  <span className="ix-phone-row-name">{o.name.trim() || `${ne ? 'व्यवसाय' : 'Business'} ${i + 1}`}</span>
                  <span className="ix-phone-row-stars">☆☆☆☆☆</span>
                </span>
                <span className={`ix-avg ix-avg-${tone}`}>
                  {r?.average != null ? `${r.average.toFixed(1)} ★` : ne ? 'नयाँ' : 'New'}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="ix-phone-foot">
        {type === 'vote'
          ? ne
            ? 'एउटा Google खाता, एउटा मत · फेर्न मिल्दैन'
            : 'One vote per Google account · final'
          : ne
            ? 'ताराहरू छुनुहोस्, अनि पठाउनुहोस्'
            : 'Pick stars, then send'}
      </p>
    </div>
  );
}

/* ── the list ──────────────────────────────────────────────────────────────── */

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Interactions" className="ix-list">
      {[0, 1].map((i) => (
        <div className="ix-row" key={i} style={{ opacity: 1 - i * 0.3 }}>
          <Skeleton height={16} width="45%" />
          <Skeleton height={10} width="90%" style={{ marginTop: 14 }} />
          <Skeleton height={10} width="70%" style={{ marginTop: 10 }} />
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

function statusOf(row: InteractionRow): string {
  if (row.phase === 'draft') return 'Draft';
  if (row.phase === 'scheduled') return row.opensAt === null ? 'Opens later' : `Opens ${dateTime(row.opensAt)}`;
  if (row.phase === 'closed') return 'Closed';
  return timeLeft(row.closesAt) ?? 'Open';
}

function footOf(row: InteractionRow): string {
  const noun = row.type === 'vote' ? 'vote' : 'rating';
  const parts = [countOf(row.results.total, noun)];
  if (row.phase === 'open' && row.results.today > 0) parts.push(`${row.results.today.toLocaleString()} today`);
  if (row.phase === 'closed') {
    const at = row.closedAt ?? row.closesAt;
    if (at !== null) parts.push(`closed ${dateTime(at)}`);
  } else if (row.closesAt !== null) {
    parts.push(`closes ${dateTime(row.closesAt)}`);
  } else {
    parts.push('no closing date');
  }
  return parts.join(' · ');
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
            A vote asks readers to pick one of up to four photos. A rating lets them give each of up to six
            places one to five stars. Both appear as cards in the app’s feed.
          </EmptyState>
        ) : (
          <>
            <ul className="ix-list">
              {list.data.items.map((row) => {
                const look = PHASE_LOOK[row.phase];
                return (
                  <li key={row.id} className="ix-row">
                    <div className="ix-row-head">
                      <span className={`ix-kind ix-kind-${row.type}`}>
                        <Icon name={TYPE_ICON[row.type]} />
                        {TYPE_LABEL[row.type]}
                      </span>
                      <button
                        type="button"
                        className="ix-row-title"
                        onClick={() => navigate(Routes.interaction(row.id))}
                        lang={row.language}
                      >
                        {row.title}
                      </button>
                      <span className="ix-row-tail">
                        <LangTag language={row.language} />
                        <Badge tone={look.tone} icon={look.icon}>
                          {statusOf(row)}
                        </Badge>
                        <Button
                          size="sm"
                          icon="pencil"
                          aria-label={`Open “${row.title}”`}
                          onClick={() => navigate(Routes.interaction(row.id))}
                        >
                          Open
                        </Button>
                      </span>
                    </div>

                    {row.status === 'draft' ? (
                      <div className="ix-draft-thumbs">
                        {row.options.map((o) => (
                          <span key={o.id} className="ix-draft-thumb">
                            <OptionThumb option={o} size={44} />
                            <span>{o.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : row.type === 'vote' ? (
                      <VoteResults options={row.options} results={row.results} />
                    ) : (
                      <RatingResults options={row.options} results={row.results} />
                    )}

                    <p className="ix-row-foot">
                      {row.status === 'draft' ? `${row.options.length} ${row.type === 'vote' ? 'candidates' : 'businesses'} · not published` : footOf(row)}
                      {row.categorySlug !== null && ` · ${row.categorySlug}`}
                    </p>
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
