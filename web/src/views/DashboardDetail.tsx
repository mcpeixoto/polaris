/**
 * One dashboard — a dense grid of Insights tiles over the replica.
 *
 * A tile's three controls carry visible labels. They were suppressed, which left a row
 * reading "Count · Assignee · chart" — three values that name none of their own fields, on
 * a surface whose entire job is to let someone reshape a measure until it answers their
 * question. They sit in a grid rather than a wrapping flex row, so a long measure name
 * cannot squeeze the display picker into an ellipsis.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input, Select } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  createDashboardTile,
  deleteDashboard,
  deleteDashboardTile,
  renameDashboard,
  updateDashboardTile,
} from '~/features/dashboards/mutations';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { issueIdsForTile, TILE_MEASURE, TILE_SLICE } from '~/features/dashboards/issueIds';
import { buildInsights, MEASURE_LABELS, SLICE_LABELS } from '~/features/insights/computeInsights';
import { formatTotal, formatValue, InsightChart } from '~/features/insights/InsightChart';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError } from '~/sync/api';
import { compareOrderKeys } from '~/store';
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

// The stored values are lower-case identifiers; the menu is prose. Sentence case, like
// every other option list in the product.
const DISPLAY_LABELS: Readonly<Record<DashboardTileDisplay, string>> = {
  chart: 'Chart',
  table: 'Table',
  metric: 'Metric',
};

export function DashboardDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { dashboardId = '' } = useParams<{ dashboardId: string }>();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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

  const state = useEntityState(dashboard);

  // A cold start used to answer a deep link with "No such dashboard" while the row was
  // still arriving, and offer a button away from a page that was about to work.
  if (state === 'loading') return <EntityLoading label="Loading dashboard…" lines={4} />;
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
    setFailure(null);
    void createDashboardTile(engine, { dashboardId: dashboard.id }).catch((error: unknown) =>
      setFailure(messageFor(error, 'That tile could not be added.')),
    );
  };

  /**
   * Deleting the dashboard, behind the confirmation the rest of the product uses.
   *
   * It was `void deleteDashboard(…).then(navigate)` — no catch, so a refusal was an
   * unhandled rejection and the screen navigated away regardless, leaving the dashboard in
   * place and the user believing it was gone.
   */
  const confirmRemoval = () => {
    setRemoving(true);
    setFailure(null);
    void deleteDashboard(engine, dashboard.id)
      .then(() => {
        setConfirming(false);
        void navigate('/dashboards');
      })
      .catch((error: unknown) => setFailure(messageFor(error, 'That could not be deleted.')))
      .finally(() => setRemoving(false));
  };

  const rename = (name: string) => {
    const trimmed = name.trim();
    // An emptied name is not a rename, and the store keeping the old one while the field
    // shows nothing is the bug this guard exists to avoid — the value below is controlled
    // by the record, so the field snaps back on the next render.
    if (trimmed === '' || trimmed === dashboard.name) return;
    setFailure(null);
    void renameDashboard(engine, dashboard.id, trimmed).catch((error: unknown) =>
      setFailure(messageFor(error, 'That name could not be saved.')),
    );
  };

  let scope = 'Workspace';
  if (dashboard.ownerId !== undefined) scope = 'Personal';
  else if (teamKey !== null) scope = teamKey;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            <Input
              label="Dashboard name"
              hideLabel
              surface="plain"
              defaultValue={dashboard.name}
              key={dashboard.name}
              onBlur={(event) => rename(event.target.value)}
            />
          </h1>
          <span className={styles.scope}>{scope}</span>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={addTile}>
            Add tile
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </div>
      </header>

      {/* While the dialog is open it owns the refusal — saying it twice, once behind the
       * scrim, is one message the reader has to reconcile with itself. */}
      {failure === null || confirming ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}

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

      <ConfirmDialog
        open={confirming}
        title="Delete this dashboard?"
        consequence={`“${dashboard.name}” and its ${tiles.length === 1 ? 'tile' : `${tiles.length} tiles`} go for good. The issues they count are untouched.`}
        confirmLabel="Delete"
        destructive
        busy={removing}
        error={failure ?? undefined}
        onConfirm={confirmRemoval}
        onClose={() => {
          setConfirming(false);
          setFailure(null);
        }}
      />
    </div>
  );
}

/** The server's own words where there are any, and a plain sentence where there are not. */
function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message !== '') return error.message;
  return fallback;
}

