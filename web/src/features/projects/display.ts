/**
 * Display options for the projects list — layout and timeline zoom live in the URL.
 *
 * Kept separate from issue `DisplayOptions` because timeline is projects-only and issue
 * layouts must not gain a third value that every issue view would have to ignore.
 */

import type { ProjectStatusCategory, Store, UUID } from '~/store';

import type { ProjectCustomerFilter } from './customerFilter';
import type { ProjectDependencyFilter } from './dependencyHelpers';
import { PROJECT_STATUS_CATEGORIES } from './statusCategories';

export type ProjectLayout = 'list' | 'timeline';

export type ProjectTimelineZoom = 'week' | 'month' | 'quarter' | 'year';

export interface ProjectDisplayOptions {
  readonly layout?: ProjectLayout;
  readonly zoom?: ProjectTimelineZoom;
  readonly showDependencies?: boolean;
  readonly showMilestones?: boolean;
}

export const DEFAULT_PROJECT_DISPLAY: Required<ProjectDisplayOptions> = {
  layout: 'list',
  zoom: 'month',
  showDependencies: true,
  showMilestones: true,
};

export const PROJECT_DISPLAY_PARAMS = {
  layout: 'layout',
  zoom: 'zoom',
  showDependencies: 'deps',
  showMilestones: 'milestones',
} as const;

export function toProjectDisplayParams(display: ProjectDisplayOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (display.layout !== undefined && display.layout !== DEFAULT_PROJECT_DISPLAY.layout) {
    params[PROJECT_DISPLAY_PARAMS.layout] = display.layout;
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
    zoom?: ProjectTimelineZoom;
    showDependencies?: boolean;
    showMilestones?: boolean;
  } = {};

  const layout = params.get(PROJECT_DISPLAY_PARAMS.layout);
  if (layout === 'list' || layout === 'timeline') out.layout = layout;

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
    zoom: parsed.zoom ?? DEFAULT_PROJECT_DISPLAY.zoom,
    showDependencies: parsed.showDependencies ?? DEFAULT_PROJECT_DISPLAY.showDependencies,
    showMilestones: parsed.showMilestones ?? DEFAULT_PROJECT_DISPLAY.showMilestones,
  };
}

export function changedProjectDisplayCount(display: Required<ProjectDisplayOptions>): number {
  let count = 0;
  if (display.layout !== DEFAULT_PROJECT_DISPLAY.layout) count++;
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
