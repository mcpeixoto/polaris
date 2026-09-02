/**
 * Project activity — chronological status updates.
 */

import { useState } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { EmptyState, IconButton } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { report } from '~/features/issue/mutations';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { PencilGlyph, TrashGlyph } from '~/features/project-updates/glyphs';
import { ProjectUpdateEditor } from '~/features/project-updates/ProjectUpdateEditor';
import { listProjectUpdates } from '~/features/project-updates/helpers';
import { deleteProjectUpdate } from '~/features/project-updates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { ProjectUpdate, Store, UUID } from '~/store';
import styles from './ProjectActivity.module.css';

interface UpdateRow {
  readonly update: ProjectUpdate;
  readonly authorName: string | null;
}

export function ProjectActivity() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [editing, setEditing] = useState<UUID | null>(null);
  const [removing, setRemoving] = useState<UUID | null>(null);

  const rows = useLiveQuery(
    (store) => listUpdateRows(store, projectId),
    ['projectUpdate', 'user'],
    [projectId],
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
      <ul className={`${styles.list ?? ''} ${styles.enter ?? ''}`}>
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
                <ProjectUpdateEditor update={update} onDone={() => setEditing(null)} />
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
        consequence="The post leaves the project's history. If it was the latest one, the project's health falls back to the update before it."
        confirmLabel="Delete update"
        destructive
        onConfirm={() => {
          if (removing !== null) {
            if (editing === removing) setEditing(null);
            deleteProjectUpdate(engine, removing).catch(report);
          }
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

function listUpdateRows(store: Store, projectId: UUID): UpdateRow[] {
  return listProjectUpdates(store, projectId).map((update) => ({
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
