import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

/**
 * The button.
 *
 * -- Why `type` defaults to "button" ----------------------------------------
 *
 * A `<button>` inside a `<form>` with no type is a submit button. That default
 * has silently submitted a form from a "Cancel" control in most codebases that
 * have a form in them, and the symptom — a page that reloads when you decline
 * something — never looks like a missing attribute. Submitting is opt-in here.
 *
 * -- Why busy is a prop and not the caller's business ------------------------
 *
 * Every action in this application can fail slowly, so every action button
 * needs a pending state, and a pending state means three things at once: a
 * spinner, `aria-busy` and being un-clickable so the request is not sent twice.
 * Keeping them together is the only way all three stay in step.
 */

type Variant = 'default' | 'primary' | 'ghost' | 'danger';

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

interface CommonProps {
  variant?: Variant;
  size?: 'md' | 'sm';
  /** Leading icon. Decorative: the label beside it carries the meaning. */
  icon?: IconName;
  iconAfter?: IconName;
  block?: boolean;
}

interface ButtonOwnProps extends CommonProps {
  /** Shows a spinner, sets `aria-busy` and refuses further clicks. */
  busy?: boolean;
}

type ButtonBase = ButtonOwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/**
 * A button with no visible text must carry an accessible name, and a button
 * with text must not need one. Expressed as a union so the compiler enforces
 * it rather than a review catching it.
 */
export type ButtonProps =
  | (ButtonBase & { children: ReactNode })
  | (ButtonBase & { children?: undefined; 'aria-label': string });

function classes(
  variant: Variant,
  size: 'md' | 'sm',
  iconOnly: boolean,
  block: boolean,
  extra: string | undefined,
): string {
  return [
    'btn',
    VARIANT_CLASS[variant],
    size === 'sm' ? 'btn-sm' : '',
    iconOnly ? 'btn-icon' : '',
    block ? 'btn-block' : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  iconAfter,
  busy = false,
  block = false,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined;

  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={classes(variant, size, iconOnly, block, className)}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (
        <Spinner />
      ) : icon !== undefined ? (
        <Icon name={icon} className="btn-icon-glyph" />
      ) : null}
      {children}
      {iconAfter !== undefined && !busy ? (
        <Icon name={iconAfter} className="btn-icon-glyph" />
      ) : null}
    </button>
  );
}

type LinkBase = CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>;

export type LinkButtonProps =
  | (LinkBase & { children: ReactNode })
  | (LinkBase & { children?: undefined; 'aria-label': string });

/**
 * A link that looks like a button.
 *
 * An anchor rather than a button with an onClick, because it navigates: middle
 * click, ctrl-click and "copy link address" all work, and none of them work on
 * a button. `rel` is forced rather than defaulted — a call site cannot open a
 * new tab from this application and forget `noopener`, which would hand the
 * opened page a handle to this one.
 */
export function LinkButton({
  variant = 'default',
  size = 'md',
  icon,
  iconAfter,
  block = false,
  className,
  children,
  target,
  ...rest
}: LinkButtonProps) {
  const iconOnly = children === undefined;

  return (
    <a
      {...rest}
      target={target}
      rel={target === '_blank' ? 'noreferrer noopener' : rest.rel}
      className={classes(variant, size, iconOnly, block, className)}
    >
      {icon !== undefined ? <Icon name={icon} className="btn-icon-glyph" /> : null}
      {children}
      {iconAfter !== undefined ? <Icon name={iconAfter} className="btn-icon-glyph" /> : null}
    </a>
  );
}
