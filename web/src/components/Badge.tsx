import type { HTMLAttributes, ReactNode } from 'react';

import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone | undefined;
  /** Leading glyph. Decorative — the text is what is read. */
  icon?: ReactNode | undefined;
  children: ReactNode;
}

/**
 * Badge is a small standing fact about the row it sits in: a member's role, an invite's
 * state, a team's visibility, a count.
 *
 * It is not a button and never becomes one. A badge that can be clicked is a filter
 * control wearing a label's clothes, and in a list of five hundred rows the difference
 * between "this is what this is" and "this does something" has to be legible without
 * hovering. Where a click is wanted, put a Button next to it.
 *
 * The tone is a claim about meaning rather than about colour — `danger` says the fact is
 * bad news, not that the chip is red — which is why a theme is allowed to move it and why
 * the text always says the same thing the colour does. Colour alone is never the message.
 */
export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={[styles.badge, styles[tone], className].filter(Boolean).join(' ')}>
      {icon === undefined ? null : (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
