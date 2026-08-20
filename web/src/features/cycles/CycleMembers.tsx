import { useSearchParams } from 'react-router';

import { Avatar } from '~/components';
import { FILTER_PARAM, toFilterParam } from '~/filter';
import type { CycleMemberShare } from './cycleDistribution';
import styles from './CycleMembers.module.css';

export function CycleMembers({
  rows,
  unitLabel,
}: {
  rows: readonly CycleMemberShare[];
  unitLabel: 'issues' | 'points';
}) {
  const [params, setParams] = useSearchParams();

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
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (active) next.delete(FILTER_PARAM);
                  else next.set(FILTER_PARAM, filter);
                  setParams(next);
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
