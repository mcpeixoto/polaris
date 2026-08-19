/**
 * Display options for the projects list — layout and timeline zoom live in the URL.
 *
 * Kept separate from issue `DisplayOptions` because timeline is projects-only and issue
 * layouts must not gain a third value that every issue view would have to ignore.
 */

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
