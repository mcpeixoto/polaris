/**
 * Display options for the initiatives list — how the tree is grouped, ordered and drawn.
 *
 * Modelled on `features/projects/display.ts` and kept beside it rather than folded into the
 * issue `DisplayOptions`: an initiative has no state, no assignee and no cycle, and a union
 * shared with the issue views would offer this screen seven groupings it has to ignore.
 *
 * In the query string for the reason the status filter already is: a display somebody set is
 * what a reload, a back button and a pasted link have to show. Folded rows are the one thing
 * that stays out of it — see `features/view/collapse`, which argues that at length.
 *
 * Grouping is the option with a consequence beyond drawing. The list is a tree, and a tree
 * has exactly one arrangement; asked to group by owner it becomes a flat list under headings,
 * the same way the status filter already flattens it. That is stated here, next to the values,
 * because it is the fact somebody reading the menu will not guess.
 */

export type InitiativeGroupBy = 'none' | 'status' | 'owner';

export type InitiativeOrderBy = 'manual' | 'name' | 'targetDate' | 'progress' | 'updated';

/** The cells a row may drop. Name and status are the row's identity and cannot be turned off. */
export type InitiativeColumn = 'labels' | 'health' | 'targetDate' | 'progress';

export const INITIATIVE_COLUMNS: readonly InitiativeColumn[] = [
  'progress',
  'labels',
  'health',
  'targetDate',
];

export interface InitiativeDisplayOptions {
  readonly grouping?: InitiativeGroupBy;
  readonly ordering?: InitiativeOrderBy;
  readonly columns?: readonly InitiativeColumn[];
}

export type RequiredInitiativeDisplay = Required<InitiativeDisplayOptions>;

export const DEFAULT_INITIATIVE_DISPLAY: RequiredInitiativeDisplay = {
  grouping: 'none',
  ordering: 'manual',
  columns: INITIATIVE_COLUMNS,
};

export const INITIATIVE_DISPLAY_PARAMS = {
  grouping: 'group',
  ordering: 'order',
  columns: 'columns',
} as const;

const GROUPINGS: readonly InitiativeGroupBy[] = ['none', 'status', 'owner'];
const ORDERINGS: readonly InitiativeOrderBy[] = [
  'manual',
  'name',
  'targetDate',
  'progress',
  'updated',
];

/** The product's word for each value, total over the union so a new value cannot go unnamed. */
export const INITIATIVE_GROUP_LABELS: Readonly<Record<InitiativeGroupBy, string>> = {
  none: 'No grouping',
  status: 'Status',
  owner: 'Owner',
};

export const INITIATIVE_ORDER_LABELS: Readonly<Record<InitiativeOrderBy, string>> = {
  manual: 'Manual',
  name: 'Name',
  targetDate: 'Target date',
  progress: 'Progress',
  updated: 'Updated',
};

export const INITIATIVE_COLUMN_LABELS: Readonly<Record<InitiativeColumn, string>> = {
  labels: 'Labels',
  health: 'Health',
  targetDate: 'Target date',
  progress: 'Progress',
};

function sameColumns(a: readonly InitiativeColumn[], b: readonly InitiativeColumn[]): boolean {
  return a.length === b.length && INITIATIVE_COLUMNS.every((c) => a.includes(c) === b.includes(c));
}

export function toInitiativeDisplayParams(
  display: InitiativeDisplayOptions,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (display.grouping !== undefined && display.grouping !== DEFAULT_INITIATIVE_DISPLAY.grouping) {
    params[INITIATIVE_DISPLAY_PARAMS.grouping] = display.grouping;
  }
  if (display.ordering !== undefined && display.ordering !== DEFAULT_INITIATIVE_DISPLAY.ordering) {
    params[INITIATIVE_DISPLAY_PARAMS.ordering] = display.ordering;
  }
  if (
    display.columns !== undefined &&
    !sameColumns(display.columns, DEFAULT_INITIATIVE_DISPLAY.columns)
  ) {
    // The columns that are on, in the order they are drawn, so the parameter reads as the
    // row does. Empty is a real value — every optional cell off — and is spelled `none`
    // rather than an empty parameter, which a URL cleaner would drop back to the default.
    params[INITIATIVE_DISPLAY_PARAMS.columns] =
      display.columns.length === 0
        ? 'none'
        : INITIATIVE_COLUMNS.filter((column) => display.columns?.includes(column)).join(',');
  }
  return params;
}

export function parseInitiativeDisplayParams(params: URLSearchParams): InitiativeDisplayOptions {
  const out: {
    grouping?: InitiativeGroupBy;
    ordering?: InitiativeOrderBy;
    columns?: readonly InitiativeColumn[];
  } = {};

  const grouping = params.get(INITIATIVE_DISPLAY_PARAMS.grouping);
  if (GROUPINGS.includes(grouping as InitiativeGroupBy))
    out.grouping = grouping as InitiativeGroupBy;

  const ordering = params.get(INITIATIVE_DISPLAY_PARAMS.ordering);
  if (ORDERINGS.includes(ordering as InitiativeOrderBy))
    out.ordering = ordering as InitiativeOrderBy;

  const columns = params.get(INITIATIVE_DISPLAY_PARAMS.columns);
  if (columns === 'none') out.columns = [];
  else if (columns !== null && columns !== '') {
    const named = columns.split(',');
    out.columns = INITIATIVE_COLUMNS.filter((column) => named.includes(column));
  }

  return out;
}

export function resolveInitiativeDisplay(params: URLSearchParams): RequiredInitiativeDisplay {
  const parsed = parseInitiativeDisplayParams(params);
  return {
    grouping: parsed.grouping ?? DEFAULT_INITIATIVE_DISPLAY.grouping,
    ordering: parsed.ordering ?? DEFAULT_INITIATIVE_DISPLAY.ordering,
    columns: parsed.columns ?? DEFAULT_INITIATIVE_DISPLAY.columns,
  };
}

/** How many options differ from the defaults — the number the Display button carries. */
export function changedInitiativeDisplayCount(display: RequiredInitiativeDisplay): number {
  return Object.keys(toInitiativeDisplayParams(display)).length;
}

/**
 * Whether the list can still be drawn as a tree.
 *
 * A grouping puts a row under a heading its parent may not share, and a filter can remove
 * the parent entirely; in both cases an indent points at nothing. The list flattens, and
 * this is the one place that decides it so the rows, the chevrons and the cursor agree.
 */
export function isFlatList(grouping: InitiativeGroupBy, filtered: boolean): boolean {
  return filtered || grouping !== 'none';
}
