import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** Decorative. It sets the mood of the screen; the title carries the meaning. */
  icon?: ReactNode | undefined;
  /** What is not here, in a few words: "No issues", "Nobody has been invited yet". */
  title: string;
  /** Why, or what to do about it. One sentence. */
  description?: string | undefined;
  /** The way out. Usually a Button — the same command the keyboard shortcut would run. */
  action?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * EmptyState is what a list says when it has nothing to show.
 *
 * A blank pane is indistinguishable from a pane that failed to load, and in a local-first
 * client that difference matters more than usual: the data may genuinely still be arriving.
 * So an empty list says which kind of empty it is, and offers the action that would fill
 * it, because "no issues yet" with a Create button is a first run and "no issues yet"
 * alone is a dead end.
 *
 * The title is a paragraph and not a heading. The right heading level depends entirely on
 * where the state is mounted — a whole screen, a sidebar section, a menu — and a wrong
 * level is worse for a screen-reader user navigating by structure than no heading at all.
 * A caller that knows its own document outline can put the heading around this.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {icon === undefined ? null : (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
      {action === undefined ? null : <div className={styles.action}>{action}</div>}
    </div>
  );
}
