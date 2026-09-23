import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Tabs.
 *
 * -- Why the selected tab belongs in the URL ---------------------------------
 *
 * Not enforced here — this component is told which tab is current and reports
 * changes — but it is why the component exists in this shape. A tab held in
 * component state is lost on refresh, cannot be linked to, and makes the
 * browser's Back button skip the whole screen rather than returning to the tab
 * you were just on. "Look at the reviewer note on this story" should be a URL.
 *
 * -- The keyboard contract ---------------------------------------------------
 *
 * A tab list is ONE tab stop, not one per tab. Tab moves into the strip and
 * then out of it to the panel; the arrow keys move between tabs. Getting this
 * wrong — every tab focusable — means a keyboard user pressing Tab to reach the
 * content presses it once per tab first, which on a six-tab screen is how the
 * keyboard stops being a way to use the application.
 *
 * Selection follows focus (automatic activation), which is correct when the
 * panels are already loaded and wrong when each tab is a fetch. These panels
 * are local, so the arrow keys show content directly rather than requiring
 * Enter afterwards.
 */

export interface TabDef<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** A count beside the label — the number of items the panel will show. */
  badge?: number;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  tabs: readonly TabDef<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Controls rendered at the far end of the strip. */
  actions?: ReactNode;
  'aria-label': string;
  /** Shared by the tabs and their panels so the two can point at each other. */
  idBase?: string;
}

export function tabId(base: string, value: string): string {
  return `${base}-tab-${value}`;
}

export function panelId(base: string, value: string): string {
  return `${base}-panel-${value}`;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  actions,
  'aria-label': ariaLabel,
  idBase,
}: TabsProps<T>) {
  const generated = useId();
  const base = idBase ?? generated;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = tabs.findIndex((tab) => tab.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : tabs.findIndex((t) => t.disabled !== true);

  /** Step to the next enabled tab, wrapping; gives up after a full lap. */
  const move = (from: number, delta: number) => {
    const n = tabs.length;
    for (let step = 0; step < n; step += 1) {
      const i = (((from + delta * (step + 1)) % n) + n) % n;
      const tab = tabs[i];
      if (tab !== undefined && tab.disabled !== true) {
        onChange(tab.value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        /* One before the first, stepping forward, lands on the first tab that
           can actually be selected. */
        event.preventDefault();
        move(tabs.length - 1, 1);
        break;
      case 'End':
        event.preventDefault();
        move(0, -1);
        break;
      default:
        break;
    }
  };

  if (tabs.length === 0) return null;

  return (
    <div className="tabs">
      <div className="tabs-strip" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab, i) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(base, tab.value)}
              className="tab"
              aria-selected={selected}
              aria-controls={panelId(base, tab.value)}
              tabIndex={i === tabStop ? 0 : -1}
              disabled={tab.disabled === true}
              onClick={() => onChange(tab.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {tab.icon !== undefined && <Icon name={tab.icon} className="tab-icon" />}
              <span className="tab-label">{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="tab-badge">{tab.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      {actions !== undefined && <div className="tabs-actions">{actions}</div>}
    </div>
  );
}

interface TabPanelProps<T extends string> {
  value: T;
  current: T;
  idBase: string;
  children: ReactNode;
}

/**
 * The content of one tab.
 *
 * The hidden panels are not rendered at all rather than hidden with CSS. They
 * hold form fields, and a hidden-but-present field is still submitted, still
 * focusable in some browsers, and still counted by "how many inputs are on this
 * page" — which is how a screen reader user ends up in a panel nobody can see.
 *
 * `tabIndex={0}` on the panel is deliberate: when a panel's content has nothing
 * focusable in it, this is what lets a keyboard user scroll it after tabbing
 * out of the strip.
 */
export function TabPanel<T extends string>({ value, current, idBase, children }: TabPanelProps<T>) {
  if (value !== current) return null;

  return (
    <div
      role="tabpanel"
      id={panelId(idBase, value)}
      aria-labelledby={tabId(idBase, value)}
      tabIndex={0}
      data-focus-ring="none"
      className="tab-panel"
    >
      {children}
    </div>
  );
}
