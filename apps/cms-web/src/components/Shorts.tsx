import { api, type ShortItem } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { relativeTime } from '../lib/format';
import { clampPage, pageCountOf, pageSlice } from '../lib/pagination';
import { shortStatus } from '../lib/status';
import { Routes, type PerPage } from '../nav';
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

export function Shorts({ page, perPage }: { page: number; perPage: PerPage }) {
  const { data, error: loadError, loading, reload } = useResource<ShortItem[]>(
    async (signal) => (await api.shorts(signal)).items,
    'shorts',
    'Could not load the shorts.',
  );

  const action = useAsyncAction();

  const total = data?.length ?? 0;
  const pageCount = pageCountOf(total, perPage);
  const currentPage = clampPage(page, pageCount);
  const visible = data === null ? [] : pageSlice(data, currentPage, perPage);

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
                  <span className={`item-lead ${look.leadClass}`}>
                    <Icon name={look.icon} />
                  </span>

                  <span className="item-body">
                    <span className="item-title" lang={short.language}>
                      {short.title.trim() === '' ? 'Untitled short' : short.title}
                    </span>
                    <span className="item-meta">
                      {meta.map((part, index) => (
                        <span key={index}>{part}</span>
                      ))}
                    </span>
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
                    {short.status === 'published' && (
                      <Button
                        size="sm"
                        variant="danger"
                        icon="ban"
                        disabled={action.busy}
                        onClick={() => void act(() => api.retractShort(short.id), 'Withdrawn.')}
                      >
                        Withdraw
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          <Pagination
            page={currentPage}
            perPage={perPage}
            total={total}
            onPageChange={(next) => navigate(Routes.shorts({ page: next, perPage }))}
            onPerPageChange={(next) => navigate(Routes.shorts({ page: 1, perPage: next }))}
            noun="short"
          />
        </>
      )}
    </div>
  );
}
