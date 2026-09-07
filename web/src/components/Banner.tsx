/**
 * A standing message about the screen it sits on: an update is ready, this team is at its
 * issue limit, this view is showing stale data.
 *
 * Not a toast and not a dialogue. A toast is for something that has just happened and stops
 * being true; a dialogue is for something that must be answered before anything else can
 * happen. A banner is the third case — a condition that is simply true for as long as it is
 * true — and the two existing ones had each been built by hand, with the same row, the same
 * trailing action, and the same `role="status"` regardless of what they were saying.
 *
 * The role follows the tone, because that is the part a hand-built banner gets wrong.
 * `info` and `warning` are `status`: they are read when the reader gets to them, and
 * interrupting someone mid-sentence to say an update is available is a bad trade. `danger`
 * is `alert`: it is read at once, because something is broken or blocked and continuing to
 * type will waste the work. A tone is a claim about what the message is, never about what
 * colour it should be, and the words always say what the colour says.
 */

import type { ReactNode } from 'react';

import styles from './Banner.module.css';

export type BannerTone = 'info' | 'warning' | 'danger';

export interface BannerProps {
  tone?: BannerTone | undefined;
  /** The message. One sentence; a banner that needs a paragraph wants a page. */
  children: ReactNode;
  /** The trailing control — "Restart", "Team settings". At most one thing to do. */
  action?: ReactNode | undefined;
  className?: string | undefined;
}

export function Banner({ tone = 'info', children, action, className }: BannerProps) {
  return (
    <div
      className={[styles.banner, styles[tone], className].filter(Boolean).join(' ')}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <p className={styles.copy}>{children}</p>
      {action === undefined ? null : <div className={styles.action}>{action}</div>}
    </div>
  );
}
