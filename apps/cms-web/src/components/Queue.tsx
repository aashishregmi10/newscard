import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, type Limits, type QueueItem } from '../api';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { relativeTime } from '../lib/format';
import { clampPage, pageCountOf, pageSlice } from '../lib/pagination';
import { articleStatus } from '../lib/status';
import { Routes, type PerPage } from '../nav';
import { navigate } from '../useRoute';
import {
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
} from '../ui';

/**
 * The queue.
 *
 * -- What a row is for -------------------------------------------------------
 *
 * An editor scanning this is answering one question — which of these do I open
 * next — and the answer comes from the headline, how old it is, and whether
 * anything is wrong with it. So the headline is the only thing set in reading
 * type; status, source, section and age share one quiet line beneath it; and
 * the warnings are icons at the end where the eye finishes.
 *
 * -- Why the search and the page are in the URL ------------------------------
 *
 * Because "the second page of the queue, filtered to road" is a thing an editor
 * will want to come back to after lunch and a thing they will want to send to a
 * colleague. Held in component state it survives neither. It also makes Back
 * undo a search instead of leaving the screen.
 *
 * -- Why the filtering is done here and not by the server --------------------
 *
 * The queue endpoint returns everything waiting and has no query parameter. A
 * client-side filter over a list that is already in memory is honest about that
 * and costs nothing; what it must not do is pretend to be a search of the
 * archive. It filters what is on this screen, which is what the label says.
 */

interface QueueData {
  items: QueueItem[];
  limits: Limits;
}

