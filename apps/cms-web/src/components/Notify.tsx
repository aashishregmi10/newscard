import { useState } from 'react';
import { api, type DispatchReport, type NotificationRow, type NotifyTargets } from '../api';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useResource } from '../hooks/useResource';
import { crumbs } from '../lib/crumbs';
import { dateTime, humanise, plural, timeOfDay } from '../lib/format';
import { Routes, type NotifyTab } from '../nav';
import { navigate } from '../useRoute';
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Combobox,
  EmptyState,
  Field,
  Fieldset,
  Icon,
  Panel,
  Segmented,
  Skeleton,
  TabPanel,
  Tabs,
  ToggleGroup,
  type ComboOption,
  type IconName,
  type TabDef,
} from '../ui';

/**
 * Notifications.  Spec Ch. 10.
 *
 * The screen is built around one idea: an editor should never be surprised by
 * what a send did. Reach is shown before the copy is written, quiet hours are
 * warned about rather than discovered, and the result names every reader the
 * gate stopped and why — because "sent to 4 of 60" with no explanation reads as
 * a bug and is usually a policy working correctly.
 *
 * -- Why it is three tabs and was one long page ------------------------------
 *
 * It used to stack five panels: reach, compose, the dispatch report, a
 * single-handset test, and the history. All visible at once, which sounds
 * generous and is not — the Send button sat in the middle of the page with two
 * unrelated forms below it, and the thing an editor had come to do was rarely
 * the thing at the top.
 *
 * They are three different jobs done at three different times. Composing a
 * send, looking up what was sent, and checking push works on your own handset
 * have nothing to do with one another beyond the word "notification".
 *
 * Reach did not become a tab. It is not a job — it is the context you need
 * while composing, so its headline number sits in the screen's header and its
 * two warnings sit above the compose form where they change what you write.
 */

const TYPES: ReadonlyArray<{ value: string; label: string; icon: IconName; hint: string }> = [
  {
    value: 'breaking',
    label: 'Breaking',
    icon: 'zap',
    hint: 'Bypasses the 90-minute gap. Still capped.',
  },
  {
    value: 'digest',
    label: 'Digest',
    icon: 'newspaper',
    hint: 'Links to the feed. No story needed.',
  },
  { value: 'category', label: 'Section', icon: 'tag', hint: 'Off by default on every device.' },
  { value: 'correction', label: 'Correction', icon: 'pencil', hint: 'Exempt from the daily cap.' },
];

/** The gate's machine reasons, said the way an editor would say them. */
const REASON_LABEL: Readonly<Record<string, string>> = {
  disabled: 'notifications switched off',
  channel_off: 'this channel switched off',
  cap_reached: 'already had their daily limit',
  min_gap: 'too soon after their last one',
  quiet_hours: 'quiet hours (21:30–06:30)',
  no_language: 'does not read either language sent',
};

const COPY_MAX = 160;
const ID_BASE = 'notify';

interface NotifyData {
  targets: NotifyTargets;
  history: NotificationRow[];
}

