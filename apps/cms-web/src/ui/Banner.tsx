import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';

/**
 * An inline message.
 *
 * -- Why the role depends on the tone ---------------------------------------
 *
 * An error is the result of something the editor just did and they need to know
 * now, so it is `role="alert"` and interrupts. A confirmation is worth hearing
 * but not worth cutting across the current sentence, so it is `role="status"`
 * and waits for a pause. Marking everything assertive is the same as marking
 * nothing: people turn it off.
 *
 * A banner that is part of the page rather than a response — the standing
 * explanation on the notifications screen, say — passes `live={false}` and is
 * announced in document order like any other paragraph.
 */

export type BannerTone = 'neutral' | 'info' | 'ok' | 'warn' | 'error';

const TONE: Record<BannerTone, { className: string; icon: IconName }> = {
  neutral: { className: 'banner', icon: 'info' },
  info: { className: 'banner banner-info', icon: 'info' },
  ok: { className: 'banner banner-ok', icon: 'checkCircle' },
  warn: { className: 'banner banner-warn', icon: 'alertTriangle' },
  error: { className: 'banner banner-error', icon: 'alertCircle' },
};

interface BannerProps {
  tone?: BannerTone;
  children: ReactNode;
  /** Renders a dismiss control. Omit it and the banner cannot be closed. */
  onDismiss?: () => void;
  /** Set false for a banner that is always present, not a response. */
  live?: boolean;
  className?: string;
}

export function Banner({ tone = 'neutral', children, onDismiss, live = true, className }: BannerProps) {
  const { className: toneClass, icon } = TONE[tone];

  return (
    <div
      className={className === undefined ? toneClass : `${toneClass} ${className}`}
      role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
    >
      <Icon name={icon} className="banner-icon" />
      <div className="banner-body">{children}</div>
      {onDismiss !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          className="banner-dismiss"
          aria-label="Dismiss this message"
          onClick={onDismiss}
        />
      )}
    </div>
  );
}
