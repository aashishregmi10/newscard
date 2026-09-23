/**
 * An indeterminate progress indicator.
 *
 * Always hidden from assistive technology. A spinner is a picture of waiting,
 * and the waiting itself is announced by `aria-busy` on the control or region
 * that is actually busy — which is information a screen reader can act on,
 * where "image" is not.
 */
export function Spinner({ className }: { className?: string }) {
  return <span className={className === undefined ? 'spinner' : `spinner ${className}`} aria-hidden="true" />;
}
