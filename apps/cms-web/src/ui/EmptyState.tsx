import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Nothing here, and why.
 *
 * An empty region says three things or it is not worth drawing: what would be
 * here, why it is not, and what to do about it. "No shorts yet." answers only
 * the first, which is why an empty screen so often reads as a broken one.
 */
interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** For an empty region inside a panel, where the full height is a void. */
  compact?: boolean;
}

export function EmptyState({ icon, title, children, action, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? 'empty empty-inline' : 'empty'}>
      {icon !== undefined && (
        <div className="empty-icon">
          <Icon name={icon} />
        </div>
      )}
      <p className="empty-title">{title}</p>
      {children !== undefined && <p className="empty-body">{children}</p>}
      {action !== undefined && <div className="empty-action">{action}</div>}
    </div>
  );
}
