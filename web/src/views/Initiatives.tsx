/**
 * Workspace initiatives list — objectives grouping curated projects.
 */

import { Link } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState } from '~/components';
import { formatInitiativeStatus } from '~/features/initiatives/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { InitiativeStatus, Store, UUID } from '~/store';
import styles from './Initiatives.module.css';

interface InitiativeRow {
  readonly id: UUID;
  readonly name: string;
  readonly description: string;
  readonly status: InitiativeStatus;
  readonly ownerName: string | null;
  readonly ownerId: UUID | undefined;
  readonly projectCount: number;
}

export function Initiatives() {
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('initiative.create', { source: 'menu', context });

  const rows = useLiveQuery(
    (store) => listInitiatives(store),
    ['initiative', 'initiativeProject', 'user'],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Initiatives</h1>
        <Button variant="primary" onClick={create}>
          New initiative
        </Button>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No initiatives yet"
          description="An initiative is a curated set of projects tied to one objective. Use it when you need to track work over time, not just filter what matches today."
          action={
            <Button variant="primary" onClick={create}>
              New initiative
            </Button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/initiative/${row.id}`} className={styles.row}>
                <span className={styles.body}>
                  <span className={styles.name}>{row.name}</span>
                  {row.description !== '' && (
                    <span className={styles.summary}>{row.description}</span>
                  )}
                </span>
                <span className={styles.status}>{formatInitiativeStatus(row.status)}</span>
                {row.ownerName === null ? (
                  <span className={styles.ownerMuted}>No owner</span>
                ) : (
                  <span className={styles.owner}>
                    <Avatar name={row.ownerName} size="xs" colorKey={row.ownerId} decorative />
                    {row.ownerName}
                  </span>
                )}
                <span className={styles.count}>
                  {row.projectCount === 1 ? '1 project' : `${row.projectCount} projects`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listInitiatives(store: Store): InitiativeRow[] {
  const rows: InitiativeRow[] = [];
  for (const initiative of store.initiatives.values()) {
    if (initiative.archivedAt !== undefined || initiative.deletedAt !== undefined) continue;

    let projectCount = 0;
    for (const linkId of store.initiativeProjectIdsFor(initiative.id)) {
      if (store.initiativeProjects.has(linkId)) projectCount += 1;
    }

    const owner =
      initiative.ownerId === undefined ? null : (store.users.get(initiative.ownerId)?.name ?? null);

    rows.push({
      id: initiative.id,
      name: initiative.name,
      description: initiative.description,
      status: initiative.status,
      ownerName: owner,
      ownerId: initiative.ownerId,
      projectCount,
    });
  }
  return rows.sort(
    (a, b) =>
      (store.initiatives.get(a.id)?.sortOrder ?? '').localeCompare(
        store.initiatives.get(b.id)?.sortOrder ?? '',
      ) || a.name.localeCompare(b.name),
  );
}
