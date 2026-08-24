/**
 * Workspace initiatives list — objectives grouping curated projects, nested under parents.
 */

import { Link } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState, LabelChip } from '~/components';
import { formatInitiativeStatus } from '~/features/initiatives/mutations';
import { ActiveProjectsHealth } from '~/features/initiative-updates/ActiveProjectsHealth';
import {
  latestInitiativeUpdate,
  linkedProjectHealths,
  type LinkedProjectHealth,
} from '~/features/initiative-updates/helpers';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { byOrderKeyThen } from '~/store';
import type { InitiativeLabel, InitiativeStatus, ProjectUpdateHealth, Store, UUID } from '~/store';
import styles from './Initiatives.module.css';

interface InitiativeRow {
  readonly id: UUID;
  readonly name: string;
  readonly description: string;
  readonly status: InitiativeStatus;
  readonly health: ProjectUpdateHealth | null;
  readonly projects: readonly LinkedProjectHealth[];
  readonly labels: readonly InitiativeLabel[];
  readonly ownerName: string | null;
  readonly ownerId: UUID | undefined;
  readonly depth: number;
}

export function Initiatives() {
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('initiative.create', { source: 'menu', context });

  const rows = useLiveQuery(
    (store) => listInitiatives(store),
    [
      'initiative',
      'initiativeProject',
      'initiativeUpdate',
      'initiativeLabel',
      'initiativeLabelLink',
      'initiativeRelation',
      'project',
      'projectUpdate',
      'user',
    ],
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
            <li key={`${row.id}:${row.depth}`}>
              <Link
                to={`/initiative/${row.id}`}
                className={styles.row}
                style={{
                  paddingInlineStart: `calc(var(--space-4) + ${row.depth} * var(--space-4))`,
                }}
              >
                <span className={styles.body}>
                  <span className={styles.name}>{row.name}</span>
                  {row.description !== '' && (
                    <span className={styles.summary}>{row.description}</span>
                  )}
                  {row.labels.length > 0 && (
                    <span className={styles.labels}>
                      {row.labels.map((label) => (
                        <LabelChip key={label.id} name={label.name} color={label.color} compact />
                      ))}
                    </span>
                  )}
                </span>
                <span className={styles.status}>{formatInitiativeStatus(row.status)}</span>
                <span className={styles.health}>
                  {row.health === null ? (
                    <span className={styles.ownerMuted}>No update</span>
                  ) : (
                    <ProjectHealthBadge health={row.health} compact />
                  )}
                </span>
                <ActiveProjectsHealth projects={row.projects} />
                {row.ownerName === null ? (
                  <span className={styles.ownerMuted}>No owner</span>
                ) : (
                  <span className={styles.owner}>
                    <Avatar name={row.ownerName} size="xs" colorKey={row.ownerId} decorative />
                    {row.ownerName}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listInitiatives(store: Store): InitiativeRow[] {
  const live = [...store.initiatives.values()].filter(
    (initiative) => initiative.archivedAt === undefined && initiative.deletedAt === undefined,
  );
  const liveIds = new Set(live.map((row) => row.id));
  const toRow = (id: UUID, depth: number): InitiativeRow | null => {
    const initiative = store.initiatives.get(id);
    if (
      initiative === undefined ||
      initiative.archivedAt !== undefined ||
      initiative.deletedAt !== undefined
    ) {
      return null;
    }
    const owner =
      initiative.ownerId === undefined ? null : (store.users.get(initiative.ownerId)?.name ?? null);
    const labels = [...store.initiativeLabelIdsFor(id)]
      .map((labelId) => store.initiativeLabels.get(labelId))
      .filter(
        (label): label is InitiativeLabel => label !== undefined && label.archivedAt === undefined,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: initiative.id,
      name: initiative.name,
      description: initiative.description,
      status: initiative.status,
      health: latestInitiativeUpdate(store, initiative.id)?.health ?? null,
      projects: linkedProjectHealths(store, initiative.id),
      labels,
      ownerName: owner,
      ownerId: initiative.ownerId,
      depth,
    };
  };

  const roots = live.filter((initiative) => {
    for (const parentId of store.initiativeParentIdsFor(initiative.id)) {
      if (liveIds.has(parentId)) return false;
    }
    return true;
  });
  roots.sort(byOrderKeyThen('sortOrder', 'name'));

  const rows: InitiativeRow[] = [];
  const walk = (id: UUID, depth: number, ancestors: ReadonlySet<UUID>) => {
    const row = toRow(id, depth);
    if (row === null) return;
    rows.push(row);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const children = [...store.initiativeChildIdsFor(id)]
      .map((childId) => store.initiatives.get(childId))
      .filter(
        (child): child is NonNullable<typeof child> =>
          child !== undefined &&
          child.archivedAt === undefined &&
          child.deletedAt === undefined &&
          !nextAncestors.has(child.id),
      )
      .sort(byOrderKeyThen('sortOrder', 'name'));
    for (const child of children) {
      walk(child.id, depth + 1, nextAncestors);
    }
  };
  for (const root of roots) {
    walk(root.id, 0, new Set());
  }
  return rows;
}
