/**
 * How a project status category is spelled, ordered and drawn.
 *
 * Its own module rather than a second export beside a component: a `.tsx` file that
 * exports both a component and a constant loses React Fast Refresh, and the picker and the
 * sidebar both need this table.
 */

import type { ProjectStatusCategory, StateCategory } from '~/store';

/** Backlog to Canceled, the order the settings screen and every picker list them in. */
export const PROJECT_STATUS_CATEGORIES: readonly ProjectStatusCategory[] = [
  'backlog',
  'planned',
  'started',
  'completed',
  'canceled',
];

export const PROJECT_STATUS_CATEGORY_LABELS: Readonly<Record<ProjectStatusCategory, string>> = {
  backlog: 'Backlog',
  planned: 'Planned',
  started: 'Started',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Project "planned" is issue "unstarted": work that exists and has not begun. */
export const PROJECT_STATUS_ICON: Readonly<Record<ProjectStatusCategory, StateCategory>> = {
  backlog: 'backlog',
  planned: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
};