export function Notify({ tab }: { tab: NotifyTab }) {
  const { data, error: loadError, loading, reload } = useResource<NotifyData>(
    async (signal) => {
      const [targets, history] = await Promise.all([
        api.notifyTargets(signal),
        /* History is context, not a prerequisite. Losing it should not stop
           someone sending a correction. */
        api.notifyHistory(signal).catch(() => ({ items: [] as NotificationRow[] })),
      ]);
      return { targets, history: history.items };
    },
    'notify',
    'Could not load the notification screen.',
  );

  if (loading || data === null) {
    return (
      <div className="page">
        <Header reach={null} />
        {loadError !== null ? (
          <>
            <Banner tone="error">{loadError}</Banner>
            <div className="actions actions-plain">
              <Button icon="refresh" onClick={reload}>
                Try again
              </Button>
            </div>
          </>
        ) : (
          <div className="panel" aria-busy="true">
            <div className="panel-body">
              <Skeleton height={13} width="60%" />
              <Skeleton height={13} width="40%" style={{ marginTop: 10 }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  const { targets, history } = data;

  const tabs: ReadonlyArray<TabDef<NotifyTab>> = [
    { value: 'compose', label: 'Compose', icon: 'send' },
    { value: 'history', label: 'Recently sent', icon: 'clock', badge: history.length },
    { value: 'test', label: 'Test', icon: 'smartphone' },
  ];

  return (
    <div className="page">
      <Header reach={targets.devices.withToken} />

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(next) => navigate(Routes.notifications(next))}
        idBase={ID_BASE}
        aria-label="Notification tasks"
      />

      <TabPanel value="compose" current={tab} idBase={ID_BASE}>
        <Compose targets={targets} onSent={reload} />
      </TabPanel>

      <TabPanel value="history" current={tab} idBase={ID_BASE}>
        <History rows={history} />
      </TabPanel>

      <TabPanel value="test" current={tab} idBase={ID_BASE}>
        <TestSend />
      </TabPanel>
    </div>
  );
}

function Header({ reach }: { reach: number | null }) {
  return (
    <>
      <h1 className="sr-only">Notifications</h1>
      <div className="detail-bar">
        <Breadcrumbs items={crumbs({ label: 'Notifications' })} showBack={false} />
        <div className="detail-bar-actions">
          <p className="page-sub">
            {reach === null ? 'Loading…' : `${plural(reach, 'device')} can be reached`}
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ compose */

function Compose({ targets, onSent }: { targets: NotifyTargets; onSent: () => void }) {
  const send = useAsyncAction('The send failed.');

  const [type, setType] = useState('breaking');
  const [articleId, setArticleId] = useState('');
  const [titleNe, setTitleNe] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyNe, setBodyNe] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [languages, setLanguages] = useState<string[]>(['ne', 'en']);
  const [report, setReport] = useState<DispatchReport | null>(null);

  /** Prefill the side we have copy for. The other language is the editor's to
   *  write — we will not machine-translate a headline and call it editorial. */
  const chooseArticle = (id: string | null) => {
    setArticleId(id ?? '');
    if (id === null) return;
    const chosen = targets.articles.find((a) => a.id === id);
    if (chosen === undefined) return;
    if (chosen.language === 'ne' && titleNe.trim() === '') setTitleNe(chosen.headline);
    if (chosen.language === 'en' && titleEn.trim() === '') setTitleEn(chosen.headline);
  };

  const complete =
    titleNe.trim() !== '' &&
    titleEn.trim() !== '' &&
    bodyNe.trim() !== '' &&
    bodyEn.trim() !== '' &&
    languages.length > 0;
  const needsStory = type !== 'digest' && articleId === '';

  const doSend = async () => {
    setReport(null);
    const ok = await send.run(async () => {
      const res = await api.notifySend({
        type,
        articleId: articleId === '' ? null : articleId,
        title: { ne: titleNe.trim(), en: titleEn.trim() },
        body: { ne: bodyNe.trim(), en: bodyEn.trim() },
        audience: { languages, categories: [] },
      });
      setReport(res.report);
    });
    if (ok) onSent();
  };

  const quietUntil = timeOfDay(targets.quietHours.opensAt);

  return (
    <>
      {/*
        * Reach, as two warnings rather than a panel.
        *
        * The count itself is in the screen header. What is left is the part
        * that changes what you write, and only when it is true — a standing
        * panel saying "everything is fine" is a panel nobody reads, which is
        * also why nobody would read it on the day it said otherwise.
        */}
      {targets.devices.withToken === 0 && (
        <Banner tone="error" live={false}>
          No device holds a push token, so nothing can be delivered yet. A handset only gets one
          after it runs a <strong>development build</strong> — Expo Go cannot receive push on
          Android — and grants notification permission.
        </Banner>
      )}

      {targets.quietHours.active && (
        <Banner tone="warn" live={false}>
          Quiet hours are in force until {quietUntil ?? 'morning'}. Breaking news is held;
          everything else is suppressed. Use a test send to check copy now.
        </Banner>
      )}

      {send.error !== null && <Banner tone="error">{send.error}</Banner>}

      <Panel title="What to send">
        <Fieldset legend="Type" note={TYPES.find((t) => t.value === type)?.hint}>
          {(g) => (
            <Segmented
              {...g}
              aria-label="Notification type"
              value={type}
              onChange={setType}
              options={TYPES.map((t) => ({
                value: t.value,
                label: (
                  <>
                    <Icon name={t.icon} className="btn-icon-glyph" /> {t.label}
                  </>
                ),
              }))}
            />
          )}
        </Fieldset>

        {/*
          * A combo box rather than a select.
          *
          * This list is every published story, so it grows without limit and is
          * already the longest dropdown in the application. In a native select
          * that means scrolling an eight-row window looking for a headline you
          * can half remember; here you type three words of it.
          */}
        <Field
          label="Story"
          optional={type === 'digest' ? 'optional' : undefined}
          note={
            needsStory
              ? `A ${type} notification must link to a story. Only published stories are listed — a tap has to land on something readable.`
              : 'Only published stories appear here.'
          }
          noteTone={needsStory ? 'warn' : 'default'}
        >
          {(f) => (
            <Combobox
              {...f}
              clearable
              value={articleId === '' ? null : articleId}
              onChange={chooseArticle}
              placeholder={
                type === 'digest' ? 'None — link to the feed' : 'Search published stories…'
              }
              emptyLabel="No story has been published yet"
              options={targets.articles.map(
                (a): ComboOption<string> => ({
                  value: a.id,
                  label: a.headline === '' ? a.slug : a.headline,
                  hint: `${a.language === 'ne' ? 'नेपाली' : 'English'} · ${a.categorySlug}`,
                  lang: a.language,
                }),
              )}
            />
          )}
        </Field>
      </Panel>

      {/*
        * Both languages, each with its own visible label.
        *
        * A placeholder is not a label: it goes away when you type, it is grey
        * by design so it fails contrast, and it is never announced as the name
        * of the field. Four boxes distinguished only by vanishing grey text is
        * how the wrong language ends up in the wrong half.
        */}
      <Panel title="The copy">
        <Fieldset legend="Title">
          {() => (
            <>
              <Field label="नेपाली" counter={<CopyCount value={titleNe} />}>
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    lang="ne"
                    maxLength={COPY_MAX}
                    value={titleNe}
                    onChange={(e) => setTitleNe(e.target.value)}
                  />
                )}
              </Field>
              <Field label="English" counter={<CopyCount value={titleEn} />}>
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    lang="en"
                    maxLength={COPY_MAX}
                    value={titleEn}
                    onChange={(e) => setTitleEn(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </Fieldset>

        <Fieldset
          legend="Body"
          note="Both languages are required. A device tells us which languages its reader accepts, and we never send copy in one they have not asked for — so a single-language notification would simply not reach the other half of the audience."
        >
          {() => (
            <>
              <Field label="नेपाली" counter={<CopyCount value={bodyNe} />}>
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    lang="ne"
                    maxLength={COPY_MAX}
                    value={bodyNe}
                    onChange={(e) => setBodyNe(e.target.value)}
                  />
                )}
              </Field>
              <Field label="English" counter={<CopyCount value={bodyEn} />}>
                {(f) => (
                  <input
                    {...f}
                    className="input"
                    lang="en"
                    maxLength={COPY_MAX}
                    value={bodyEn}
                    onChange={(e) => setBodyEn(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </Fieldset>

        <Fieldset
          legend="Send to readers of"
          note={
            languages.length === 0 ? 'Choose at least one, or nobody is sent anything.' : undefined
          }
          noteTone="warn"
        >
          {(g) => (
            <ToggleGroup
              {...g}
              aria-label="Send to readers of"
              value={languages}
              onChange={setLanguages}
              options={[
                { value: 'ne', label: 'Nepali' },
                { value: 'en', label: 'English' },
              ]}
            />
          )}
        </Fieldset>

        <div className="actions">
          <Button
            variant="primary"
            icon="send"
            busy={send.busy}
            disabled={!complete || needsStory}
            onClick={() => void doSend()}
          >
            Send
          </Button>
        </div>
      </Panel>

      {report !== null && <Report report={report} />}
    </>
  );
}

function CopyCount({ value }: { value: string }) {
  return (
    <span className="counter" data-state={value.length > COPY_MAX ? 'over' : 'ok'}>
      {value.length} / {COPY_MAX}
    </span>
  );
}

/**
 * What the send actually did.
 *
 * Every suppressed device is accounted for by name. A number with no
 * explanation gets read as a fault and escalated; the same number with "already
 * had their daily limit" beside it gets understood and left alone.
 */
function Report({ report }: { report: DispatchReport }) {
  const reasons = Object.entries(report.bySuppression).filter(([, n]) => n > 0);
  const quietUntil = timeOfDay(report.quietHoursUntil);

  return (
    <Panel title="Result">
      <Banner tone={report.accepted > 0 ? 'ok' : 'warn'} live={false}>
        {report.accepted > 0
          ? `Accepted for delivery to ${plural(report.accepted, 'device')}.`
          : 'Nothing was delivered.'}
      </Banner>

      <p className="meta-line" style={{ marginTop: 'var(--s4)' }}>
        <span>{plural(report.devices, 'device')} registered</span>
        <span>{report.noToken} without a push token</span>
        <span>{report.attempted} passed the gate</span>
        <span>{report.suppressed} suppressed</span>
      </p>

      {reasons.length > 0 && (
        <ul className="stack-tight" style={{ marginTop: 'var(--s3)', listStyle: 'none' }}>
          {reasons.map(([reason, n]) => (
            <li className="field-note" key={reason} style={{ margin: 0 }}>
              {n} — {REASON_LABEL[reason] ?? humanise(reason)}
            </li>
          ))}
        </ul>
      )}

      {report.heldForQuietHours > 0 && (
        <Banner tone="error" live={false}>
          {report.heldForQuietHours} device{report.heldForQuietHours === 1 ? ' was' : 's were'} HELD
          for quiet hours until {quietUntil ?? 'morning'}. Nothing schedules that retry yet, so
          those readers will not receive this at all.
        </Banner>
      )}

      {report.unregistered > 0 && (
        <p className="field-note">
          {report.unregistered} token{report.unregistered === 1 ? '' : 's'} cleared — the app was
          uninstalled or the token rotated.
        </p>
      )}

      {report.failed.length > 0 && (
        <Banner tone="error" live={false}>
          {report.failed.length} failed. First: {report.failed[0]?.message}
        </Banner>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ history */

function History({ rows }: { rows: readonly NotificationRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon="bell" title="Nothing has been sent yet">
        Notifications you send will be listed here with what the gate did to each one.
      </EmptyState>
    );
  }

  return (
    <ul className="list">
      {rows.map((row) => (
        <li className="item" key={row.id}>
          <span className="item-lead">
            <Icon name={TYPES.find((t) => t.value === row.type)?.icon ?? 'bell'} />
          </span>
          <span className="item-body">
            <span className="item-title">{row.title.en || row.title.ne}</span>
            <span className="item-meta">
              <span>{humanise(row.type)}</span>
              <span>{dateTime(row.sentAt) ?? 'not sent'}</span>
              <span>{row.deepLink}</span>
            </span>
          </span>
          <span className="item-tail">
            {/*
              * "delivered" only means delivered once receipts have been
              * reconciled. Until then it is the count the push service
              * ACCEPTED, and labelling that as delivery is how a dashboard ends
              * up always reading 100% — which is worse than showing nothing,
              * because it gets believed.
              */}
            <Badge
              tone={row.receiptsCheckedAt !== null ? 'ok' : 'neutral'}
              icon={row.receiptsCheckedAt !== null ? 'checkCircle' : 'clock'}
            >
              {row.stats.delivered}/{row.stats.attempted}{' '}
              {row.receiptsCheckedAt !== null ? 'delivered' : 'accepted'}
            </Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------------- test */

function TestSend() {
  const test = useAsyncAction('The test send failed.');
  const [deviceId, setDeviceId] = useState('');

  const doTest = () =>
    test.run(
      () =>
        api.notifyTest({
          deviceId: deviceId.trim(),
          title: 'SAAR test',
          body: 'If you can read this, push works.',
          deepLink: 'saar://feed',
        }),
      'Sent. It should arrive on that handset within a few seconds.',
    );

  return (
    <Panel title="Test on one handset">
      <p className="prose">
        Sends to a single device you name, ignoring the cap, the gap and quiet hours. Those rules
        protect readers who did not ask to be interrupted; they are not owed to your own phone while
        you are checking that a tap opens the right card. Every test is written to the audit trail.
      </p>

      {test.error !== null && <Banner tone="error">{test.error}</Banner>}
      {test.notice !== null && (
        <Banner tone="ok" onDismiss={test.clear}>
          {test.notice}
        </Banner>
      )}

      <Field label="Device id" note="Shown on the app’s Settings screen.">
        {(f) => (
          <input
            {...f}
            className="input"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          />
        )}
      </Field>

      <div className="actions">
        <Button
          icon="smartphone"
          busy={test.busy}
          disabled={deviceId.trim().length < 8}
          onClick={() => void doTest()}
        >
          Send a test
        </Button>
      </div>
    </Panel>
  );
}
