/**
 * Who is carrying the cycle, and a one-click filter down to any one of them.
 *
 * Each row is a toggle rather than a link: pressing it narrows the issue list beside it to
 * that assignee, pressing it again widens it back. That state is announced through
 * `aria-pressed` — it used to be carried by a background tint alone, which is a selection
 * marked by colour and by nothing else, and a keyboard user tabbing the panel had no way
 * to tell which filter was already on.
 */

import { useNavigate, useSearchParams } from 'react-router';

import { Avatar } from '~/components';
import { FILTER_PARAM, filterSearchString, toFilterParam } from '~/filter';
import type { CycleMemberShare } from './cycleDistribution';
import styles from './CycleMembers.module.css';

export function CycleMembers({
  rows,
  unitLabel,
}: {
  rows: readonly CycleMemberShare[];
  unitLabel: 'issues' | 'points';
}) {
  const [params] = useSearchParams();
  // `useSearchParams`'s setter serialises through `URLSearchParams.toString()`, which
  // escapes the filter grammar's parentheses and commas. `filterSearchString` is the
  // writer that does not — see `~/filter/url`.
  const navigate = useNavigate();

  if (rows.length === 0) {
    return (
      <aside className={styles.panel} aria-label="Cycle members">
        <h2 className={styles.heading}>Members</h2>
        <p className={styles.empty}>Nobody is on this cycle yet.</p>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Cycle members">
      <h2 className={styles.heading}>Members</h2>
      <ul className={styles.list}>
        {rows.map((row) => {
          const filter =
            row.userId === null
              ? toFilterParam({ field: 'assignee', op: 'isNull' })
              : toFilterParam({ field: 'assignee', op: 'eq', values: [row.userId] });
          const active = params.get(FILTER_PARAM) === filter;
          return (
            <li key={row.userId ?? 'unassigned'}>
              <button
                type="button"
                className={[styles.row, active ? styles.active : null].filter(Boolean).join(' ')}
                aria-pressed={active}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (active) next.delete(FILTER_PARAM);
                  else next.set(FILTER_PARAM, filter);
                  void navigate({ search: filterSearchString(next) });
                }}
              >
                {row.userId === null ? (
                  <span className={styles.unassigned} aria-hidden="true" />
                ) : (
                  <Avatar
                    name={row.name}
                    src={row.avatarUrl}
                    size="xs"
                    colorKey={row.userId}
                    decorative
                  />
                )}
                <span className={styles.name}>{row.name}</span>
                <span className={styles.count}>
                  {row.completed}/{row.issueCount}
                  {unitLabel === 'points' ? ` · ${row.estimate}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
