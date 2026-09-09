/**
 * Display options for the projects list — how the list draws itself, in the URL.
 *
 * Kept separate from issue `DisplayOptions` because timeline is projects-only and issue
 * layouts must not gain a third value that every issue view would have to ignore. The
 * options themselves are deliberately the issue view's, name for name: grouping, ordering,
 * a direction and a set of columns. Somebody who has learned the display menu on the issue
 * list has learned this one, and a product with two vocabularies for the same decision
 * teaches neither.
 *
 * The default is one flat run of rows in the manual order people drag them into. It used to
 * be priority bands, which is what the screen did before there was a control for it — but a
 * band per priority puts a heading over every project list in the product, most of them
 * reading "No priority", and the first thing a reader wants from a project list is the
 * projects. Grouping is one choice away in Display, and it rides in the URL, so the bands
 * are still a link somebody can share.
 */

import type { ProjectStatusCategory, Store, UUID } from '~/store';

import type { ProjectCustomerFilter } from './customerFilter';
import type { ProjectDependencyFilter } from './dependencyHelpers';
import { PROJECT_STATUS_CATEGORIES } from './statusCategories';

export type ProjectLayout = 'list' | 'board' | 'timeline';

export type ProjectTimelineZoom = 'week' | 'month' | 'quarter' | 'year';

/** What a heading on the list stands for. `none` is one flat run of rows. */
export type ProjectGrouping = 'none' | 'status' | 'lead' | 'team' | 'priority';

/**
 * What decides the order inside a group.
 *
 * `manual` is the arrangement people drag rows into, and it is the only one a drop can
 * write — see `orderingNote`, which says so on the screen rather than silently ignoring a
 * drag under an ordering that cannot keep it.
 */
export type ProjectOrdering = 'manual' | 'name' | 'targetDate' | 'priority' | 'updated';

export type ProjectDirection = 'asc' | 'desc';

/** A column of the table, other than the name — which is the row and is never optional. */
export type ProjectColumn = 'health' | 'priority' | 'lead' | 'targetDate' | 'issues' | 'status';

/** The order columns are drawn in, whichever subset is on. Also the menu's order. */
export const PROJECT_COLUMN_ORDER: readonly ProjectColumn[] = [
  'health',
  'priority',
  'lead',
  'targetDate',
  'issues',
  'status',
];

export interface ProjectDisplayOptions {
  readonly layout?: ProjectLayout;
  readonly grouping?: ProjectGrouping;
  readonly ordering?: ProjectOrdering;
  readonly direction?: ProjectDirection;
  readonly columns?: readonly ProjectColumn[];
  readonly zoom?: ProjectTimelineZoom;
  readonly showDependencies?: boolean;
  readonly showMilestones?: boolean;
}

export const DEFAULT_PROJECT_DISPLAY: Required<ProjectDisplayOptions> = {
  layout: 'list',
  grouping: 'none',
  ordering: 'manual',
  direction: 'asc',
  columns: PROJECT_COLUMN_ORDER,
  zoom: 'month',
  showDependencies: true,
  showMilestones: true,
};

export const PROJECT_DISPLAY_PARAMS = {
  layout: 'layout',
  grouping: 'group',
  ordering: 'order',
  direction: 'dir',
  columns: 'cols',
  zoom: 'zoom',
  showDependencies: 'deps',
  showMilestones: 'milestones',
} as const;

const GROUPINGS: readonly ProjectGrouping[] = ['none', 'status', 'lead', 'team', 'priority'];
const ORDERINGS: readonly ProjectOrdering[] = [
  'manual',
  'name',
  'targetDate',
  'priority',
  'updated',
];

/** Whether two column sets are the same choice, order included — see `toProjectDisplayParams`. */
export function sameProjectColumns(
  a: readonly ProjectColumn[],
  b: readonly ProjectColumn[],
): boolean {
  return a.length === b.length && a.every((value, index) => b[index] === value);
}

/**
 * Why an ordering has nothing to say under a grouping, or null when it has.
 *
 * The issue display menu's rule, applied to the same two cases here. Nothing is refused —
 * somebody may well be about to change the grouping next — but the sort the list performs is
 * not the one the control's label implies, and that is the sort of gap a person blames the
 * software for.
 */
export function projectOrderingNote(
  ordering: ProjectOrdering,
  grouping: ProjectGrouping,
): string | null {
  if (ordering === 'manual' && grouping !== 'none' && grouping !== 'priority') {
    return 'Manual order is the one arrangement people drag rows into inside a priority band. Grouped another way it is sliced rather than followed, and a drop here cannot write it.';
  }
  if (ordering === 'priority' && grouping === 'priority') {
    return 'Every project in a band already has the same priority, so this ordering has nothing left to decide and the rows fall back to manual order.';
  }
  return null;
}

