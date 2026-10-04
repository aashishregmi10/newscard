import { useState } from 'react';
import { api, type LeadCounts, type LeadRow, type NewStoryOptions } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { relativeTime } from '../lib/format';
import { LEADS_PER_PAGE, Routes, type LeadTab } from '../nav';
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
  Listbox,
  Pagination,
  Skeleton,
  TabPanel,
  Tabs,
  type TabDef,
} from '../ui';

/**
 * Triage.  Plan §2a.
 *
 * The collector reads the feeds of publishers we are allowed to read and writes
 * what it finds here. This screen is the other half of that: what a person does
 * with forty headlines.
 *
 * -- Why the extract and the thumbnail are here ------------------------------
 *
 * They are the publisher's own words and the publisher's own image, and neither
 * is ever shown to a reader from here. They exist so that judging forty stories
 * does not mean opening forty tabs. The thumbnail is an `<img src>` pointing at
 * their server: it is copied into our media store only when a lead is promoted
 * and the publisher's licence allows their photos (see the lead schema).
 *
 * -- Why promoting asks for a section ----------------------------------------
 *
 * A lead has no section. The feed does not tell us one that we would trust, and
 * guessing would file half the queue under Top Stories. It is one dropdown and
 * it is the only thing the editor has to decide before the composer opens.
 *
 * -- Why a dismissal needs a reason ------------------------------------------
 *
 * Because the dismissed list is read later, by someone deciding whether a
 * publisher is worth keeping. "Dismissed 40 of 45" says nothing; "press release"
 * forty times says the feed is the wrong one.
 *
 * -- Why this screen fills the window ----------------------------------------
 *
 * It carries no form, so there is no measure to protect. A lead row is a
 * headline, two lines of the story and a thumbnail, and all three want the room.
 */

function LeadsSkeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading leads">
      {[0, 1, 2].map((i) => (
        <li className="item lead-item" key={i} style={{ opacity: 1 - i * 0.2 }}>
          <span className="lead-thumb lead-thumb-empty" />
          <span className="item-body">
            <Skeleton height={19} width={`${70 - i * 10}%`} />
            <Skeleton height={13} style={{ marginTop: 9 }} />
            <Skeleton height={13} width="88%" style={{ marginTop: 5 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Data {
  items: LeadRow[];
  total: number;
  counts: LeadCounts;
}

export function Leads({ tab, page }: { tab: LeadTab; page: number }) {
  const { data, error: loadError, loading, reload } = useResource<Data>(
    (signal) => api.leads(tab, page, LEADS_PER_PAGE, signal),
    `leads:${tab}:${page}`,
    'Could not load the incoming stories.',
  );

  /* The sections, for the promote control. Loaded once and shared by every row
     rather than fetched when a row is expanded. */
  const { data: options } = useResource<NewStoryOptions>(
    (signal) => api.options(signal),
    'options',
    'Could not load the sections.',
  );

  const action = useAsyncAction();

  /** Which row has its promote/dismiss controls open. One at a time: the whole
   *  point of the list is scanning it, and every row expanded is not a list. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [categorySlug, setCategorySlug] = useState('');
  const [reason, setReason] = useState('');

  const counts = data?.counts ?? { new: 0, promoted: 0, dismissed: 0 };
  const total = data?.total ?? 0;

  const tabs: ReadonlyArray<TabDef<LeadTab>> = [
    { value: 'new', label: 'Waiting', icon: 'inbox', badge: counts.new || undefined },
    { value: 'promoted', label: 'Promoted', icon: 'checkCircle' },
    { value: 'dismissed', label: 'Dismissed', icon: 'ban' },
  ];

  const categories = options?.categories ?? [];
  const chosenSection = categorySlug === '' ? (categories[0]?.slug ?? '') : categorySlug;

  const close = () => {
    setOpenId(null);
    setReason('');
  };

  const promote = async (lead: LeadRow) => {
    if (chosenSection === '') return;
    const ok = await action.run(async () => {
      const { articleId } = await api.promoteLead(lead.id, chosenSection);
      /* Straight into the composer. The next thing anyone does with a promoted
         lead is write the summary, and returning them to the list would make
         finding the draft they just made the first task. */
      navigate(Routes.article(articleId));
    });
    if (ok) close();
  };

  const dismiss = async (lead: LeadRow) => {
    if (reason.trim().length < 3) return;
    const ok = await action.run(() => api.dismissLead(lead.id, reason.trim()), 'Dismissed.');
    if (ok) {
      close();
      reload();
    }
  };

  const goTo = (next: { tab?: LeadTab; page?: number }) =>
    navigate(Routes.leads({ tab, page, ...next }));

  return (
    <div className="page">
      <h1 className="sr-only">Incoming</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Incoming' })} showBack={false} />
        <div className="detail-bar-actions">
          <p className="page-sub">{data === null ? 'Loading…' : `${counts.new} waiting`}</p>
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
        /* Back to page one. Landing on page four of a tab you have not looked at
           is the same broken-link feeling the rail avoids. */
        onChange={(next) => navigate(Routes.leads({ tab: next }))}
        idBase="leads"
        aria-label="Filter incoming stories"
      />

      <TabPanel value={tab} current={tab} idBase="leads">
        {loading || data === null ? (
          loadError === null && <LeadsSkeleton />
        ) : data.items.length === 0 ? (
          /*
            * The explanation lives here rather than under the list.
            *
            * It was a standing panel at the foot of every page, which is where
            * an explanation is least wanted: once the list has forty rows in it
            * nobody is reading how the list fills. An empty list is the one
            * moment the question is live, so that is where the answer belongs.
            */
          <EmptyState
            icon={tab === 'new' ? 'inbox' : 'search'}
            title={tab === 'new' ? 'Nothing waiting' : 'Nothing here'}
          >
            {tab === 'new' ? (
              <>
                The collector reads the feed of any publisher marked <strong>public feed</strong>{' '}
                or licensed, once per their poll interval, and keeps anything less than three days
                old. It writes nothing a reader can see.
                <br />
                <br />
                Promoting one creates a <strong>draft</strong>, and that is the stronger gate: a
                story can only be written against a publisher whose licence is{' '}
                <strong>agreed</strong>. A feed can legitimately fill this list and refuse every
                promotion out of it until an agreement is recorded.
              </>
            ) : (
              'No lead has reached this state yet.'
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="list">
              {data.items.map((lead) => {
                const isOpen = openId === lead.id;

                return (
                  <li className="item lead-item" key={lead.id}>
                    {/*
                      * Always occupies the first column, with or without a
                      * picture. `.item` is a three-column grid, so a row that
                      * simply omitted this would put its headline where every
                      * other row puts a thumbnail, and the list would stop
                      * lining up the moment one feed carried images and another
                      * did not.
                      *
                      * The image itself is THEIRS, referenced on their server
                      * and never copied to ours.
                      */}
                    {lead.feedImageUrl === null ? (
                      <span className="lead-thumb lead-thumb-empty" aria-hidden="true" />
                    ) : (
                      <img className="lead-thumb" src={lead.feedImageUrl} alt="" loading="lazy" />
                    )}

                    <span className="item-body">
                      <span className="lead-title" lang={lead.language}>
                        {lead.headline}
                      </span>
                      {lead.feedExtract !== null && lead.feedExtract !== '' && (
                        <span className="lead-extract" lang={lead.language}>
                          {lead.feedExtract}
                        </span>
                      )}
                      <span className="item-meta">
                        <span>{lead.sourceName}</span>
                        <span>{relativeTime(lead.publishedAt ?? lead.fetchedAt)}</span>
                        {lead.dismissedReason !== null && <span>{lead.dismissedReason}</span>}
                      </span>

                      {isOpen && (
                        <span className="lead-actions">
                          <span className="grid">
                            <span className="col-6">
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
                            </span>
                            <span className="col-6">
                              <Field
                                label="Or dismiss, because"
                                note="Kept, so the same headline is not offered again."
                              >
                                {(f) => (
                                  <input
                                    {...f}
                                    className="input"
                                    placeholder="Press release"
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
                      )}
                    </span>

                    <span className="item-tail">
                      <LangTag language={lead.language} />
                      <a
                        className="btn btn-sm"
                        href={lead.canonicalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open <Icon name="externalLink" className="btn-icon-glyph" />
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
                        /* The draft it became. The id is already on the row, and
                           without this the two screens have no way back to each
                           other. */
                        lead.promotedArticleId !== null ? (
                          <Button
                            size="sm"
                            icon="fileText"
                            onClick={() => navigate(Routes.article(lead.promotedArticleId!))}
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

            {/* No page-size control: see LEADS_PER_PAGE. */}
            <Pagination
              page={page}
              perPage={LEADS_PER_PAGE}
              total={total}
              onPageChange={(next) => goTo({ page: next })}
              noun="lead"
            />
          </>
        )}
      </TabPanel>
    </div>
  );
}