function QueueSkeleton() {
  return (
    <ul className="list" aria-busy="true" aria-label="Loading the queue">
      {[0, 1, 2, 3, 4].map((i) => (
        <li className="item" key={i} style={{ opacity: 1 - i * 0.14 }}>
          <span className="item-lead">
            <Skeleton width={17} height={17} />
          </span>
          <span className="item-body">
            <Skeleton height={16} width={`${70 - i * 7}%`} />
            <Skeleton height={11} width={210} style={{ marginTop: 7 }} />
          </span>
          <span className="item-tail">
            <Skeleton width={34} height={18} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Should an ambient shortcut fire, given where focus is?
 *
 * The old handler checked for INPUT and TEXTAREA. That left three holes: a
 * `<select>` swallowed j and k as type-ahead while the handler also moved the
 * cursor; a `contenteditable` was not considered at all; and pressing Enter
 * while the New story button had focus both activated the button and opened
 * whatever the cursor was on.
 *
 * The rule that covers all three: a shortcut is ambient, so it yields to
 * anything focus is actually inside — unless that thing is this list, which is
 * what the shortcuts are for.
 */
function shortcutsApply(target: EventTarget | null, list: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (list !== null && list.contains(target)) return true;
  return target.closest('button, a[href], input, textarea, select, [contenteditable="true"]') === null;
}

/** Everything a row shows, lowercased once so filtering is not doing it per key. */
function haystack(item: QueueItem): string {
  return `${item.headline} ${item.sourceName} ${item.categorySlug} ${item.status}`.toLowerCase();
}

interface QueueProps {
  page: number;
  perPage: PerPage;
  search: string;
  onCount: (count: number) => void;
}

export function Queue({ page, perPage, search, onCount }: QueueProps) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  const { data, error, loading, reload } = useResource<QueueData>(
    async (signal) => {
      const r = await api.queue(signal);
      return { items: r.items, limits: r.limits };
    },
    'queue',
    'Could not load the queue.',
  );

  const [rawCursor, setRawCursor] = useState(0);

  /*
   * Has the pointer moved since the last key press?
   *
   * This is the fix for a genuinely maddening bug. Hovering a row set the
   * cursor, so pressing j scrolled the list, a different row slid under a
   * completely stationary mouse, `mouseenter` fired, and the cursor jumped back
   * to wherever the pointer happened to be resting. The keyboard was unusable
   * unless you first moved the mouse off the list.
   *
   * Hover may move the cursor only when the hover was caused by the person
   * moving the pointer, rather than by the content moving underneath it.
   */
  const pointerMoved = useRef(false);

  useEffect(() => {
    const onMove = () => {
      pointerMoved.current = true;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const all = data?.items ?? null;

  const matched = useMemo(() => {
    if (all === null) return null;
    const needle = search.trim().toLowerCase();
    if (needle === '') return all;
    return all.filter((item) => haystack(item).includes(needle));
  }, [all, search]);

  const total = matched?.length ?? 0;
  const pageCount = pageCountOf(total, perPage);
  const current = clampPage(page, pageCount);
  const visible = useMemo(
    () => (matched === null ? [] : pageSlice(matched, current, perPage)),
    [matched, current, perPage],
  );

  const count = visible.length;
  /*
   * Clamped where it is read rather than corrected in an effect.
   *
   * The list changes under the cursor constantly — a page turn, a keystroke in
   * the search box, a reload after publishing. If the cursor were left pointing
   * past the end, Enter would read `items[7]` of a six-item page and crash on
   * `.id`. The old code had a `!` there, which is the compiler being told to
   * stop asking exactly where it should have been listened to.
   */
  const cursor = Math.min(rawCursor, Math.max(0, count - 1));

  useEffect(() => {
    if (all !== null) onCount(all.length);
  }, [all, onCount]);

  /** Keep the selected row on screen when the keyboard moves it past the fold. */
  useEffect(() => {
    /* 'nearest' scrolls only when the row is actually out of view, so this is a
       no-op when the cursor was moved by the pointer — which is the only
       sensible behaviour when the mouse is already on the row. */
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const open = useCallback((id: string) => navigate(Routes.article(id)), []);
  const create = useCallback(() => navigate(Routes.new()), []);

  const goToPage = useCallback(
    (next: number) => {
      /* Back to the top of the new page. Carrying the cursor's index across a
         page turn would leave it in the middle of a list you have not seen. */
      setRawCursor(0);
      navigate(Routes.queue({ page: next, perPage, q: search }));
    },
    [perPage, search],
  );

  const setPerPage = useCallback(
    (next: PerPage) => {
      /* Back to page one: the row that was at the top of page 3 of 20-per-page
         is not on page 3 of 100-per-page, so keeping the number would land
         somewhere arbitrary. */
      setRawCursor(0);
      navigate(Routes.queue({ page: 1, perPage: next, q: search }));
    },
    [search],
  );

  const setSearch = useCallback(
    (next: string) => {
      setRawCursor(0);
      /* Replace rather than push. Typing "road" would otherwise leave four
         history entries — r, ro, roa, road — and Back would delete the search
         one letter at a time. */
      navigate(Routes.queue({ page: 1, perPage, q: next }), { replace: true });
    },
    [perPage],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /* A shortcut is a bare key. Cmd+J is a browser downloads panel and Ctrl+N
         is a new window; claiming them would break the browser without ever
         being what anyone meant. */
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!shortcutsApply(event.target, listRef.current)) return;

      if (event.key === 'n') {
        create();
        return;
      }
      if (count === 0) return;

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          pointerMoved.current = false;
          setRawCursor((c) => {
            const at = Math.min(c, count - 1);
            /* At the foot of a page, carry on to the next one. Stopping dead
               at the twentieth row is how paging turns a keyboard path back
               into a mouse one. */
            if (at >= count - 1 && current < pageCount) {
              goToPage(current + 1);
              return 0;
            }
            return Math.min(count - 1, at + 1);
          });
          break;
        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          pointerMoved.current = false;
          setRawCursor((c) => {
            const at = Math.min(c, count - 1);
            if (at <= 0 && current > 1) {
              goToPage(current - 1);
              return 0;
            }
            return Math.max(0, at - 1);
          });
          break;
        case 'Home':
          event.preventDefault();
          pointerMoved.current = false;
          setRawCursor(0);
          break;
        case 'End':
          event.preventDefault();
          pointerMoved.current = false;
          setRawCursor(count - 1);
          break;
        case 'Enter': {
          const item = visible[Math.min(rawCursor, count - 1)];
          if (item !== undefined) {
            event.preventDefault();
            open(item.id);
          }
          break;
        }
        case '/':
          /* The search shortcut every list on the web has. */
          event.preventDefault();
          document.getElementById(`${listId}-search`)?.focus();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, count, rawCursor, current, pageCount, open, create, goToPage, listId]);

  if (error !== null) {
    return (
      <div className="page">
        <Head total={null} limits={null} />
        <Banner tone="error">{error}</Banner>
        <div className="actions actions-plain">
          <Button icon="refresh" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (loading || matched === null) {
    return (
      <div className="page">
        <Head total={null} limits={null} />
        <QueueSkeleton />
      </div>
    );
  }

  const searching = search.trim() !== '';

  return (
    <div className="page">
      <Head total={all?.length ?? 0} limits={data?.limits ?? null} />

      <div className="toolbar">
        <SearchInput
          id={`${listId}-search`}
          value={search}
          onChange={setSearch}
          placeholder="Filter by headline, publisher or section"
          aria-label="Filter the queue"
        />
        {searching && (
          <p className="page-sub" role="status">
            {total === 0
              ? 'No matches'
              : `${total} of ${all?.length ?? 0} ${total === 1 ? 'story' : 'stories'}`}
          </p>
        )}
        <div className="toolbar-end">
          <p className="hints" aria-hidden="true">
            <span className="kbd">j</span>
            <span className="kbd">k</span>
            <span>move</span>
            <span className="hints-sep">·</span>
            <span className="kbd">↵</span>
            <span>open</span>
            <span className="hints-sep">·</span>
            <span className="kbd">/</span>
            <span>filter</span>
          </p>
        </div>
      </div>

      {total === 0 ? (
        searching ? (
          <EmptyState
            icon="search"
            title="Nothing matches that"
            action={
              <Button icon="x" onClick={() => setSearch('')}>
                Clear the filter
              </Button>
            }
          >
            No story in the queue mentions “{search.trim()}” in its headline, publisher or section.
          </EmptyState>
        ) : (
          <EmptyState
            icon="inbox"
            title="Nothing waiting"
            action={
              <Button variant="primary" icon="plus" onClick={create}>
                New story
              </Button>
            }
          >
            Every story has been dealt with. Start the next one when you are ready.
          </EmptyState>
        )
      ) : (
        <>
          {/*
            * A listbox, not a stack of clickable divs.
            *
            * The rows were `<div onClick>`: invisible to the keyboard, absent
            * from a screen reader's element list, and announced as nothing in
            * particular. `role="listbox"` with `aria-activedescendant` is the
            * pattern for a list with a roving cursor that does not itself move
            * focus, which is exactly what j and k do here.
            */}
          <ul
            className="list"
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-label="Stories waiting"
            aria-activedescendant={`${listId}-${cursor}`}
          >
            {visible.map((item, i) => {
              const look = articleStatus(item.status);
              /* Age is NOT in here. It moved to its own right-aligned column,
                 where it reads down the list as a column of ages rather than
                 sitting at a different horizontal position on every row — and
                 it gives the right edge something to align to instead of three
                 small chips floating in the middle of nowhere. */
              const meta = [item.sourceName, item.categorySlug].filter((part) => part !== '');

              return (
                <li
                  key={item.id}
                  id={`${listId}-${i}`}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className="item item-selectable"
                  role="option"
                  aria-selected={i === cursor}
                  onClick={() => open(item.id)}
                  onMouseEnter={() => {
                    if (pointerMoved.current) setRawCursor(i);
                  }}
                >
                  <span className={`item-lead ${look.leadClass}`}>
                    <Icon name={look.icon} />
                  </span>

                  <span className="item-body">
                    <span className="item-title" lang={item.language}>
                      {item.headline.trim() === '' ? (
                        /* A draft created straight from the new-story form has
                           no headline yet. An empty row is unclickable-looking
                           and indistinguishable from a rendering fault. */
                        <span style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>
                          Untitled draft
                        </span>
                      ) : (
                        item.headline
                      )}
                    </span>
                    <span className="item-meta">
                      <span className="item-meta-status">{look.label}</span>
                      {meta.map((part, index) => (
                        <span key={index}>{part}</span>
                      ))}
                    </span>
                  </span>

                  <span className="item-tail">
                    <span className="item-when">{relativeTime(item.createdAt)}</span>
                    {item.clusterId !== null && (
                      <Flag icon="layers" tone="accent" label="Also covered by other sources" />
                    )}
                    {item.possibleDuplicate && (
                      <Flag icon="copy" label="Looks like a story we already have" />
                    )}
                    {item.possibleLanguageMismatch && (
                      <Flag icon="globe" label="Detected language differs from the publisher's" />
                    )}
                    <LangTag language={item.language} />
                  </span>
                </li>
              );
            })}
          </ul>

          <Pagination
            page={current}
            perPage={perPage}
            total={total}
            onPageChange={goToPage}
            onPerPageChange={setPerPage}
            noun="story"
          />
        </>
      )}
    </div>
  );
}

/**
 * The screen's header: the trail, what is in the list, and the one thing you
 * come here to do.
 *
 * This replaces a separate page heading. The toolbar above already names the
 * section and the last crumb names it again, so a third "Queue" set in 20px
 * underneath them was saying nothing a third time. The heading survives for
 * screen readers, which do need one to navigate by.
 */
function Head({ total, limits }: { total: number | null; limits: Limits | null }) {
  const band =
    limits === null ? null : `${limits.limits.en.min}–${limits.limits.en.max} ${limits.limitType}`;

  return (
    <>
      <h1 className="sr-only">Queue</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Queue' })} showBack={false} />

        <div className="detail-bar-actions">
          <p className="page-sub">
            {total === null ? 'Loading…' : `${total} waiting`}
            {band !== null && ` · ${band}`}
          </p>
          <Button variant="primary" icon="plus" onClick={() => navigate(Routes.new())}>
            New story
          </Button>
        </div>
      </div>
    </>
  );
}
