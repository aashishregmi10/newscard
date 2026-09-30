import { api, type PublishedRow } from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime, relativeTime } from '../lib/format';
import { PUBLISHED_PER_PAGE, Routes, type PublishedTab } from '../nav';
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
  type TabDef,
} from '../ui';

/**
 * What a reader can actually see.
 *
 * -- Why this screen exists ---------------------------------------------------
 *
 * The queue lists draft, in_review and approved — work outstanding. A published
 * story left it and appeared nowhere else, so the only way to answer "is that
 * one still live" was to open the reader app and scroll for it.
 *
 * -- The three actions, and why they are a column ----------------------------
 *
 * Edit, view, and the publisher's own article — the same three on every row,
 * in the same order, pinned to the right edge. The eye goes to the same place
 * on each row to find them, so they must not trail the headline at whatever x
 * it happened to end on. A withdrawn story keeps a disabled edit rather than
 * losing the button, so the column does not shift on the rows that have one.
 *
 * Editing opens its own screen rather than expanding the row. A correction to a
 * live story is a headline, a summary, a picture and a required reason, and it
 * is made against the text readers can currently see — that is a page of work,
 * not a row of it. Withdrawal lives there too, beside the same reason field.
 *
 * -- Why a withdrawn story is a tab and not a filter -------------------------
 *
 * It answers a different question. Nobody scanning what is live wants withdrawn
 * stories mixed in, and somebody asking what was pulled and why wants nothing
 * else on the screen.
 */

function PublishedSkeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading published stories">
      {[0, 1, 2].map((i) => (
        <li className="item published-item" key={i} style={{ opacity: 1 - i * 0.2 }}>
          <span className="item-body">
            <Skeleton height={19} width={`${72 - i * 9}%`} />
            <Skeleton height={13} width="42%" style={{ marginTop: 9 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Data {
  items: PublishedRow[];
  total: number;
  counts: { published: number; retracted: number };
}

export function Published({ tab, page }: { tab: PublishedTab; page: number }) {
  const { data, error: loadError, loading, reload } = useResource<Data>(
    (signal) => api.published(tab, page, PUBLISHED_PER_PAGE, signal),
    `published:${tab}:${page}`,
    'Could not load the published stories.',
  );

  const counts = data?.counts ?? { published: 0, retracted: 0 };
  const total = data?.total ?? 0;

  const tabs: ReadonlyArray<TabDef<PublishedTab>> = [
    {
      value: 'published',
      label: 'Live',
      icon: 'checkCircle',
      badge: counts.published || undefined,
    },
    {
      value: 'retracted',
      label: 'Withdrawn',
      icon: 'ban',
      badge: counts.retracted || undefined,
    },
  ];

  return (
    <div className="page">
      <h1 className="sr-only">Published</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Published' })} showBack={false} />
        <div className="detail-bar-actions">
          <p className="page-sub">{data === null ? 'Loading…' : `${counts.published} live`}</p>
          <Button size="sm" icon="refresh" onClick={reload}>
            Refresh
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

      <Tabs
        tabs={tabs}
        value={tab}
        /* Back to page one — page four of a tab you have not looked at is the
           same broken-link feeling the rail avoids. */
        onChange={(next) => navigate(Routes.published({ tab: next }))}
        idBase="published"
        aria-label="Filter published stories"
      />

      <TabPanel value={tab} current={tab} idBase="published">
        {loading || data === null ? (
          loadError === null && <PublishedSkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={tab === 'published' ? 'newspaper' : 'ban'}
            title={tab === 'published' ? 'Nothing is live yet' : 'Nothing has been withdrawn'}
          >
            {tab === 'published' ? (
              <>
                A story reaches readers by going <strong>draft</strong> →{' '}
                <strong>in review</strong> → <strong>approved</strong> →{' '}
                <strong>published</strong>, and Publish only becomes available on the last of
                those. The queue is where that happens.
              </>
            ) : (
              'A withdrawn story stops being served and returns a withdrawal notice to anyone holding its link. Nothing has needed that.'
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="list">
              {data.items.map((row) => {
                const live = row.status === 'published';

                return (
                  <li className="item published-item" key={row.id}>
                    <span className="item-body">
                      <span className="lead-title" lang={row.language}>
                        {row.headline}
                      </span>

                      <span className="item-meta">
                        <span>{row.sourceName}</span>
                        <span lang={row.language}>
                          {row.language === 'ne' ? row.categoryLabel.ne : row.categoryLabel.en}
                        </span>
                        {/* Relative for the scan, exact on hover for the record:
                            "3 days ago" is what you read, "12 Sep, 18:40" is
                            what you quote back to someone. */}
                        {row.publishedAt !== null && (
                          <span title={dateTime(row.publishedAt) ?? undefined}>
                            Published {relativeTime(row.publishedAt)}
                          </span>
                        )}
                        {row.lastEditedAt !== null && (
                          <span
                            className="item-edited"
                            title={
                              `${dateTime(row.lastEditedAt) ?? ''}` +
                              (row.lastEditReason !== null ? ` — ${row.lastEditReason}` : '')
                            }
                          >
                            Edited {relativeTime(row.lastEditedAt)}
                          </span>
                        )}
                        {row.retractedAt !== null && (
                          <span title={dateTime(row.retractedAt) ?? undefined}>
                            Withdrawn {relativeTime(row.retractedAt)}
                          </span>
                        )}
                        {!row.hasImage && <span>No picture</span>}
                      </span>

                      {row.retractionReason !== null && (
                        <span className="item-meta">
                          <span>Because: {row.retractionReason}</span>
                        </span>
                      )}
                    </span>

                    <span className="item-tail published-tail">
                      <LangTag language={row.language} />
                      {live ? (
                        <Badge tone="ok" icon="checkCircle">
                          Live
                        </Badge>
                      ) : (
                        <Badge tone="neutral" icon="ban">
                          Withdrawn
                        </Badge>
                      )}

                      {/* Icons rather than words: three actions on each of ten
                          rows is where labels stop reading as a choice and start
                          reading as noise. Each carries a name for a screen
                          reader and a tooltip for everyone else. */}
                      <span className="row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="pencil"
                          aria-label={
                            live
                              ? `Edit “${row.headline}”`
                              : `“${row.headline}” was withdrawn and cannot be edited`
                          }
                          title={live ? 'Edit the live story' : 'A withdrawn story is not edited'}
                          disabled={!live}
                          onClick={() => navigate(Routes.publishedEdit(row.id))}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="eye"
                          aria-label={`View “${row.headline}”`}
                          title="View the story and its source"
                          onClick={() => navigate(Routes.article(row.id))}
                        />
                        <a
                          className="btn btn-ghost btn-sm btn-icon"
                          href={row.publisherUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={`Open the publisher’s article for “${row.headline}”`}
                          title="The publisher’s own article"
                        >
                          <Icon name="externalLink" className="btn-icon-glyph" />
                        </a>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* No page-size control: see PUBLISHED_PER_PAGE. */}
            <Pagination
              page={page}
              perPage={PUBLISHED_PER_PAGE}
              total={total}
              onPageChange={(next) => navigate(Routes.published({ tab, page: next }))}
              noun="story"
              nounPlural="stories"
            />
          </>
        )}
      </TabPanel>
    </div>
  );
}
