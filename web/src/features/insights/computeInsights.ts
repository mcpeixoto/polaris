/**
 * Insights over the issues currently in a view, computed from the replica.
 *
 * Measure × slice, live. No warehouse: the panel re-runs when the filter or the stream
 * moves, which is the constraint Linear's own docs call out and the reason this lives
 * next to the list rather than behind an API.
 */

import { STATE_LABELS, priorityLabel } from '~/components';
import { effortOf } from '~/features/estimate';
import { isFilterGroup, type FilterClause, type FilterNode } from '~/filter';
import type { Issue, StateCategory, Store, UUID } from '~/store';

export const INSIGHT_MEASURES = [
  'count',
  'effort',
  'cycleTime',
  'leadTime',
  'issueAge',
  'burnUp',
] as const;

export type InsightMeasure = (typeof INSIGHT_MEASURES)[number];

export const INSIGHT_SLICES = [
  'assignee',
  'priority',
  'stateCategory',
  'team',
  'project',
  'label',
] as const;

export type InsightSlice = (typeof INSIGHT_SLICES)[number];

export const MEASURE_LABELS: Readonly<Record<InsightMeasure, string>> = {
  count: 'Issue count',
  effort: 'Effort',
  cycleTime: 'Cycle time',
  leadTime: 'Lead time',
  issueAge: 'Issue age',
  burnUp: 'Burn-up',
};

export const SLICE_LABELS: Readonly<Record<InsightSlice, string>> = {
  assignee: 'Assignee',
  priority: 'Priority',
  stateCategory: 'Status type',
  team: 'Team',
  project: 'Project',
  label: 'Label',
};

export interface InsightBucket {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly count: number;
  readonly filter: FilterClause | null;
}

export interface InsightScatterPoint {
  readonly issueId: UUID;
  readonly bucketKey: string;
  readonly days: number;
}

export interface InsightBurnPoint {
  readonly month: string;
  readonly completed: number;
}

export interface InsightData {
  readonly measure: InsightMeasure;
  readonly slice: InsightSlice;
  readonly chart: 'bar' | 'scatter' | 'area';
  readonly unit: string;
  readonly buckets: readonly InsightBucket[];
  readonly scatter: readonly InsightScatterPoint[];
  readonly burn: readonly InsightBurnPoint[];
  readonly total: number;
}

const NONE = '__none__';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildInsights(
  store: Store,
  issueIds: readonly UUID[],
  measure: InsightMeasure,
  slice: InsightSlice,
  now = Date.now(),
): InsightData {
  const issues = issueIds
    .map((id) => store.issues.get(id))
    .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);

  if (measure === 'burnUp') {
    return burnUp(store, issues);
  }

  const chart: InsightData['chart'] =
    measure === 'count' || measure === 'effort' ? 'bar' : 'scatter';

  const rows = eligible(store, issues, measure);
  const grouped = new Map<
    string,
    { issues: Issue[]; label: string; filter: FilterClause | null }
  >();

  const place = (issue: Issue, key: string, label: string, filter: FilterClause | null) => {
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, { issues: [issue], label, filter });
    else bucket.issues.push(issue);
  };

  for (const issue of rows) {
    for (const dim of dimensions(store, issue, slice)) {
      place(issue, dim.key, dim.label, dim.filter);
    }
  }

  const buckets: InsightBucket[] = [];
  const scatter: InsightScatterPoint[] = [];

  for (const [key, bucket] of grouped) {
    const value = measureValue(store, bucket.issues, measure, now);
    buckets.push({
      key,
      label: bucket.label,
      value,
      count: bucket.issues.length,
      filter: bucket.filter,
    });
    if (chart === 'scatter') {
      for (const issue of bucket.issues) {
        const days = durationDays(issue, measure, now);
        if (days === undefined) continue;
        scatter.push({ issueId: issue.id, bucketKey: key, days });
      }
    }
  }

  buckets.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const total =
    measure === 'count'
      ? rows.length
      : measure === 'effort'
        ? rows.reduce((sum, issue) => sum + effortOf(issue, store.teams.get(issue.teamId)), 0)
        : average(scatter.map((point) => point.days));

  return {
    measure,
    slice,
    chart,
    unit: unitOf(measure),
    buckets,
    scatter,
    burn: [],
    total,
  };
}

function burnUp(store: Store, issues: readonly Issue[]): InsightData {
  const months = new Map<string, number>();
  for (const issue of issues) {
    if (issue.completedAt === undefined) continue;
    const month = issue.completedAt.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + effortOf(issue, store.teams.get(issue.teamId)));
  }
  const keys = [...months.keys()].sort();
  const burn: InsightBurnPoint[] = [];
  let cumulative = 0;
  for (const month of keys) {
    cumulative += months.get(month) ?? 0;
    burn.push({ month, completed: cumulative });
  }
  return {
    measure: 'burnUp',
    slice: 'assignee',
    chart: 'area',
    unit: 'completed',
    buckets: [],
    scatter: [],
    burn,
    total: cumulative,
  };
}

