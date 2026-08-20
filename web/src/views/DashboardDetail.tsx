/**
 * One dashboard — a dense grid of Insights tiles over the replica.
 */

import { useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Select } from '~/components';
import {
  createDashboardTile,
  deleteDashboard,
  deleteDashboardTile,
  updateDashboardTile,
} from '~/features/dashboards/mutations';
import { issueIdsForTile, TILE_MEASURE, TILE_SLICE } from '~/features/dashboards/issueIds';
import { buildInsights, MEASURE_LABELS, SLICE_LABELS } from '~/features/insights/computeInsights';
import { formatTotal, formatValue, InsightChart } from '~/features/insights/InsightChart';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type {
  Dashboard,
  DashboardMeasure,
  DashboardSlice,
  DashboardTile,
  DashboardTileDisplay,
  Store,
  UUID,
} from '~/store';
import styles from './DashboardDetail.module.css';

const MEASURES: readonly DashboardMeasure[] = [
  'count',
  'effort',
  'cycle_time',
  'lead_time',
  'issue_age',
  'burn_up',
];

const SLICES: readonly DashboardSlice[] = [
  'assignee',
  'priority',
  'state_category',
  'team',
  'project',
  'label',
];

const DISPLAYS: readonly DashboardTileDisplay[] = ['chart', 'table', 'metric'];

export function DashboardDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { dashboardId = '' } = useParams<{ dashboardId: string }>();

  const dashboard = useLiveQuery(
    (store) => store.dashboards.get(dashboardId) ?? null,
    ['dashboard'],
    [dashboardId],
  );

  const tiles = useLiveQuery(
    (store) => (dashboard === null ? [] : listTiles(store, dashboard.id)),
    ['dashboard', 'dashboardTile'],
    [dashboardId],
  );

  const teamKey = useLiveQuery(
    (store) => {
      if (dashboard === null || dashboard.teamId === undefined) return null;
      return store.teams.get(dashboard.teamId)?.key ?? 'Team';
    },
    ['dashboard', 'team'],
    [dashboardId],
  );

  if (dashboard === null) {
    return (
      <EmptyState
        title="No such dashboard"
        description="It may have been archived or deleted."
        action={<Button onClick={() => navigate('/dashboards')}>All dashboards</Button>}
      />
    );
  }

  const addTile = () => {
    void createDashboardTile(engine, { dashboardId: dashboard.id });
  };

  const remove = () => {
    void deleteDashboard(engine, dashboard.id).then(() => navigate('/dashboards'));
  };

  let scope = 'Workspace';
  if (dashboard.ownerId !== undefined) scope = 'Personal';
  else if (teamKey !== null) scope = teamKey;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{dashboard.name}</h1>
          <span className={styles.scope}>{scope}</span>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={addTile}>
            Add tile
          </Button>
          <Button variant="ghost" size="sm" onClick={remove}>
            Delete
          </Button>
        </div>
      </header>

      {tiles.length === 0 ? (
        <EmptyState
          title="No tiles yet"
          description="Add a tile to chart an Insights measure over this workspace."
          action={
            <Button variant="primary" onClick={addTile}>
              Add tile
            </Button>
          }
        />
      ) : (
        <div className={styles.grid}>
          {tiles.map((tile) => (
            <TileCard key={tile.id} dashboard={dashboard} tile={tile} />
          ))}
        </div>
      )}
    </div>
  );
}

function listTiles(store: Store, dashboardId: UUID): DashboardTile[] {
  const tiles: DashboardTile[] = [];
  for (const id of store.tileIdsForDashboard(dashboardId)) {
    const tile = store.dashboardTiles.get(id);
    if (tile !== undefined) tiles.push(tile);
  }
  tiles.sort((a, b) => a.sortOrder.localeCompare(b.sortOrder) || a.id.localeCompare(b.id));
  return tiles;
}

function TileCard({ dashboard, tile }: { dashboard: Dashboard; tile: DashboardTile }) {
  const engine = useEngine();
  const data = useLiveQuery(
    (store) => {
      const ids = issueIdsForTile(store, dashboard, tile);
      return buildInsights(store, ids, TILE_MEASURE[tile.measure], TILE_SLICE[tile.slice]);
    },
    [
      'issue',
      'team',
      'user',
      'workflowState',
      'label',
      'issueLabel',
      'project',
      'dashboard',
      'dashboardTile',
    ],
    [dashboard.id, tile.id, tile.measure, tile.slice, tile.display],
  );

  const title = tile.title !== '' ? tile.title : MEASURE_LABELS[TILE_MEASURE[tile.measure]];

  return (
    <article className={styles.tile} aria-label={title}>
      <div className={styles.tileHead}>
        <h2 className={styles.tileTitle}>{title}</h2>
        <span className={styles.tileTotal}>{formatTotal(data.total, data.unit)}</span>
        <Button variant="ghost" size="sm" onClick={() => void deleteDashboardTile(engine, tile.id)}>
          Remove
        </Button>
      </div>
      <div className={styles.tileControls}>
        <Select
          label="Measure"
          hideLabel
          value={tile.measure}
          onChange={(event) =>
            void updateDashboardTile(engine, tile.id, {
              measure: event.target.value as DashboardMeasure,
            })
          }
        >
          {MEASURES.map((value) => (
            <option key={value} value={value}>
              {MEASURE_LABELS[TILE_MEASURE[value]]}
            </option>
          ))}
        </Select>
        {tile.measure !== 'burn_up' && (
          <Select
            label="Slice"
            hideLabel
            value={tile.slice}
            onChange={(event) =>
              void updateDashboardTile(engine, tile.id, {
                slice: event.target.value as DashboardSlice,
              })
            }
          >
            {SLICES.map((value) => (
              <option key={value} value={value}>
                {SLICE_LABELS[TILE_SLICE[value]]}
              </option>
            ))}
          </Select>
        )}
        <Select
          label="Display"
          hideLabel
          value={tile.display}
          onChange={(event) =>
            void updateDashboardTile(engine, tile.id, {
              display: event.target.value as DashboardTileDisplay,
            })
          }
        >
          {DISPLAYS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      {tile.display === 'metric' && (
        <p className={styles.metric}>{formatTotal(data.total, data.unit)}</p>
      )}
      {tile.display === 'chart' && <InsightChart data={data} />}
      {tile.display === 'table' && data.chart === 'area' && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.burn.map((point) => (
              <tr key={point.month}>
                <td>{point.month}</td>
                <td>{formatValue(point.completed, data.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tile.display === 'table' && data.chart !== 'area' && data.buckets.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{SLICE_LABELS[data.slice]}</th>
              <th>{data.unit}</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map((bucket) => (
              <tr key={bucket.key}>
                <td>{bucket.label}</td>
                <td>{formatValue(bucket.value, data.unit)}</td>
                <td>{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
