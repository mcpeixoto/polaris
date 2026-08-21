/**
 * Initiative activity — chronological status updates.
 */

import { useParams } from 'react-router';

import { EmptyState } from '~/components';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { listInitiativeUpdates } from '~/features/initiative-updates/helpers';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { InitiativeUpdate, Store, UUID } from '~/store';
import styles from './InitiativeActivity.module.css';

interface UpdateRow {
  readonly id: UUID;
  readonly health: InitiativeUpdate['health'];
  readonly body: string;
  readonly authorName: string | null;
  readonly createdAt: string;
  readonly edited: boolean;
}

export function InitiativeActivity() {
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();

  const rows = useLiveQuery(
    (store) => listUpdateRows(store, initiativeId),
    ['initiativeUpdate', 'user'],
    [initiativeId],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No updates yet"
        description="Post a status update from the Overview tab to start the activity feed."
      />
    );
  }

  return (
    <ul className={styles.list}>
      {rows.map((row) => (
        <li key={row.id} className={styles.item}>
          <div className={styles.header}>
            <ProjectHealthBadge health={row.health} />
            <span className={styles.meta}>
              {row.authorName ?? 'Someone'} · {formatWhen(row.createdAt)}
              {row.edited ? ' · edited' : ''}
            </span>
          </div>
          {row.body !== '' && <p className={styles.body}>{row.body}</p>}
        </li>
      ))}
    </ul>
  );
}

function listUpdateRows(store: Store, initiativeId: UUID): UpdateRow[] {
  return listInitiativeUpdates(store, initiativeId).map((update) => ({
    id: update.id,
    health: update.health,
    body: update.body,
    authorName: store.users.get(update.authorId)?.displayName ?? null,
    createdAt: update.createdAt,
    edited: update.editedAt !== undefined,
  }));
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
