import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Status badges, language tags and flags.
 *
 * -- Why every badge has an icon --------------------------------------------
 *
 * Roughly one man in twelve cannot reliably separate the green from the amber
 * these use. A queue where "approved" and "in review" differ only in hue is a
 * queue they have to read word by word. The icon is the redundant channel, and
 * it is the reason these are worth the width they take.
 */

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'badge badge-neutral',
  accent: 'badge badge-accent',
  ok: 'badge badge-ok',
  warn: 'badge badge-warn',
  bad: 'badge badge-bad',
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: IconName;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', icon, children }: BadgeProps) {
  return (
    <span className={TONE_CLASS[tone]}>
      {icon !== undefined && <Icon name={icon} />}
      {children}
    </span>
  );
}

/**
 * The language of a story.
 *
 * Outlined grey, not a filled accent pill. It is on every row without
 * exception, which makes it the least informative thing in the list — and a
 * colour spent on something always present is a colour that cannot be spent on
 * the thing that is unusual.
 *
 * The label is the language's own name so a Nepali desk reads its own word, and
 * `lang` is set so a screen reader switches voice rather than spelling it out
 * in English phonemes.
 */
export function LangTag({ language }: { language: 'ne' | 'en' }) {
  return language === 'ne' ? (
    <span className="tag-lang" lang="ne">
      नेपाली
    </span>
  ) : (
    <span className="tag-lang" lang="en">
      EN
    </span>
  );
}

export type FlagTone = 'accent' | 'warn' | 'bad';

interface FlagProps {
  icon: IconName;
  tone?: FlagTone;
  /** The whole meaning of the flag. It is the only content, so it is required. */
  label: string;
}

/**
 * A warning on a queue row, as an icon alone.
 *
 * These were text pills reading "dup?" and "lang?" — debug output on a
 * newsroom screen. As icons they take a fifth of the width, stop competing with
 * the headline for attention, and say what they actually mean on hover and to a
 * screen reader instead of abbreviating it into a guess.
 */
export function Flag({ icon, tone = 'warn', label }: FlagProps) {
  return (
    <span className={`flag flag-${tone}`}>
      <Icon name={icon} title={label} />
    </span>
  );
}
