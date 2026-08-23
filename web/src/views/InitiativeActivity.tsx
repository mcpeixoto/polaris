/**
 * Initiative activity — chronological status updates.
 */

import { useState } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { EmptyState, IconButton } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { report } from '~/features/issue/mutations';
import { InitiativeUpdateEditor } from '~/features/initiative-updates/InitiativeUpdateEditor';
import { listInitiativeUpdates } from '~/features/initiative-updates/helpers';
import { deleteInitiativeUpdate } from '~/features/initiative-updates/mutations';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { PencilGlyph, TrashGlyph } from '~/features/project-updates/glyphs';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { InitiativeUpdate, Store, UUID } from '~/store';
import styles from './InitiativeActivity.module.css';

interface UpdateRow {
  readonly update: InitiativeUpdate;
  readonly authorName: string | null;
}

export function InitiativeActivity() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const [editing, setEditing] = useState<UUID | null>(null);
  const [removing, setRemoving] = useState<UUID | null>(null);

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
    <>
      <ul className={styles.list}>
        {rows.map(({ update, authorName }) => {
          // Both edit and delete are author-only on the server. Drawing them for anyone
          // else would be an affordance whose only outcome is a refusal.
          const mine = viewerId !== null && viewerId === update.authorId;
          const when = formatWhen(update.createdAt);
          return (
            <li key={update.id} className={styles.item}>
              <div className={styles.header}>
                <ProjectHealthBadge health={update.health} />
                <span className={styles.meta}>
                  {authorName ?? 'Someone'} · {when}
                  {update.editedAt === undefined ? '' : ' · edited'}
                </span>
                {mine && editing !== update.id && (
                  <span className={styles.rowActions}>
                    <IconButton
                      size="sm"
                      icon={<PencilGlyph />}
                      aria-label={`Edit update from ${when}`}
                      tooltip="Edit update"
                      onClick={() => setEditing(update.id)}
                    />
                    <IconButton
                      size="sm"
                      icon={<TrashGlyph />}
                      aria-label={`Delete update from ${when}`}
                      tooltip="Delete update"
                      onClick={() => setRemoving(update.id)}
                    />
                  </span>
                )}
              </div>
              {editing === update.id ? (
                <InitiativeUpdateEditor update={update} onDone={() => setEditing(null)} />
              ) : (
                update.body !== '' && <p className={styles.body}>{update.body}</p>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        title="Delete this update?"
        consequence="The post leaves the initiative's history. If it was the latest one, the initiative's health falls back to the update before it."
        confirmLabel="Delete update"
        destructive
        onConfirm={() => {
          if (removing !== null) {
            if (editing === removing) setEditing(null);
            deleteInitiativeUpdate(engine, removing).catch(report);
          }
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

function listUpdateRows(store: Store, initiativeId: UUID): UpdateRow[] {
  return listInitiativeUpdates(store, initiativeId).map((update) => ({
    update,
    authorName: store.users.get(update.authorId)?.displayName ?? null,
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
