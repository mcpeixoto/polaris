/**
 * Workspace initiatives list — objectives grouping curated projects, nested under parents.
 *
 * The same table the projects list draws, because an initiative is read for the same
 * things a project is: what it is, whether it is in trouble, who owns it, when it is due,
 * how far along it is. The status pills in the toolbar filter it the way the projects
 * list's do, through the URL, so a shared link shows what its sender was looking at.
 */

import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState, LabelChip, StateIcon } from '~/components';
import { formatInitiativeStatus, INITIATIVE_STATUS_ICON } from '~/features/initiatives/mutations';
import { InitiativeGlyph } from '~/features/initiatives/glyphs';
import { initiativeProgress, type Progress } from '~/features/initiatives/progress';
import { ProgressBar } from '~/features/initiatives/ProgressBar';
import { personName } from '~/features/prefs/prefs';
import { whenDay } from '~/features/time';
import { CalendarGlyph, NoPersonGlyph, PlusGlyph } from '~/features/projects/glyphs';
import { formatTimeframe } from '~/features/projects/properties';
import { ActiveProjectsHealth } from '~/features/initiative-updates/ActiveProjectsHealth';
import {
  latestInitiativeUpdate,
  linkedProjectHealths,
  type LinkedProjectHealth,
} from '~/features/initiative-updates/helpers';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { updateAge } from '~/features/project-updates/helpers';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { byOrderKeyThen } from '~/store';
import type {
  InitiativeLabel,
  InitiativeStatus,
  ProjectUpdateHealth,
  Store,
  TimeframeGranularity,
  UUID,
} from '~/store';
import styles from './Initiatives.module.css';

interface InitiativeRow {
  readonly id: UUID;
  readonly name: string;
  readonly status: InitiativeStatus;
  readonly health: ProjectUpdateHealth | null;
  /** When the latest update was posted, for the age beside the health word. */
  readonly healthAt: string | null;
  readonly projects: readonly LinkedProjectHealth[];
  readonly labels: readonly InitiativeLabel[];
  readonly ownerName: string | null;
  readonly ownerId: UUID | undefined;
  readonly ownerAvatar: string | null;
  readonly targetDate: string | undefined;
  readonly targetGranularity: TimeframeGranularity | undefined;
  readonly progress: Progress;
  readonly depth: number;
  /**
   * The chain of initiatives that reached this row, as one string.
   *
   * The id is not a key here: an initiative may have several parents, so the same child is
   * visited once per parent and two root parents put it at the same depth twice. Keying by
   * `id:depth` collided on exactly that, and React then carried focus and scroll between
   * two rows that are not the same row.
   */
  readonly path: string;
}

/** How many label chips fit the cell before the rest become a count. */
const LABELS_SHOWN = 2;

export type InitiativeStatusFilter = 'all' | InitiativeStatus;

const STATUS_PILLS: readonly { readonly value: InitiativeStatusFilter; readonly label: string }[] =
  [
    { value: 'all', label: 'All initiatives' },
    ...(['proposed', 'planned', 'active', 'completed', 'canceled'] as const).map((status) => ({
      value: status,
      label: formatInitiativeStatus(status),
    })),
  ];

/** The `status` query parameter, or "all" for anything that is not a status. */
export function resolveInitiativeStatusFilter(params: URLSearchParams): InitiativeStatusFilter {
  const value = params.get('status');
  return STATUS_PILLS.some((pill) => pill.value === value)
    ? (value as InitiativeStatusFilter)
    : 'all';
}

