/**
 * Which issues a dashboard tile charts, from the replica.
 *
 * Workspace dashboards skip private-team work (Linear's rule, simplified). Personal and
 * team dashboards use whatever the replica already holds.
 */

import { EMPTY_FILTER, filterIssues, isFilterGroup, type FilterNode } from '~/filter';
import { filterContextFor } from '~/features/view';
import type { InsightMeasure, InsightSlice } from '~/features/insights/computeInsights';
import type {
  Dashboard,
  DashboardMeasure,
  DashboardSlice,
  DashboardTile,
  Issue,
  Store,
  UUID,
} from '~/store';

export const TILE_MEASURE: Readonly<Record<DashboardMeasure, InsightMeasure>> = {
  count: 'count',
  effort: 'effort',
  cycle_time: 'cycleTime',
  lead_time: 'leadTime',
  issue_age: 'issueAge',
  burn_up: 'burnUp',
};

export const TILE_SLICE: Readonly<Record<DashboardSlice, InsightSlice>> = {
  assignee: 'assignee',
  priority: 'priority',
  state_category: 'stateCategory',
  team: 'team',
  project: 'project',
  label: 'label',
};

export function issueIdsForTile(
  store: Store,
  dashboard: Dashboard,
  tile: DashboardTile,
  now = Date.now(),
): readonly UUID[] {
  const combined = andFilters(dashboard.filter, tile.filter);
  const timezone = [...store.teams.values()][0]?.timezone ?? 'UTC';
  return filterIssues(
    sourceIssues(store, dashboard),
    combined,
    filterContextFor(store, { now, timezone }),
  );
}

export function andFilters(left: FilterNode, right: FilterNode): FilterNode {
  if (isEmptyFilter(left)) return right;
  if (isEmptyFilter(right)) return left;
  return { conj: 'and', nodes: [left, right] };
}

function isEmptyFilter(node: FilterNode): boolean {
  return isFilterGroup(node) && (node.nodes === undefined || node.nodes.length === 0);
}

function sourceIssues(store: Store, dashboard: Dashboard): Issue[] {
  const issues: Issue[] = [];
  for (const issue of store.issues.values()) {
    if (issue.archivedAt !== undefined) continue;
    if (dashboard.teamId !== undefined && issue.teamId !== dashboard.teamId) continue;
    if (dashboard.teamId === undefined && dashboard.ownerId === undefined) {
      const team = store.teams.get(issue.teamId);
      if (team?.private === true) continue;
    }
    issues.push(issue);
  }
  return issues;
}

export { EMPTY_FILTER };
