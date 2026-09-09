/**
 * The flag that says work is stuck: orange for blocked by, red for blocking.
 *
 * It lived inside the relations panel, next to a section heading that already said the word.
 * A list row and a board card have no heading to say it — a blocked issue looked exactly
 * like an unblocked one — so the glyph moved here and both surfaces draw it beside the
 * identifier. `03-issue-properties.md` has described these two colours since it was written.
 *
 * `aria-hidden`, always. Every caller writes the fact in words beside it: the panel in its
 * heading, the row and the card in an `srOnly` span naming the blocker. An image announced
 * as well would read the same fact twice.
 */

import styles from './RelationFlag.module.css';

export type RelationFlagKind = 'blockedBy' | 'blocking';

export function RelationFlag({ kind }: { kind: string }) {
  if (kind !== 'blockedBy' && kind !== 'blocking') return null;
  const tone = kind === 'blockedBy' ? styles.flagBlocked : styles.flagBlocking;
  return (
    <svg
      className={[styles.flag, tone].join(' ')}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 1.5v9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3 2.25h5.5L7 4.5l1.5 2.25H3z" fill="currentColor" />
    </svg>
  );
}