export function toProjectDisplayParams(display: ProjectDisplayOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (display.layout !== undefined && display.layout !== DEFAULT_PROJECT_DISPLAY.layout) {
    params[PROJECT_DISPLAY_PARAMS.layout] = display.layout;
  }
  if (display.grouping !== undefined && display.grouping !== DEFAULT_PROJECT_DISPLAY.grouping) {
    params[PROJECT_DISPLAY_PARAMS.grouping] = display.grouping;
  }
  if (display.ordering !== undefined && display.ordering !== DEFAULT_PROJECT_DISPLAY.ordering) {
    params[PROJECT_DISPLAY_PARAMS.ordering] = display.ordering;
  }
  if (display.direction !== undefined && display.direction !== DEFAULT_PROJECT_DISPLAY.direction) {
    params[PROJECT_DISPLAY_PARAMS.direction] = display.direction;
  }
  // The empty set is a choice somebody made — a name-only table — and it has to survive a
  // reload, so it rides as an empty string rather than as an absent parameter.
  if (
    display.columns !== undefined &&
    !sameProjectColumns(display.columns, DEFAULT_PROJECT_DISPLAY.columns)
  ) {
    params[PROJECT_DISPLAY_PARAMS.columns] = display.columns.join(',');
  }
  if (display.zoom !== undefined && display.zoom !== DEFAULT_PROJECT_DISPLAY.zoom) {
    params[PROJECT_DISPLAY_PARAMS.zoom] = display.zoom;
  }
  if (
    display.showDependencies !== undefined &&
    display.showDependencies !== DEFAULT_PROJECT_DISPLAY.showDependencies
  ) {
    params[PROJECT_DISPLAY_PARAMS.showDependencies] = display.showDependencies ? '1' : '0';
  }
  if (
    display.showMilestones !== undefined &&
    display.showMilestones !== DEFAULT_PROJECT_DISPLAY.showMilestones
  ) {
    params[PROJECT_DISPLAY_PARAMS.showMilestones] = display.showMilestones ? '1' : '0';
  }
  return params;
}

export function parseProjectDisplayParams(params: URLSearchParams): ProjectDisplayOptions {
  const out: {
    layout?: ProjectLayout;
    grouping?: ProjectGrouping;
    ordering?: ProjectOrdering;
    direction?: ProjectDirection;
    columns?: readonly ProjectColumn[];
    zoom?: ProjectTimelineZoom;
    showDependencies?: boolean;
    showMilestones?: boolean;
  } = {};

  const layout = params.get(PROJECT_DISPLAY_PARAMS.layout);
  if (layout === 'list' || layout === 'board' || layout === 'timeline') out.layout = layout;

  const grouping = params.get(PROJECT_DISPLAY_PARAMS.grouping);
  const knownGrouping = GROUPINGS.find((candidate) => candidate === grouping);
  if (knownGrouping !== undefined) out.grouping = knownGrouping;

  const ordering = params.get(PROJECT_DISPLAY_PARAMS.ordering);
  const knownOrdering = ORDERINGS.find((candidate) => candidate === ordering);
  if (knownOrdering !== undefined) out.ordering = knownOrdering;

  const direction = params.get(PROJECT_DISPLAY_PARAMS.direction);
  if (direction === 'asc' || direction === 'desc') out.direction = direction;

  // Read against the canonical order rather than as written, so a hand-edited link cannot
  // pin a column order nobody can produce from the menu — and unknown names are dropped
  // rather than taking the whole parameter down with them.
  const columns = params.get(PROJECT_DISPLAY_PARAMS.columns);
  if (columns !== null) {
    const asked = new Set(columns.split(',').filter((value) => value !== ''));
    out.columns = PROJECT_COLUMN_ORDER.filter((column) => asked.has(column));
  }

  const zoom = params.get(PROJECT_DISPLAY_PARAMS.zoom);
  if (zoom === 'week' || zoom === 'month' || zoom === 'quarter' || zoom === 'year') {
    out.zoom = zoom;
  }

  const deps = params.get(PROJECT_DISPLAY_PARAMS.showDependencies);
  if (deps === '1' || deps === '0') out.showDependencies = deps === '1';

  const milestones = params.get(PROJECT_DISPLAY_PARAMS.showMilestones);
  if (milestones === '1' || milestones === '0') out.showMilestones = milestones === '1';

  return out;
}

