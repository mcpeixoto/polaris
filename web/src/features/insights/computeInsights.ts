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
import type { Customer, Issue, StateCategory, Store, UUID } from '~/store';

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
  'cycle',
  'template',
  'customer',
  'customerTier',
  'customerRevenue',
] as const;

/** Slices that read customer-request data. Guests never see these. */
export const CUSTOMER_INSIGHT_SLICES: readonly InsightSlice[] = [
  'customer',
  'customerTier',
  'customerRevenue',
];

export type InsightSlice = (typeof INSIGHT_SLICES)[number];

export type BurnPeriod = 'week' | 'month';

export interface InsightOptions {
  readonly includeArchived?: boolean;
  readonly burnPeriod?: BurnPeriod;
}

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
  cycle: 'Cycle',
  template: 'Template',
  customer: 'Customer',
  customerTier: 'Customer tier',
  customerRevenue: 'Customer revenue',
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
  readonly period: string;
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
  readonly percentiles: readonly number[];
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
  options: InsightOptions = {},
): InsightData {
  const includeArchived = options.includeArchived === true;
  const issues = issueIds
    .map((id) => store.issues.get(id))
    .filter(
      (issue): issue is Issue =>
        issue !== undefined && (includeArchived || issue.archivedAt === undefined),
    );

  if (measure === 'burnUp') {
    return burnUp(store, issues, options.burnPeriod ?? 'month');
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
    percentiles: scatterPercentiles(scatter.map((point) => point.days)),
    total,
  };
}

function burnUp(store: Store, issues: readonly Issue[], period: BurnPeriod): InsightData {
  const buckets = new Map<string, number>();
  for (const issue of issues) {
    if (issue.completedAt === undefined) continue;
    const key = periodKey(issue.completedAt, period);
    buckets.set(key, (buckets.get(key) ?? 0) + effortOf(issue, store.teams.get(issue.teamId)));
  }
  const keys = [...buckets.keys()].sort();
  const burn: InsightBurnPoint[] = [];
  let cumulative = 0;
  for (const key of keys) {
    cumulative += buckets.get(key) ?? 0;
    burn.push({ period: key, completed: cumulative });
  }
  return {
    measure: 'burnUp',
    slice: 'assignee',
    chart: 'area',
    unit: 'completed',
    buckets: [],
    scatter: [],
    burn,
    percentiles: [],
    total: cumulative,
  };
}

function periodKey(iso: string, period: BurnPeriod): string {
  if (period === 'month') return iso.slice(0, 7);
  const ms = Date.parse(iso);
  const day = new Date(ms).getUTCDay();
  const mondayOffset = (day + 6) % 7;
  return new Date(ms - mondayOffset * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Nearest-rank percentiles at 25 / 50 / 75 / 95 over scatter y-values. */
export function scatterPercentiles(days: readonly number[]): readonly number[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a - b);
  return [0.25, 0.5, 0.75, 0.95].map((p) => {
    const at = (sorted.length - 1) * p;
    const lo = Math.floor(at);
    const hi = Math.ceil(at);
    const value = lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
    return Math.round(value * 10) / 10;
  });
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
  if (slice === 'cycle') {
    if (issue.cycleId === undefined) {
      return [{ key: NONE, label: 'No cycle', filter: null }];
    }
    const cycle = store.cycles.get(issue.cycleId);
    return [
      {
        key: issue.cycleId,
        label: cycle?.name ?? 'Cycle',
        filter: null,
      },
    ];
  }
  if (slice === 'template') {
    if (issue.templateId === undefined) {
      return [{ key: NONE, label: 'No template', filter: { field: 'template', op: 'isNull' } }];
    }
    const template = store.issueTemplates.get(issue.templateId);
    return [
      {
        key: issue.templateId,
        label: template?.name ?? 'Template',
        filter: { field: 'template', op: 'eq', values: [issue.templateId] },
      },
    ];
  }
  if (slice === 'customer') {
    const customers = attributedCustomers(store, issue.id);
    if (customers.length === 0) {
      return [
        {
          key: NONE,
          label: 'No customer',
          filter: { field: 'customerCount', op: 'eq', values: ['0'] },
        },
      ];
    }
    return customers.map((customer) => ({
      key: customer.id,
      label: customer.name,
      filter: { field: 'customer', op: 'eq', values: [customer.id] } satisfies FilterClause,
    }));
  }
  if (slice === 'customerTier') {
    const tiers = uniqueStrings(
      attributedCustomers(store, issue.id)
        .map((customer) => customer.tier)
        .filter((tier): tier is string => tier !== undefined && tier !== ''),
    );
    if (tiers.length === 0) {
      return [{ key: NONE, label: 'No tier', filter: { field: 'customerTier', op: 'isNull' } }];
    }
    return tiers.map((tier) => ({
      key: tier,
      label: tier,
      filter: { field: 'customerTier', op: 'eq', values: [tier] } satisfies FilterClause,
    }));
  }
  if (slice === 'customerRevenue') {
    const revenues = uniqueNumbers(
      attributedCustomers(store, issue.id)
        .map((customer) => customer.revenue)
        .filter((revenue): revenue is number => revenue !== undefined),
    );
    if (revenues.length === 0) {
      return [
        { key: NONE, label: 'No revenue', filter: { field: 'customerRevenue', op: 'isNull' } },
      ];
    }
    return revenues.map((revenue) => ({
      key: String(revenue),
      label: revenue.toLocaleString('en-US'),
      filter: {
        field: 'customerRevenue',
        op: 'eq',
        values: [String(revenue)],
      } satisfies FilterClause,
    }));
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

function attributedCustomers(store: Store, issueId: UUID): readonly Customer[] {
  const seen = new Set<UUID>();
  const out: Customer[] = [];
  for (const requestId of store.customerRequestIdsForIssue(issueId)) {
    const request = store.customerRequests.get(requestId);
    const customerId = request?.customerId;
    if (customerId === undefined || seen.has(customerId)) continue;
    const customer = store.customers.get(customerId);
    if (customer === undefined || customer.deletedAt !== undefined) continue;
    seen.add(customerId);
    out.push(customer);
  }
  return out;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function andFilterClause(current: FilterNode, clause: FilterClause): FilterNode {
  if (isFilterGroup(current) && (current.conj === undefined || current.conj === 'and')) {
    return { conj: 'and', nodes: [...(current.nodes ?? []), clause] };
  }
  return { conj: 'and', nodes: [current, clause] };
}
