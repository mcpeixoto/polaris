/**
 * The update feed, for a project and for an initiative alike.
 *
 * There used to be two of these — `ProjectActivity` and an `InitiativeActivity` copied from
 * it — and they had already drifted: one formatted a post's date with a private
 * `toLocaleDateString` and the other with `when()` from `~/features/time`, so the same
 * record read "12 Aug 2026, 09:14" on one screen and "3 days ago" on the other. Two files
 * that must agree and nothing making them is a bug with a delivery date.
 *
 * So the feed takes what it is a feed *of*. The kinds differ in exactly three things —
 * where the posts come from, which editor corrects one, and what the confirmation says gets
 * lost — and those sit in the table below. Everything else, which is all of the drawing and
 * all of the behaviour, is written once.
 *
 * `when()` is the surviving formatter: it is what the rest of the product uses, and a feed
 * whose whole point is recency reads better as "3 days ago" with the exact timestamp on
 * hover than as a date somebody has to subtract from today.
 */

import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { EmptyState, IconButton } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { report } from '~/features/issue/mutations';
import { InitiativeUpdateEditor } from '~/features/initiative-updates/InitiativeUpdateEditor';
import { listInitiativeUpdates } from '~/features/initiative-updates/helpers';
import { deleteInitiativeUpdate } from '~/features/initiative-updates/mutations';
import { personName } from '~/features/prefs/prefs';
import { exact, when } from '~/features/time';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { PencilGlyph, TrashGlyph } from '~/features/project-updates/glyphs';
import { ProjectUpdateEditor } from '~/features/project-updates/ProjectUpdateEditor';
import { listProjectUpdates } from '~/features/project-updates/helpers';
import { deleteProjectUpdate } from '~/features/project-updates/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { ProjectUpdateHealth, Store, UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';
import styles from './ProjectActivity.module.css';

/** What a feed row is, whichever entity posted it. */
interface UpdateRow {
  readonly id: UUID;
  readonly health: ProjectUpdateHealth;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | undefined;
  readonly authorId: UUID;
  readonly authorName: string | null;
}

/** The three things that differ between the two kinds of feed. */
interface Feed {
  readonly rows: (store: Store, id: UUID) => readonly UpdateRow[];
  /** The store collections a change to which changes the feed. */
  readonly deps: readonly string[];
  readonly editor: (id: UUID, done: () => void) => ReactNode;
  readonly remove: (engine: SyncEngine, updateId: UUID) => Promise<void>;
  readonly consequence: string;
}

const PROJECT: Feed = {
  rows: (store, projectId) =>
    listProjectUpdates(store, projectId).map((update) => ({
      id: update.id,
      health: update.health,
      body: update.body,
      createdAt: update.createdAt,
      editedAt: update.editedAt,
      authorId: update.authorId,
      authorName: authorOf(store, update.authorId),
    })),
  deps: ['projectUpdate', 'user'],
  editor: (id, done) => <ProjectUpdateEditorById updateId={id} onDone={done} />,
  remove: deleteProjectUpdate,
  consequence:
    "The post leaves the project's history. If it was the latest one, the project's health falls back to the update before it.",
};

const INITIATIVE: Feed = {
  rows: (store, initiativeId) =>
    listInitiativeUpdates(store, initiativeId).map((update) => ({
      id: update.id,
      health: update.health,
      body: update.body,
      createdAt: update.createdAt,
      editedAt: update.editedAt,
      authorId: update.authorId,
      authorName: authorOf(store, update.authorId),
    })),
  deps: ['initiativeUpdate', 'user'],
  editor: (id, done) => <InitiativeUpdateEditorById updateId={id} onDone={done} />,
  remove: deleteInitiativeUpdate,
  consequence:
    "The post leaves the initiative's history. If it was the latest one, the initiative's health falls back to the update before it.",
};

export function ProjectActivity() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  return <UpdateFeed feed={PROJECT} id={projectId} />;
}

export function InitiativeActivity() {
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  return <UpdateFeed feed={INITIATIVE} id={initiativeId} />;
}

function UpdateFeed({ feed, id }: { feed: Feed; id: UUID }) {
  const engine = useEngine();
  const viewerId = useViewerId();
  const [editing, setEditing] = useState<UUID | null>(null);
  const [removing, setRemoving] = useState<UUID | null>(null);

  const rows = useLiveQuery(
    (store) => feed.rows(store, id),
    feed.deps as Parameters<typeof useLiveQuery>[1],
    [id],
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
        {rows.map((row) => {
          // Both edit and delete are author-only on the server. Drawing them for anyone
          // else would be an affordance whose only outcome is a refusal.
          const mine = viewerId !== null && viewerId === row.authorId;
          const posted = when(row.createdAt);
          return (
            <li key={row.id} className={styles.item}>
              <div className={styles.header}>
                <ProjectHealthBadge health={row.health} />
                <span className={styles.meta} title={exact(row.createdAt)}>
                  {row.authorName ?? 'Someone'} · {posted}
                  {row.editedAt === undefined ? '' : ' · edited'}
                </span>
                {mine && editing !== row.id && (
                  <span className={styles.rowActions}>
                    <IconButton
                      size="sm"
                      icon={<PencilGlyph />}
                      aria-label={`Edit update from ${posted}`}
                      tooltip="Edit update"
                      onClick={() => setEditing(row.id)}
                    />
                    <IconButton
                      size="sm"
                      icon={<TrashGlyph />}
                      aria-label={`Delete update from ${posted}`}
                      tooltip="Delete update"
                      onClick={() => setRemoving(row.id)}
                    />
                  </span>
                )}
              </div>
              {editing === row.id
                ? feed.editor(row.id, () => setEditing(null))
                : row.body !== '' && <p className={styles.body}>{row.body}</p>}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        title="Delete this update?"
        consequence={feed.consequence}
        confirmLabel="Delete update"
        destructive
        onConfirm={() => {
          if (removing !== null) {
            if (editing === removing) setEditing(null);
            feed.remove(engine, removing).catch(report);
          }
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

/**
 * The two editors take the whole row rather than its id, and the feed above keeps only the
 * fields both kinds share. Reading the row back here is what lets it stay that way.
 */
function ProjectUpdateEditorById({ updateId, onDone }: { updateId: UUID; onDone: () => void }) {
  const update = useLiveQuery(
    (store) => store.projectUpdates.get(updateId) ?? null,
    ['projectUpdate'],
    [updateId],
  );
  return update === null ? null : <ProjectUpdateEditor update={update} onDone={onDone} />;
}

function InitiativeUpdateEditorById({ updateId, onDone }: { updateId: UUID; onDone: () => void }) {
  const update = useLiveQuery(
    (store) => store.initiativeUpdates.get(updateId) ?? null,
    ['initiativeUpdate'],
    [updateId],
  );
  return update === null ? null : <InitiativeUpdateEditor update={update} onDone={onDone} />;
}

/**
 * `personName` rather than `.displayName`: the "full names" preference is one answer for
 * the whole product, and the project feed used to disagree with the initiative feed and
 * with the overview beside both.
 */
function authorOf(store: Store, authorId: UUID): string | null {
  const author = store.users.get(authorId);
  return author === undefined ? null : personName(author);
}