function eligible(store: Store, issues: readonly Issue[], measure: InsightMeasure): Issue[] {
  if (measure === 'cycleTime') {
    return issues.filter(
      (issue) => issue.completedAt !== undefined && startedAtOf(store, issue) !== undefined,
    );
  }
  if (measure === 'leadTime') {
    return issues.filter((issue) => issue.completedAt !== undefined);
  }
  return [...issues];
}

function startedAtOf(store: Store, issue: Issue): string | undefined {
  if (issue.startedAt !== undefined) return issue.startedAt;
  if (issue.completedAt !== undefined) return issue.completedAt;
  const state = store.workflowStates.get(issue.stateId);
  if (state?.category === 'started') return issue.updatedAt;
  return undefined;
}

function measureValue(
  store: Store,
  issues: readonly Issue[],
  measure: InsightMeasure,
  now: number,
): number {
  if (measure === 'count') return issues.length;
  if (measure === 'effort') {
    return issues.reduce((sum, issue) => sum + effortOf(issue, store.teams.get(issue.teamId)), 0);
  }
  const days = issues
    .map((issue) => durationDays(issue, measure, now))
    .filter((value): value is number => value !== undefined);
  return average(days);
}

function durationDays(issue: Issue, measure: InsightMeasure, now: number): number | undefined {
  if (measure === 'cycleTime') {
    if (issue.completedAt === undefined || issue.startedAt === undefined) return undefined;
    return daysBetween(issue.startedAt, issue.completedAt);
  }
  if (measure === 'leadTime') {
    if (issue.completedAt === undefined) return undefined;
    return daysBetween(issue.createdAt, issue.completedAt);
  }
  if (measure === 'issueAge') {
    return daysBetween(issue.createdAt, new Date(now).toISOString());
  }
  return undefined;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (!(ms >= 0)) return 0;
  return Math.round((ms / MS_PER_DAY) * 10) / 10;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function unitOf(measure: InsightMeasure): string {
  if (measure === 'count') return 'issues';
  if (measure === 'effort') return 'points';
  if (measure === 'burnUp') return 'completed';
  return 'days';
}

interface Dimension {
  readonly key: string;
  readonly label: string;
  readonly filter: FilterClause | null;
}

function dimensions(store: Store, issue: Issue, slice: InsightSlice): readonly Dimension[] {
  if (slice === 'assignee') {
    if (issue.assigneeId === undefined) {
      return [{ key: NONE, label: 'Unassigned', filter: { field: 'assignee', op: 'isNull' } }];
    }
    const user = store.users.get(issue.assigneeId);
    return [
      {
        key: issue.assigneeId,
        label: user?.displayName ?? 'Someone',
        filter: { field: 'assignee', op: 'eq', values: [issue.assigneeId] },
      },
    ];
  }
  if (slice === 'priority') {
    return [
      {
        key: String(issue.priority),
        label: priorityLabel(issue.priority),
        filter: { field: 'priority', op: 'eq', values: [String(issue.priority)] },
      },
    ];
  }
  if (slice === 'stateCategory') {
    const category = store.workflowStates.get(issue.stateId)?.category ?? 'unstarted';
    return [
      {
        key: category,
        label: STATE_LABELS[category as StateCategory] ?? category,
        filter: { field: 'stateCategory', op: 'eq', values: [category] },
      },
    ];
  }
  if (slice === 'team') {
    const team = store.teams.get(issue.teamId);
    return [
      {
        key: issue.teamId,
        label: team?.name ?? team?.key ?? 'Team',
        filter: { field: 'team', op: 'eq', values: [issue.teamId] },
      },
    ];
  }
  if (slice === 'project') {
    if (issue.projectId === undefined) {
      return [{ key: NONE, label: 'No project', filter: null }];
    }
    const project = store.projects.get(issue.projectId);
    return [
      {
        key: issue.projectId,
        label: project?.name ?? 'Project',
        filter: null,
      },
    ];
  }
  const labelIds = [...store.labelIdsFor(issue.id)];
  if (labelIds.length === 0) {
    return [{ key: NONE, label: 'No label', filter: null }];
  }
  return labelIds.map((labelId) => {
    const label = store.labels.get(labelId);
    return {
      key: labelId,
      label: label?.name ?? 'Label',
      filter: { field: 'label', op: 'eq', values: [labelId] } satisfies FilterClause,
    };
  });
}

export function andFilterClause(current: FilterNode, clause: FilterClause): FilterNode {
  if (isFilterGroup(current) && (current.conj === undefined || current.conj === 'and')) {
    return { conj: 'and', nodes: [...(current.nodes ?? []), clause] };
  }
  return { conj: 'and', nodes: [current, clause] };
}
