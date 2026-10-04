import { useState } from 'react';
import { api, type LeadCounts, type NewStoryOptions, type ShortLeadRow } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { relativeTime } from '../lib/format';
import { Routes, SHORTS_PER_PAGE, type ShortsTab } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  Icon,
  LangTag,
  Listbox,
  Pagination,
  Skeleton,
} from '../ui';
import { YouTubePreview } from './YouTubePreview';

/**
 * Shorts found on licensed publishers' YouTube channels.
 *
 * Article Incoming, for video: the same row, the same Triage that opens
 * Promote and Dismiss, the same three states. An editor who knows one knows
 * the other. Triage also opens the Short itself — a clip is the one thing
 * nobody can judge from its title.
 *
 * Promoting makes a short DRAFT, which plays the Short with YouTube's player;
 * it is checked and published on the edit screen like any other short.
 */

function duration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Data {
  items: ShortLeadRow[];
  total: number;
  counts: LeadCounts;
}

export function ShortLeads({ tab, page }: { tab: Exclude<ShortsTab, 'library'>; page: number }) {
  const status = tab === 'incoming' ? 'new' : tab;
  const { data, error: loadError, loading, reload } = useResource<Data>(
    (signal) => api.shortLeads(status, page, SHORTS_PER_PAGE, signal),
    `shortLeads:${status}:${page}`,
    'Could not load the Shorts from YouTube.',
  );
  const { data: options } = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections.',
  );

  const action = useAsyncAction();
  const [openId, setOpenId] = useState<string | null>(null);
  const [categorySlug, setCategorySlug] = useState('');
  const [reason, setReason] = useState('');

  const categories = options?.categories ?? [];
  const chosenSection = categorySlug === '' ? (categories[0]?.slug ?? '') : categorySlug;

  const close = () => {
    setOpenId(null);
    setReason('');
  };

  const promote = async (lead: ShortLeadRow) => {
    if (chosenSection === '') return;
    const ok = await action.run(async () => {
      const { id } = await api.promoteShortLead(lead.id, chosenSection);
      /* Straight to the draft: checking the title and caption is the next job. */
      navigate(Routes.shortEdit(id));
    });
    if (ok) close();
  };

  const dismiss = async (lead: ShortLeadRow) => {
    if (reason.trim().length < 3) return;
    const ok = await action.run(() => api.dismissShortLead(lead.id, reason.trim()), 'Dismissed.');
    if (ok) {
      close();
      reload();
    }
  };

  if (loadError !== null && data === null) {
    return (
      <>
        <Banner tone="error">{loadError}</Banner>
        <div className="actions actions-plain">
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      </>
    );
  }

  if (loading || data === null) {
    return (
      <ul className="list" aria-busy="true" aria-label="Loading Shorts">
        {[0, 1, 2].map((i) => (
          <li className="item lead-item" key={i} style={{ opacity: 1 - i * 0.2 }}>
            <span className="lead-thumb lead-thumb-empty" />
            <span className="item-body">
              <Skeleton height={19} width={`${70 - i * 10}%`} />
              <Skeleton height={13} style={{ marginTop: 9 }} />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (data.items.length === 0) {
    return (
      <EmptyState icon={status === 'new' ? 'video' : 'search'} title={status === 'new' ? 'Nothing waiting' : 'Nothing here'}>
        {status === 'new' ? (
          <>
            Shorts arrive here from publishers whose method is <strong>YouTube channel</strong>, read
            every poll interval. Only videos of 90 seconds or less, taller than wide, that their owner
            allows to be embedded are offered.
            <br />
            <br />
            Reading channels needs <strong>YOUTUBE_API_KEY</strong> in the server&rsquo;s .env — free
            from Google Cloud, with the YouTube Data API v3 enabled.
          </>
        ) : (
          'No Short has reached this state yet.'
        )}
      </EmptyState>
    );
  }

  return (
    <>
      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      <ul className="list">
        {data.items.map((lead) => {
          const isOpen = openId === lead.id;
          return (
            <li className="item lead-item" key={lead.id}>
              <img className="lead-thumb" src={lead.thumbnailUrl} alt="" loading="lazy" />

              <span className="item-body">
                <span className="lead-title" lang={lead.language}>
                  {lead.title}
                </span>
                {lead.description.trim() !== '' && (
                  <span className="lead-extract" lang={lead.language}>
                    {lead.description}
                  </span>
                )}
                <span className="item-meta">
                  <span>{lead.sourceName}</span>
                  <span>{duration(lead.durationSeconds)}</span>
                  <span>{relativeTime(lead.publishedAt ?? lead.fetchedAt)}</span>
                  {lead.dismissedReason !== null && <span>{lead.dismissedReason}</span>}
                </span>

                {isOpen && (
                  <span className="lead-actions short-lead-actions">
                    <YouTubePreview videoId={lead.videoId} title={lead.title} />
                    <span className="short-lead-form">
                      <Field label="Section">
                        {(f) => (
                          <Listbox
                            {...f}
                            value={chosenSection}
                            onChange={(v) => setCategorySlug(v)}
                            options={categories.map((c) => ({
                              value: c.slug,
                              label: lead.language === 'ne' ? c.label.ne : c.label.en,
                              lang: lead.language,
                            }))}
                          />
                        )}
                      </Field>
                      <Field label="Or dismiss, because" note="Kept, so the same Short is not offered again.">
                        {(f) => (
                          <input
                            {...f}
                            className="input"
                            placeholder="Not news"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        )}
                      </Field>
                      <span className="actions actions-plain">
                        <Button
                          variant="primary"
                          size="sm"
                          icon="plus"
                          busy={action.busy}
                          disabled={chosenSection === ''}
                          onClick={() => void promote(lead)}
                        >
                          Promote to a draft
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon="ban"
                          disabled={action.busy || reason.trim().length < 3}
                          onClick={() => void dismiss(lead)}
                        >
                          Dismiss
                        </Button>
                        <Button size="sm" disabled={action.busy} onClick={close}>
                          Cancel
                        </Button>
                      </span>
                    </span>
                  </span>
                )}
              </span>

              <span className="item-tail">
                <LangTag language={lead.language} />
                <a
                  className="btn btn-sm"
                  href={`https://www.youtube.com/shorts/${lead.videoId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  YouTube <Icon name="externalLink" className="btn-icon-glyph" />
                </a>
                {lead.status === 'new' ? (
                  !isOpen && (
                    <Button
                      size="sm"
                      icon="check"
                      onClick={() => {
                        setOpenId(lead.id);
                        setReason('');
                      }}
                    >
                      Triage
                    </Button>
                  )
                ) : lead.status === 'promoted' ? (
                  lead.promotedVideoId !== null ? (
                    <Button
                      size="sm"
                      icon="video"
                      onClick={() => navigate(Routes.shortEdit(lead.promotedVideoId!))}
                    >
                      Open the draft
                    </Button>
                  ) : (
                    <Badge tone="ok" icon="checkCircle">
                      Promoted
                    </Badge>
                  )
                ) : (
                  <Badge tone="neutral" icon="ban">
                    Dismissed
                  </Badge>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Pagination
        page={page}
        perPage={SHORTS_PER_PAGE}
        total={data.total}
        onPageChange={(next) => navigate(Routes.shorts({ tab, page: next }))}
        noun="Short"
      />
    </>
  );
}
