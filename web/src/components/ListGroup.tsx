/**
 * A group header on a list screen: a chevron, a name, a count, and whatever the group adds.
 *
 * Every list in the product groups something — projects by status, cycles by when they run,
 * documents by team — and each screen that grew its own header grew its own answer to the
 * two things that are easy to get wrong. It says `aria-expanded` on the control that folds,
 * so a screen reader can tell a shut group from an empty one. And it remembers the fold,
 * per person and per screen, in `localStorage` rather than in the URL — see
 * `~/features/view/collapse` for why that is a line rather than a shortcut.
 *
 * The count sits outside the fold's name on purpose, and is read out rather than hidden: it
 * is the one fact a heading carries that its rows do not.
 *
 * Persistence is read-modify-write against storage on every toggle rather than against the
 * component's own state, because the groups on a screen are siblings. Each holds only its
 * own key, and a version that wrote its own idea of the whole set would have the last group
 * toggled unfold every other one.
 */

import { useCallback, useState, type ReactNode } from 'react';

import { readCollapsed, writeCollapsed } from '~/features/view/collapse';

import { ChevronGlyph } from './glyphs';
import styles from './ListGroup.module.css';

export interface ListGroupProps {
  /** This group's key within the screen. Stable across renders and reloads, not the index. */
  groupKey: string;
  /**
   * Which screen is remembering. Undefined means "do not remember" — the honest answer for
   * an ad-hoc list whose identity is the ids in its own URL.
   */
  preferenceKey?: string | undefined;
  name: string;
  /** How many rows the group holds. Shown even at zero: an empty group is a fact. */
  count: number;
  /** Drawn between the name and the trailing action — a progress bar, a date range. */
  detail?: ReactNode;
  /** The trailing control, normally a "+" that files something into this group. */
  action?: ReactNode;
  /** Told after every fold, for a caller that has to re-measure or re-virtualise. */
  onToggle?: ((groupKey: string, collapsed: boolean) => void) | undefined;
  children: ReactNode;
}

export function ListGroup({
  groupKey,
  preferenceKey,
  name,
  count,
  detail,
  action,
  onToggle,
  children,
}: ListGroupProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(preferenceKey).has(groupKey));

  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);

    const stored = new Set(readCollapsed(preferenceKey));
    if (next) stored.add(groupKey);
    else stored.delete(groupKey);
    writeCollapsed(preferenceKey, stored);

    onToggle?.(groupKey, next);
  }, [collapsed, groupKey, preferenceKey, onToggle]);

  // Two controls in one bar, so the bar is a `div` and the fold is the button inside it: a
  // button cannot hold another button, and the trailing action is a command of its own.
  return (
    <div className={styles.group}>
      <div className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={!collapsed} onClick={toggle}>
          <span
            className={[styles.chevron, collapsed ? styles.chevronShut : null]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          >
            <ChevronGlyph />
          </span>
          <span className={styles.name}>{name}</span>
          <span className={styles.count}>{count}</span>
        </button>
        {detail === undefined ? null : <div className={styles.detail}>{detail}</div>}
        {action === undefined ? null : <div className={styles.action}>{action}</div>}
      </div>
      {collapsed ? null : children}
    </div>
  );
}
