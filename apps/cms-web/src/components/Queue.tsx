import { useEffect, useState, useCallback } from 'react';
import { api, ApiError, type QueueItem, type Limits } from '../api';

/** Skeleton rows match the real row's geometry exactly, so nothing shifts when
 *  the data lands. A spinner in the middle of an empty page would move every
 *  row down by its own height the moment it disappears. */
function QueueSkeleton() {
  return (
    <div className="queue" aria-busy="true" aria-label="Loading queue">
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="row" key={i} style={{ cursor: 'default', opacity: 1 - i * 0.13 }}>
          <div className="skel" style={{ height: 20, width: 70 }} />
          <div>
            <div className="skel" style={{ height: 15, width: `${72 - i * 7}%` }} />
            <div className="skel" style={{ height: 11, width: 190, marginTop: 8 }} />
          </div>
          <div className="skel" style={{ height: 20, width: 54 }} />
        </div>
      ))}
    </div>
  );
}

const STATUS_CHIP: Record<string, string> = {
  draft: 'chip-draft',
  in_review: 'chip-review',
  approved: 'chip-approved',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
};

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  onOpen: (id: string) => void;
}

export function Queue({ onOpen }: Props) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const load = useCallback(() => {
    setError(null);
    api
      .queue()
      .then((r) => {
        setItems(r.items);
        setLimits(r.limits);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  // j / k to move, Enter to open (Ch. 5.5). The keyboard path is what makes
  // three-minutes-per-story achievable; reaching for the mouse costs seconds
  // on every single item.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!items?.length) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'j') setCursor((c) => Math.min(items.length - 1, c + 1));
      else if (e.key === 'k') setCursor((c) => Math.max(0, c - 1));
      else if (e.key === 'Enter') onOpen(items[cursor]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, cursor, onOpen]);

  if (error) {
    return (
      <>
        <div className="banner banner-error">{error}</div>
        <button className="btn" onClick={load}>
          Try again
        </button>
      </>
    );
  }

  if (!items) {
    return (
      <>
        <div className="page-head">
          <h1>Queue</h1>
          <span className="count">loading…</span>
        </div>
        <QueueSkeleton />
      </>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>Nothing waiting</h2>
        <p>Every story has been dealt with. New items appear here as they arrive.</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Queue</h1>
        <span className="count">
          {items.length} waiting
          {limits ? ` · ${limits.limits.en.min}–${limits.limits.en.max} ${limits.limitType}` : ''}
        </span>
        <div className="topbar-spacer" />
        <span className="count">
          <span className="kbd">j</span> <span className="kbd">k</span> move ·{' '}
          <span className="kbd">↵</span> open
        </span>
      </div>

      <div className="queue">
        {items.map((it, i) => (
          <div
            key={it.id}
            className="row"
            data-selected={i === cursor}
            onClick={() => onOpen(it.id)}
            onMouseEnter={() => setCursor(i)}
          >
            <span className={`chip ${STATUS_CHIP[it.status] ?? 'chip-draft'}`}>
              {STATUS_LABEL[it.status] ?? it.status}
            </span>

            <div>
              <div className="row-head" lang={it.language}>
                {it.headline}
              </div>
              <div className="row-meta">
                {it.sourceName} · {it.categorySlug} · {relative(it.createdAt)}
              </div>
            </div>

            <div className="row-right">
              {it.clusterId && (
                <span className="chip chip-cluster" title="Also covered by other sources">
                  cluster
                </span>
              )}
              {it.possibleDuplicate && (
                <span className="chip chip-flag" title="Looks like an existing story">
                  dup?
                </span>
              )}
              {it.possibleLanguageMismatch && (
                <span className="chip chip-flag" title="Detected language differs from the source's">
                  lang?
                </span>
              )}
              <span className="chip chip-lang">{it.language === 'ne' ? 'नेपाली' : 'EN'}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