export function resolveProjectDisplay(params: URLSearchParams): Required<ProjectDisplayOptions> {
  const parsed = parseProjectDisplayParams(params);
  return {
    layout: parsed.layout ?? DEFAULT_PROJECT_DISPLAY.layout,
    grouping: parsed.grouping ?? DEFAULT_PROJECT_DISPLAY.grouping,
    ordering: parsed.ordering ?? DEFAULT_PROJECT_DISPLAY.ordering,
    direction: parsed.direction ?? DEFAULT_PROJECT_DISPLAY.direction,
    columns: parsed.columns ?? DEFAULT_PROJECT_DISPLAY.columns,
    zoom: parsed.zoom ?? DEFAULT_PROJECT_DISPLAY.zoom,
    showDependencies: parsed.showDependencies ?? DEFAULT_PROJECT_DISPLAY.showDependencies,
    showMilestones: parsed.showMilestones ?? DEFAULT_PROJECT_DISPLAY.showMilestones,
  };
}

export function changedProjectDisplayCount(display: Required<ProjectDisplayOptions>): number {
  let count = 0;
  if (display.layout !== DEFAULT_PROJECT_DISPLAY.layout) count++;
  if (display.grouping !== DEFAULT_PROJECT_DISPLAY.grouping) count++;
  if (display.ordering !== DEFAULT_PROJECT_DISPLAY.ordering) count++;
  if (display.direction !== DEFAULT_PROJECT_DISPLAY.direction) count++;
  if (!sameProjectColumns(display.columns, DEFAULT_PROJECT_DISPLAY.columns)) count++;
  if (display.zoom !== DEFAULT_PROJECT_DISPLAY.zoom) count++;
  if (display.showDependencies !== DEFAULT_PROJECT_DISPLAY.showDependencies) count++;
  if (display.showMilestones !== DEFAULT_PROJECT_DISPLAY.showMilestones) count++;
  return count;
}

export const ZOOM_PX_PER_DAY: Readonly<Record<ProjectTimelineZoom, number>> = {
  week: 28,
  month: 10,
  quarter: 4,
  year: 1.5,
};

/**
 * The list's toolbar filters.
 *
 * Not display options — they change which projects are on screen, not how they are drawn —
 * but they share the query string for the same reason display does: a reload, a back button
 * or a pasted link has to show what the sender was looking at. Held as local state, the
 * layout survived a reload and the filters silently did not, so a shared "violated
 * dependencies" link opened on everything.
 */
export type ProjectStatusFilter = 'all' | ProjectStatusCategory;

export interface ProjectFilterOptions {
  readonly dependency: ProjectDependencyFilter;
  readonly customer: ProjectCustomerFilter;
  readonly status: ProjectStatusFilter;
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilterOptions = {
  dependency: 'all',
  customer: 'all',
  status: 'all',
};

export const PROJECT_FILTER_PARAMS = {
  dependency: 'dependency',
  customer: 'customer',
  status: 'status',
} as const;

const DEPENDENCY_FILTERS: readonly ProjectDependencyFilter[] = [
  'all',
  'has-dependencies',
  'blocking',
  'blocked-by',
  'violated',
];

export function resolveProjectFilters(params: URLSearchParams): ProjectFilterOptions {
  const dependency = params.get(PROJECT_FILTER_PARAMS.dependency);
  const customer = params.get(PROJECT_FILTER_PARAMS.customer);
  const status = params.get(PROJECT_FILTER_PARAMS.status);

  return {
    dependency: DEPENDENCY_FILTERS.includes(dependency as ProjectDependencyFilter)
      ? (dependency as ProjectDependencyFilter)
      : 'all',
    // `customer:<id>` and `tier:<name>` are open sets, so anything shaped like one is taken
    // at face value: a filter naming a customer that no longer exists matches nothing,
    // which is the honest answer rather than a silent reset to everything.
    customer:
      customer === null || customer === ''
        ? 'all'
        : customer === 'any' ||
            customer === 'none' ||
            customer.startsWith('customer:') ||
            customer.startsWith('tier:')
          ? (customer as ProjectCustomerFilter)
          : 'all',
    status: PROJECT_STATUS_CATEGORIES.includes(status as ProjectStatusCategory)
      ? (status as ProjectStatusCategory)
      : 'all',
  };
}

export function toProjectFilterParams(filters: ProjectFilterOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.dependency !== 'all') params[PROJECT_FILTER_PARAMS.dependency] = filters.dependency;
  if (filters.customer !== 'all') params[PROJECT_FILTER_PARAMS.customer] = filters.customer;
  if (filters.status !== 'all') params[PROJECT_FILTER_PARAMS.status] = filters.status;
  return params;
}

/** How many of the three are narrowing the list — what the toolbar counts. */
export function activeProjectFilterCount(filters: ProjectFilterOptions): number {
  return Object.keys(toProjectFilterParams(filters)).length;
}

export function matchesProjectStatusFilter(
  store: Pick<Store, 'projects' | 'projectStatuses'>,
  projectId: UUID,
  filter: ProjectStatusFilter,
): boolean {
  if (filter === 'all') return true;
  const project = store.projects.get(projectId);
  if (project === undefined) return false;
  return store.projectStatuses.get(project.statusId)?.category === filter;
}
