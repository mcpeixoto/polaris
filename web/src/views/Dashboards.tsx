/**
 * Workspace dashboards — pages of Insights tiles over the replica.
 */

import { Link } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Button, EmptyState } from '~/components';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { plural } from '~/features/insights/plural';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { Store, UUID } from '~/store';
import styles from './Dashboards.module.css';

interface DashboardRow {
  readonly id: UUID;
  readonly name: string;
  readonly description: string;
  readonly scope: string;
  readonly tileCount: number;
}

export function Dashboards() {
  const { registry, context } = useKeymap();
  const viewerId = useViewerId();
  const create = () => registry.invoke('dashboard.create', { source: 'menu', context });
  const settled = useStoreSettled();

  const rows = useLiveQuery(
    (store) => listDashboards(store, viewerId),
    ['dashboard', 'dashboardTile', 'team'],
    [viewerId],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Dashboards</h1>
        <Button variant="primary" onClick={create}>
          New dashboard
        </Button>
      </header>

      {rows.length === 0 && !settled ? (
        // "No dashboards yet" is a claim, and on a cold start it was one the client could
        // not yet make: the list is empty because the snapshot has not landed.
        <EntityLoading label="Loading dashboards…" lines={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No dashboards yet"
          description="A dashboard is a page of Insights tiles — issue count, effort, cycle time — over the live replica."
          action={
            <Button variant="primary" onClick={create}>
              New dashboard
            </Button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/dashboard/${row.id}`} className={styles.row}>
                <span className={styles.body}>
                  <span className={styles.name}>{row.name}</span>
                  {row.description !== '' && (
                    <span className={styles.summary}>{row.description}</span>
                  )}
                </span>
                <span className={styles.scope}>{row.scope}</span>
                <span className={styles.count}>{plural(row.tileCount, 'tiles')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listDashboards(store: Store, viewerId: UUID | null): DashboardRow[] {
  const rows: DashboardRow[] = [];
  for (const dashboard of store.dashboards.values()) {
    if (dashboard.archivedAt !== undefined || dashboard.deletedAt !== undefined) continue;
    if (dashboard.ownerId !== undefined && dashboard.ownerId !== viewerId) continue;
    let tileCount = 0;
    for (const tileId of store.tileIdsForDashboard(dashboard.id)) {
      if (store.dashboardTiles.has(tileId)) tileCount += 1;
    }
    let scope = 'Workspace';
    if (dashboard.ownerId !== undefined) scope = 'Personal';
    else if (dashboard.teamId !== undefined) {
      const team = store.teams.get(dashboard.teamId);
      scope = team?.key ?? 'Team';
    }
    rows.push({
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      scope,
      tileCount,
    });
  }
  rows.sort((a, b) => {
    if (a.scope === 'Personal' && b.scope !== 'Personal') return -1;
    if (a.scope !== 'Personal' && b.scope === 'Personal') return 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}
