import { useState } from 'react';
import { api, type PublishedRow } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
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
  Field,
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
 * -- Why this screen was missing, and what it cost ---------------------------
 *
 * The queue lists draft, in_review and approved — work outstanding. A published
 * story leaves it and appeared nowhere else, so the only way to answer "is that
 * one still live" was to open the app and scroll for it. The one collection
 * anybody is ever asked about in public was the one with no screen.
 *
 * -- Why the two actions are View and Correct, and not View and Edit ---------
 *
 * Because there is no edit. `PATCH /cms/articles/:id` refuses a published story
 * on purpose: what a reader saw is a matter of record, and rewriting it
 * underneath them is worse than the error being fixed. The state machine says
 * the same — `published` moves only to `retracted`, and `retracted` is terminal.
 *
 * So the pencil does the only thing that is both an edit and honest: it
 * withdraws the story and opens a new draft carrying its text, which is the
 * correction path the schema has prescribed from the beginning. The editor then
 * works in the composer as normal and it goes back through review.
 *
 * Withdraw on its own sits beside it, because "this is wrong and should not be
 * up" and "this is wrong and I am fixing it" are different decisions, and the
 * first must not force the second.
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
        <li className="item" key={i} style={{ opacity: 1 - i * 0.2 }}>
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

/** The server asks for ten characters. Saying so beats being refused by it. */
const REASON_MIN = 10;

export function Published({ tab, page }: { tab: PublishedTab; page: number }) {
  const { data, error: loadError, loading, reload } = useResource<Data>(
    (signal) => api.published(tab, page, PUBLISHED_PER_PAGE, signal),
    `published:${tab}:${page}`,
    'Could not load the published stories.',
  );

  const action = useAsyncAction();

  /** Which row has its withdrawal controls open. One at a time, as in triage. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const counts = data?.counts ?? { published: 0, retracted: 0 };
  const total = data?.total ?? 0;

  const tabs: ReadonlyArray<TabDef<PublishedTab>> = [
    {
      value: 'published',
      label: 'Live',
      icon: 'checkCircle',
      badge: counts.published || undefined,
    },
    { value: 'retracted', label: 'Withdrawn', icon: 'ban' },
  ];

  const close = () => {
    setOpenId(null);
    setReason('');
  };

  const ready = reason.trim().length >= REASON_MIN;

  const correct = async (row: PublishedRow) => {
    if (!ready) return;
    const ok = await action.run(async () => {
      const { id } = await api.correctArticle(row.id, reason.trim());
      /* Straight into the composer, for the reason promoting a lead goes there:
         the next thing anyone does with a correction is write it. */
      navigate(Routes.article(id));
    });
    if (ok) close();
  };

  const withdraw = async (row: PublishedRow) => {
    if (!ready) return;
    const ok = await action.run(
      () => api.retractArticle(row.id, reason.trim()),
      'Withdrawn. Anyone still holding the link now gets a withdrawal notice.',
    );
    if (ok) {
      close();
      reload();
    }
  };

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

      {action.error !== null && <Banner tone="error">{action.error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
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
                const isOpen = openId === row.id;
                const live = row.status === 'published';

                return (
                  <li className="item" key={row.id}>
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
                            {relativeTime(row.publishedAt)}
                          </span>
                        )}
                        {!row.hasImage && <span>No picture</span>}
                      </span>

                      {row.retractionReason !== null && (
                        <span className="item-meta">
                          <span>Withdrawn: {row.retractionReason}</span>
                        </span>
                      )}

                      {isOpen && (
                        <span className="lead-actions">
                          <span className="grid">
                            <span className="col-12">
                              <Field
                                label="Because"
                                note="Kept with the story, and read by whoever asks why it changed. At least ten characters."
                              >
                                {(f) => (
                                  <input
                                    {...f}
                                    className="input"
                                    placeholder="The minister’s name was wrong in the headline"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                  />
                                )}
                              </Field>
                            </span>
                          </span>

                          <span className="actions actions-plain">
                            <Button
                              variant="primary"
                              size="sm"
                              icon="pencil"
                              busy={action.busy}
                              disabled={!ready}
                              onClick={() => void correct(row)}
                            >
                              Withdraw and rewrite
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              icon="ban"
                              disabled={action.busy || !ready}
                              onClick={() => void withdraw(row)}
                            >
                              Withdraw only
                            </Button>
                            <Button size="sm" disabled={action.busy} onClick={close}>
                              Cancel
                            </Button>
                          </span>

                          <p className="field-note">
                            Rewriting pulls this story and opens a new draft carrying its text. The
                            correction goes back through review before readers see it — a published
                            story is never edited in place.
                          </p>
                        </span>
                      )}
                    </span>

                    <span className="item-tail">
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

                      {/* Icons rather than words: two actions on each of ten
                          rows is where labels stop reading as a choice and
                          start reading as noise. Both carry a name for a screen
                          reader and a tooltip for everyone else. */}
                      <Button
                        size="sm"
                        icon="eye"
                        aria-label={`Open “${row.headline}”`}
                        title="Open the story"
                        onClick={() => navigate(Routes.article(row.id))}
                      />
                      {live && !isOpen && (
                        <Button
                          size="sm"
                          icon="pencil"
                          aria-label={`Correct “${row.headline}”`}
                          title="Withdraw and rewrite"
                          onClick={() => {
                            setOpenId(row.id);
                            setReason('');
                          }}
                        />
                      )}
                      <a
                        className="btn btn-sm btn-icon"
                        href={row.publisherUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open the publisher’s article for “${row.headline}”`}
                        title="The publisher’s own article"
                      >
                        <Icon name="externalLink" className="btn-icon-glyph" />
                      </a>
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