export function Initiatives() {
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('initiative.create', { source: 'menu', context });
  const [searchParams, setSearchParams] = useSearchParams();
  const status = useMemo(() => resolveInitiativeStatusFilter(searchParams), [searchParams]);

  const setStatus = useCallback(
    (next: InitiativeStatusFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'all') params.delete('status');
      else params.set('status', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const rows = useLiveQuery(
    (store) => listInitiatives(store, status),
    [
      'initiative',
      'initiativeProject',
      'initiativeUpdate',
      'initiativeLabel',
      'initiativeLabelLink',
      'initiativeRelation',
      'issue',
      'project',
      'projectUpdate',
      'user',
    ],
    [status],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Initiatives</h1>
        <Button
          variant="ghost"
          icon={<PlusGlyph />}
          onClick={create}
          className={styles.newInitiative}
        >
          New initiative
        </Button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.pills} role="group" aria-label="Status">
          {STATUS_PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              className={
                status === pill.value ? `${styles.pill} ${styles.pillActive}` : styles.pill
              }
              aria-pressed={status === pill.value}
              onClick={() => setStatus(pill.value)}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && status !== 'all' ? (
        <EmptyState
          title="Nothing matches this filter"
          description="Every initiative here has a different status."
          action={
            <Button variant="secondary" onClick={() => setStatus('all')}>
              Show all initiatives
            </Button>
          }
        />
      ) : rows.length === 0 ? (
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
        <div className={styles.table}>
          <div className={styles.columns} aria-hidden="true">
            <span>Name</span>
            <span>Labels</span>
            <span>Status</span>
            <span>Health</span>
            <span>Projects</span>
            <span>Owner</span>
            <span>Target date</span>
            <span>Progress</span>
          </div>
          <ul className={styles.list}>
            {rows.map((row) => (
              <li key={row.path}>
                <Link
                  to={`/initiative/${row.id}`}
                  className={styles.row}
                  style={{
                    paddingInlineStart: `calc(var(--space-4) + ${row.depth} * var(--space-4))`,
                  }}
                >
                  <span className={styles.nameCell}>
                    <span className={styles.icon} aria-hidden="true">
                      <InitiativeGlyph />
                    </span>
                    <span className={styles.name}>{row.name}</span>
                  </span>
                  {/* Past two chips the rest become a count, which is the one thing that
                      cannot overflow a fixed-height row. */}
                  <span className={styles.labels}>
                    {row.labels.slice(0, LABELS_SHOWN).map((label) => (
                      <LabelChip key={label.id} name={label.name} color={label.color} compact />
                    ))}
                    {row.labels.length > LABELS_SHOWN && (
                      <span
                        className={styles.labelsMore}
                        title={row.labels
                          .slice(LABELS_SHOWN)
                          .map((label) => label.name)
                          .join(', ')}
                      >
                        +{row.labels.length - LABELS_SHOWN}
                      </span>
                    )}
                  </span>
                  <span className={styles.status}>
                    <StateIcon category={INITIATIVE_STATUS_ICON[row.status]} decorative />
                    {formatInitiativeStatus(row.status)}
                  </span>
                  <span className={styles.health}>
                    {row.health === null ? (
                      <span className={styles.muted}>No updates</span>
                    ) : (
                      <ProjectHealthBadge
                        health={row.health}
                        compact
                        since={row.healthAt === null ? undefined : updateAge(row.healthAt)}
                      />
                    )}
                  </span>
                  <span className={styles.projects}>
                    <ActiveProjectsHealth projects={row.projects} />
                  </span>
                  <span className={styles.owner}>
                    {row.ownerName === null ? (
                      <span className={styles.noOwner} title="No owner">
                        <NoPersonGlyph />
                      </span>
                    ) : (
                      <>
                        <Avatar
                          name={row.ownerName}
                          src={row.ownerAvatar}
                          size="sm"
                          colorKey={row.ownerId}
                          decorative
                        />
                        <span className={styles.ownerName}>{row.ownerName}</span>
                      </>
                    )}
                  </span>
                  <span className={styles.target}>
                    {row.targetDate === undefined ? (
                      <span className={styles.muted}>No target</span>
                    ) : (
                      <>
                        <CalendarGlyph />
                        {formatTarget(row.targetDate, row.targetGranularity)}
                      </>
                    )}
                  </span>
                  <span className={styles.progress}>
                    <ProgressBar progress={row.progress} label={row.name} compact />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A day target reads the way every other date in the product does; a coarser one — "Q3
 * 2026" — reads at the precision it was set with, which `whenDay` cannot express.
 */
function formatTarget(day: string, granularity: TimeframeGranularity | undefined): string {
  return granularity === undefined || granularity === 'day'
    ? whenDay(day)
    : formatTimeframe(day, granularity);
}

function listInitiatives(store: Store, status: InitiativeStatusFilter): InitiativeRow[] {
  const live = [...store.initiatives.values()].filter(
    (initiative) => initiative.archivedAt === undefined && initiative.deletedAt === undefined,
  );
  const liveIds = new Set(live.map((row) => row.id));
  const toRow = (id: UUID, depth: number, path: string): InitiativeRow | null => {
    const initiative = store.initiatives.get(id);
    if (
      initiative === undefined ||
      initiative.archivedAt !== undefined ||
      initiative.deletedAt !== undefined
    ) {
      return null;
    }
    // Through `personName`, so the "full names" preference reaches this list. It used to
    // read `.name` while the overview read `.displayName`, which showed one person under two
    // names on two screens.
    const ownerUser =
      initiative.ownerId === undefined ? undefined : store.users.get(initiative.ownerId);
    const owner = ownerUser === undefined ? null : personName(ownerUser);
    const labels = [...store.initiativeLabelIdsFor(id)]
      .map((labelId) => store.initiativeLabels.get(labelId))
      .filter(
        (label): label is InitiativeLabel => label !== undefined && label.archivedAt === undefined,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const latest = latestInitiativeUpdate(store, initiative.id);
    return {
      id: initiative.id,
      name: initiative.name,
      status: initiative.status,
      health: latest?.health ?? null,
      healthAt: latest?.createdAt ?? null,
      projects: linkedProjectHealths(store, initiative.id),
      labels,
      ownerName: owner,
      ownerId: initiative.ownerId,
      ownerAvatar: ownerUser?.avatarUrl ?? null,
      targetDate: initiative.targetDate,
      targetGranularity: initiative.targetDateGranularity,
      progress: initiativeProgress(store, initiative.id),
      depth,
      path,
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
  const walk = (id: UUID, depth: number, ancestors: ReadonlySet<UUID>, path: string) => {
    const row = toRow(id, depth, path);
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
      walk(child.id, depth + 1, nextAncestors, `${path}/${child.id}`);
    }
  };
  for (const root of roots) {
    walk(root.id, 0, new Set(), root.id);
  }

  // A filtered list is flat: a child whose parent was filtered out has nothing to indent
  // under, and an indent with no parent above it reads as a mistake.
  if (status === 'all') return rows;
  return rows.filter((row) => row.status === status).map((row) => ({ ...row, depth: 0 }));
}
