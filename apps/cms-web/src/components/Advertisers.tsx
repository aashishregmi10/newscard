import { useState } from 'react';
import { api, type AdvertiserInput, type AdvertiserRow } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { plural } from '../lib/format';
import { Routes } from '../nav';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  EmptyState,
  Field,
  Panel,
  Skeleton,
} from '../ui';

/**
 * The businesses that buy advertising.
 *
 * Kept apart from campaigns because reporting and billing attach to the
 * business, and one business runs many campaigns over a year.
 *
 * -- Two names, on purpose ----------------------------------------------------
 *
 * The internal name is how the newsroom refers to them and must be unique. The
 * printed name is on every ad the business runs — readers are owed the real
 * name of whoever paid — and changing it reaches every campaign at once, so a
 * rebrand never leaves an old name on a live ad.
 */

const EMPTY: AdvertiserInput = { name: '', displayName: '', contactEmail: '', isActive: true };

export function Advertisers() {
  const { data, error, loading, reload } = useResource<{ items: AdvertiserRow[] }>(
    (signal) => api.advertisers(signal),
    'advertisers',
    'Could not load the advertisers.',
  );
  const action = useAsyncAction('Could not save the advertiser.');

  /** null: nothing open. 'new': the add form. Otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<AdvertiserInput>(EMPTY);

  const open = (row: AdvertiserRow | null) => {
    action.clear();
    setEditing(row === null ? 'new' : row.id);
    setForm(
      row === null
        ? EMPTY
        : { name: row.name, displayName: row.displayName, contactEmail: row.contactEmail, isActive: row.isActive },
    );
  };

  const ready =
    form.name.trim() !== '' &&
    form.displayName.trim() !== '' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim());

  const save = async () => {
    if (!ready || editing === null) return;
    const body = {
      name: form.name.trim(),
      displayName: form.displayName.trim(),
      contactEmail: form.contactEmail.trim(),
      isActive: form.isActive,
    };
    const ok = await action.run(
      () => (editing === 'new' ? api.createAdvertiser(body) : api.editAdvertiser(editing, body)),
      editing === 'new' ? 'Advertiser added.' : 'Saved. The printed name is updated on every campaign.',
    );
    if (ok) {
      setEditing(null);
      reload();
    }
  };

  const rows = data?.items ?? [];

  return (
    <div className="page">
      <h1 className="sr-only">Advertisers</h1>
      <div className="detail-bar">
        <Breadcrumbs
          items={crumbs({ label: 'Advertising', route: Routes.ads() }, { label: 'Advertisers' })}
        />
        <div className="detail-bar-actions">
          <p className="page-sub">{data === null ? 'Loading…' : plural(rows.length, 'advertiser')}</p>
          <Button variant="primary" icon="plus" onClick={() => open(null)}>
            New advertiser
          </Button>
        </div>
      </div>

      {error !== null && <Banner tone="error">{error}</Banner>}
      {action.notice !== null && (
        <Banner tone="ok" onDismiss={action.clear}>
          {action.notice}
        </Banner>
      )}

      <div className="grid">
        <div className={editing === null ? 'col-12' : 'col-7'}>
          {loading || data === null ? (
            error === null && (
              <ul className="list" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <li className="item published-item" key={i}>
                    <span className="item-body">
                      <Skeleton height={16} width="40%" />
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : rows.length === 0 ? (
            <EmptyState
              icon="megaphone"
              title="No advertisers yet"
              action={
                <Button variant="primary" icon="plus" onClick={() => open(null)}>
                  Add the first advertiser
                </Button>
              }
            >
              Add the business once; every campaign it buys is then filed under it.
            </EmptyState>
          ) : (
            <ul className="list">
              {rows.map((a) => (
                <li className="item published-item" key={a.id} aria-current={editing === a.id || undefined}>
                  <span className="item-body">
                    <span className="lead-title">{a.displayName}</span>
                    <span className="item-meta">
                      <span>{a.name}</span>
                      <span>{a.contactEmail}</span>
                      <span>{plural(a.campaigns, 'campaign')}</span>
                    </span>
                  </span>
                  <span className="item-tail published-tail">
                    {a.isActive ? (
                      <Badge tone="ok" icon="checkCircle">
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral" icon="ban">
                        Inactive
                      </Badge>
                    )}
                    <span className="row-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="pencil"
                        aria-label={`Edit ${a.displayName}`}
                        title="Edit"
                        onClick={() => open(a)}
                      />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {editing !== null && (
          <aside className="col-5 sticky-aside">
            <Panel title={editing === 'new' ? 'New advertiser' : 'Edit advertiser'}>
              {action.error !== null && <Banner tone="error">{action.error}</Banner>}
              <Field
                label="Name on the ads"
                note="Printed on every ad this business runs. Readers are owed the real name of who paid."
              >
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    maxLength={60}
                    placeholder="Hotel X"
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Internal name" note="Unique. How the newsroom refers to them.">
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    maxLength={120}
                    placeholder="hotel-x-thamel"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Contact email" note="Where their report link is sent.">
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                  />
                )}
              </Field>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Active — new campaigns can be booked for them
              </label>
              <div className="actions">
                <Button
                  variant="primary"
                  icon="check"
                  busy={action.busy}
                  disabled={!ready}
                  onClick={() => void save()}
                >
                  {editing === 'new' ? 'Add advertiser' : 'Save changes'}
                </Button>
                <Button disabled={action.busy} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </Panel>
          </aside>
        )}
      </div>
    </div>
  );
}