function listTiles(store: Store, dashboardId: UUID): DashboardTile[] {
  const tiles: DashboardTile[] = [];
  for (const id of store.tileIdsForDashboard(dashboardId)) {
    const tile = store.dashboardTiles.get(id);
    if (tile !== undefined) tiles.push(tile);
  }
  tiles.sort((a, b) => compareOrderKeys(a.sortOrder, b.sortOrder) || a.id.localeCompare(b.id));
  return tiles;
}

function TileCard({ dashboard, tile }: { dashboard: Dashboard; tile: DashboardTile }) {
  const engine = useEngine();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  /**
   * Every tile write goes through here.
   *
   * The controls were `void updateDashboardTile(…)` with no catch: a refused measure change
   * left the select showing the value the server had rejected, and said nothing.
   */
  const run = (work: Promise<void>, fallback: string) => {
    setFailure(null);
    void work.catch((error: unknown) => setFailure(messageFor(error, fallback)));
  };
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

  // The fallback used to be the only branch that ever ran: `tile.title` is a stored field
  // that nothing in the interface could write. The control grid below writes it now.
  const title = tile.title !== '' ? tile.title : MEASURE_LABELS[TILE_MEASURE[tile.measure]];
  // A burn-up is rows of periods and everything else is rows of buckets. Counted here so
  // the table can say it has nothing rather than rendering as a blank space under the
  // controls — which is what a measure with nothing eligible used to look like.
  const rows = data.chart === 'area' ? data.burn.length : data.buckets.length;

  return (
    <article className={styles.tile} aria-label={title}>
      <div className={styles.tileHead}>
        <h2 className={styles.tileTitle}>{title}</h2>
        <span className={styles.tileTotal}>{formatTotal(data.total, data.unit)}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove ${title}`}
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      </div>
      <div className={styles.tileControls}>
        <Input
          label="Title"
          placeholder={MEASURE_LABELS[TILE_MEASURE[tile.measure]]}
          defaultValue={tile.title}
          key={tile.title}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next === tile.title) return;
            run(
              updateDashboardTile(engine, tile.id, { title: next }),
              'That title could not be saved.',
            );
          }}
        />
        <Select
          label="Measure"
          value={tile.measure}
          onChange={(event) =>
            run(
              updateDashboardTile(engine, tile.id, {
                measure: event.target.value as DashboardMeasure,
              }),
              'That measure could not be saved.',
            )
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
            value={tile.slice}
            onChange={(event) =>
              run(
                updateDashboardTile(engine, tile.id, {
                  slice: event.target.value as DashboardSlice,
                }),
                'That slice could not be saved.',
              )
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
          value={tile.display}
          onChange={(event) =>
            run(
              updateDashboardTile(engine, tile.id, {
                display: event.target.value as DashboardTileDisplay,
              }),
              'That display could not be saved.',
            )
          }
        >
          {DISPLAYS.map((value) => (
            <option key={value} value={value}>
              {DISPLAY_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
      {failure === null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}
      {tile.display === 'metric' && (
        <p className={styles.metric}>{formatTotal(data.total, data.unit)}</p>
      )}
      {tile.display === 'chart' && <InsightChart data={data} />}
      {tile.display === 'table' && rows === 0 && (
        <p className={styles.empty}>
          Nothing in this view to list yet. Change the measure, or file work that this
          dashboard&rsquo;s scope covers.
        </p>
      )}
      {tile.display === 'table' && rows > 0 && data.chart === 'area' && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.burn.map((point) => (
              <tr key={point.period}>
                <td>{point.period}</td>
                <td>{formatValue(point.completed, data.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tile.display === 'table' && rows > 0 && data.chart !== 'area' && (
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

      <ConfirmDialog
        open={confirming}
        title="Remove this tile?"
        consequence={`“${title}” leaves this dashboard. The issues it counts are untouched, and the tile can be added again.`}
        confirmLabel="Remove"
        destructive
        busy={removing}
        error={failure ?? undefined}
        onConfirm={() => {
          setRemoving(true);
          setFailure(null);
          void deleteDashboardTile(engine, tile.id)
            .then(() => setConfirming(false))
            .catch((error: unknown) =>
              setFailure(messageFor(error, 'That tile could not be removed.')),
            )
            .finally(() => setRemoving(false));
        }}
        onClose={() => {
          setConfirming(false);
          setFailure(null);
        }}
      />
    </article>
  );
}
