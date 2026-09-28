import { useEffect } from 'react';
import { api, type ShortItem } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime, relativeTime } from '../lib/format';
import { mediaUrl } from '../lib/media';
import { pageCountOf } from '../lib/pagination';

import { shortStatus } from '../lib/status';
import { Routes, SHORTS_PER_PAGE } from '../nav';
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
} from '../ui';

/**
 * The shorts library.
 *
 * -- What this screen is now, and was not ------------------------------------
 *
 * It was an upload form AND the whole library on one page: a file picker, seven
 * metadata fields, and every short ever published with its publish and withdraw
 * controls, all stacked. An editor arriving to withdraw one clip had to scroll
 * past a form they were not filling in; an editor arriving to upload had the
 * entire archive underneath the field they were typing into.
 *
 * It is a list now, and uploading is its own screen at `#/shorts/new` — the
 * same split the queue already had between `#/queue` and `#/queue/new`. One
 * screen, one job.
 *
 * -- Why Withdraw is no longer on the row ------------------------------------
 *
 * It was one click, unconfirmed, with no reason asked, sitting beside the
 * pencil in a list of look-alike rows — and a withdrawal is final. It lives on
 * the edit screen now, beside Save, where it shares the reason field and asks
 * a second time. Publish stays on the row: it is the next step for a draft,
 * and it can be undone by withdrawing.
 *
 * The pencil is always the last thing on the row, so it lines up down the
 * list whatever else a row happens to carry.
 */

function ShortsSkeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading shorts">
      {[0, 1, 2, 3].map((i) => (
        <li className="item" key={i} style={{ opacity: 1 - i * 0.18 }}>
          <span className="item-lead">
            <Skeleton width={20} height={20} />
          </span>
          <span className="item-body">
            <Skeleton height={15} width={`${62 - i * 9}%`} />
            <Skeleton height={11} width={190} style={{ marginTop: 7 }} />
          </span>
          <span className="item-tail">
            <Skeleton width={72} height={24} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Data {
  items: ShortItem[];
  total: number;
}

export function Shorts({ page }: { page: number }) {
  /* Keyed by page, so moving between pages is a fresh request rather than
     the previous page shown under a new number. */
  const { data, error: loadError, loading, reload } = useResource<Data>(
    (signal) => api.shorts(page, SHORTS_PER_PAGE, signal),
    `shorts:${page}`,
    'Could not load the shorts.',
  );

  const action = useAsyncAction();

  const total = data?.total ?? 0;
  const visible = data?.items ?? [];

  /*
   * A page past the end goes to the last real one.
   *
   * Paging in the browser clamped this for free; paging on the server does
   * not. A bookmarked `?page=7` from when there were seventy shorts would
   * otherwise come back as an empty page under a pager reading "61–60 of
   * 20". Replace rather than push, so Back does not return to the dead page.
   */
  useEffect(() => {
    if (data === null) return;
    const last = pageCountOf(data.total, SHORTS_PER_PAGE);
    if (page > last) navigate(Routes.shorts({ page: last }), { replace: true });
  }, [data, page]);

  const act = async (work: () => Promise<unknown>, okMessage: string) => {
    if (await action.run(work, okMessage)) reload();
  };

  return (
    <div className="page">
      <h1 className="sr-only">Shorts</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Shorts' })} showBack={false} />
        <div className="detail-bar-actions">
          <p className="page-sub">
            {data === null ? 'Loading…' : `${total} in the library`}
          </p>
          <Button variant="primary" icon="plus" onClick={() => navigate(Routes.shortNew())}>
            New short
          </Button>
        </div>
      </div>

      {loadError !== null && (
        <>
          <Banner tone="error">{loadError}</Banner>
          <div className="actions actions-plain">
            <Button icon="refresh" onClick={reload}>
              Try again
            </Button>
          </div>
        </>
      )}

      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      {loading || data === null ? (
        loadError === null && <ShortsSkeleton />
      ) : total === 0 ? (
        <EmptyState
          icon="video"
          title="No shorts yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => navigate(Routes.shortNew())}>
              New short
            </Button>
          }
        >
          Upload a clip and it will appear here as a draft, ready to publish.
        </EmptyState>
      ) : (
        <>
          <ul className="list">
            {visible.map((short) => {
              const look = shortStatus(short.status);
              const meta = [
                short.sourceName,
                short.categorySlug,
                `${short.durationSeconds}s`,
                short.credit,
              ].filter((part) => part !== '');

              return (
                <li className="item" key={short.id}>
                  {/*
                    * The poster, not a play icon.
                    *
                    * Every row in a video library carried the same generic
                    * glyph, so the only thing distinguishing one clip from
                    * another was its title — and a clip is the one kind of
                    * content nobody remembers by title. The cover frame is
                    * already stored on the record and costs nothing to show.
                    *
                    * The status still reads as a badge on the right, so
                    * replacing the tinted lead loses no information.
                    */}
                  <img className="item-poster" src={mediaUrl(short.posterUrl)} alt="" />

                  <span className="item-body">
                    <span className="item-title" lang={short.language}>
                      {short.title.trim() === '' ? 'Untitled short' : short.title}
                    </span>
                    <span className="item-meta">
                      {meta.map((part, index) => (
                        <span key={index}>{part}</span>
                      ))}
                      {short.lastEditedAt !== null && (
                        <span
                          className="item-edited"
                          title={
                            `${dateTime(short.lastEditedAt) ?? ''}` +
                            (short.lastEditReason !== null ? ` — ${short.lastEditReason}` : '')
                          }
                        >
                          Edited {relativeTime(short.lastEditedAt)}
                        </span>
                      )}
                    </span>
                    {short.retractionReason !== null && (
                      <span className="item-meta">
                        <span>Withdrawn because: {short.retractionReason}</span>
                      </span>
                    )}
                  </span>

                  <span className="item-tail">
                    <span className="item-when">{relativeTime(short.createdAt)}</span>
                    <LangTag language={short.language} />
                    <Badge tone={look.tone} icon={look.icon}>
                      {look.label}
                    </Badge>
                    {short.status === 'draft' && (
                      <Button
                        size="sm"
                        icon="send"
                        disabled={action.busy}
                        onClick={() => void act(() => api.publishShort(short.id), 'Published.')}
                      >
                        Publish
                      </Button>
                    )}
                    <span className="row-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={short.status === 'retracted' ? 'eye' : 'pencil'}
                        aria-label={
                          short.status === 'retracted'
                            ? `View “${short.title}”`
                            : `Edit “${short.title}”`
                        }
                        title={
                          short.status === 'retracted'
                            ? 'Withdrawn — view only'
                            : short.status === 'published'
                              ? 'Edit, or withdraw, the live short'
                              : 'Edit the draft'
                        }
                        onClick={() => navigate(Routes.shortEdit(short.id))}
                      />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {/* No page-size control: see SHORTS_PER_PAGE. */}
          <Pagination
            page={page}
            perPage={SHORTS_PER_PAGE}
            total={total}
            onPageChange={(next) => navigate(Routes.shorts({ page: next }))}
            noun="short"
          />
        </>
      )}
    </div>
  );
}
