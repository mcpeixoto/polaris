import { fold, type IssueIndex, type LabelIndex } from './indexes';
import {
  CATEGORY_ORDER,
  priorityRank,
  type Issue,
  type Team,
  type User,
  type UUID,
  type WorkflowState,
} from './types';

/**
 * The read API every list, board and picker goes through.
 *
 * Synchronous, and deliberately so: a filter that returns a promise cannot run inside a
 * keystroke's frame, and the moment one exists every view above it grows a loading state
 * for data that is already in memory. Everything here is a set operation over the
 * indexes in `indexes.ts` — the corpus is never walked to *find* the answer, only to
 * order and group one that has already been narrowed.
 *
 * Everything returns ids. Views resolve entities themselves, so a re-query that produces
 * the same ids is a no-op for React rather than a new array of new objects, which is
 * what lets `Store.subscribe` decide "nothing this view cares about changed" by
 * comparing two arrays of strings.
 */

/** What a query reads. `Store` satisfies it; tests can supply a literal. */
export interface IssueSource {
  readonly index: IssueIndex;
  readonly labelIndex: LabelIndex;
  readonly issues: ReadonlyMap<UUID, Issue>;
  readonly teams: ReadonlyMap<UUID, Team>;
  readonly users: ReadonlyMap<UUID, User>;
  readonly workflowStates: ReadonlyMap<UUID, WorkflowState>;
}

/**
 * A filter. Every dimension is a set of accepted values, ANDed across dimensions and
 * ORed within one — "in team A or B, and urgent or high".
 *
 * An empty or absent array means "no constraint", not "match nothing". A user who has
 * just cleared the last chip off a filter expects to see their issues again, not an
 * empty list.
 */
export interface IssueFilter {
  readonly teamIds?: readonly UUID[] | undefined;
  readonly stateIds?: readonly UUID[] | undefined;
  /** `null` selects unassigned issues; there is no id that means "nobody". */
  readonly assigneeIds?: readonly (UUID | null)[] | undefined;
  readonly priorities?: readonly number[] | undefined;
  /**
   * Labels, ORed like every other dimension: "labelled bug or regression".
   *
   * ANDing them ("bug AND regression") is a different question and belongs to the filter
   * grammar, which can express it. Making this array mean AND would silently change what
   * every existing chip row means.
   */
  readonly labelIds?: readonly UUID[] | undefined;
  /** `null` selects issues with no parent — the top level of a nested list. */
  readonly parentIds?: readonly (UUID | null)[] | undefined;
  /** Issues in these projects. An issue with no project matches none of them. */
  readonly projectIds?: readonly UUID[] | undefined;
  /** Issues in these cycles. An issue with no cycle matches none of them. */
  readonly cycleIds?: readonly UUID[] | undefined;
  /** Substring of the title, accent- and case-insensitive. */
  readonly text?: string | undefined;
  /**
   * Archived issues are excluded by default. They are still in the replica when they
   * were archived after the snapshot, and a list that silently included them would show
   * work the team has explicitly put away.
   */
  readonly includeArchived?: boolean | undefined;
}

export type GroupBy = 'none' | 'state' | 'assignee' | 'priority' | 'team';
export type SortBy = 'sortOrder' | 'priority' | 'updatedAt' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface IssueQuery {
  readonly filter?: IssueFilter | undefined;
  readonly groupBy?: GroupBy | undefined;
  readonly sortBy?: SortBy | undefined;
  /** Applies to the issues, not to the group headings. See `IssueQueryResult.groups`. */
  readonly direction?: SortDirection | undefined;
}

export interface IssueGroup {
  /** The state id, assignee id (or `null`), priority number, or team id. `null` when ungrouped. */
  readonly key: UUID | number | null;
  readonly ids: readonly UUID[];
}

export interface IssueQueryResult {
  /** Every matching id, filtered and sorted, ignoring grouping. */
  readonly ids: readonly UUID[];
  /**
   * The same ids bucketed.
   *
   * Group headings keep the product's own order — workflow order for statuses, urgent
   * before low for priorities — regardless of `direction`, which orders the rows inside
   * them. Reversing the sort inside a list should not move "Done" above "Todo".
   */
  readonly groups: readonly IssueGroup[];
}

const EMPTY: ReadonlySet<UUID> = new Set<UUID>();

/**
 * Sorts a key that cannot be resolved last, rather than dropping it: an issue in a team
 * this replica has not received yet must still appear, at the bottom, instead of
 * silently vanishing from a list that claims to be complete.
 *
 * U+FFFF is a permanent noncharacter, so no title, team key or display name can ever
 * collide with it.
 */
const LAST = '￿';

export function queryIssues(source: IssueSource, request: IssueQuery = {}): IssueQueryResult {
  const candidates = select(source, request.filter);
  const ids = order(source, candidates, request.sortBy ?? 'sortOrder', request.direction ?? 'asc');
  return { ids, groups: group(source, ids, request.groupBy ?? 'none') };
}

export interface SubIssueProgress {
  /** Sub-issues that count towards the bar. */
  readonly total: number;
  readonly completed: number;
}

/**
 * How far through its sub-issues a parent is.
 *
 * Counted from the children rather than stored on the parent. A stored counter is a
 * second definition of "done" that drifts the first time a status is recategorised, and
 * it is the reason acceptance test 4 asks for the rollup to move with no extra round
 * trip: the children are already here, so the parent's bar is a read.
 *
 * Cancelled and duplicate children leave the total entirely rather than counting as
 * incomplete. Work the team explicitly dropped must not hold a parent at "3 of 5"
 * forever, which reads as a stuck issue rather than a finished one.
 */
export function subIssueProgress(source: IssueSource, parentId: UUID): SubIssueProgress {
  let total = 0;
  let completed = 0;
  for (const id of source.index.byParent(parentId)) {
    const child = source.issues.get(id);
    if (child === undefined || child.archivedAt !== undefined) continue;
    const category = source.workflowStates.get(child.stateId)?.category;
    if (category === 'canceled' || category === 'duplicate') continue;
    total++;
    // The category, never the status name: a team with "Done" and "Shipped" has two
    // completed statuses, and matching on the name would count only one of them.
    if (category === 'completed') completed++;
  }
  return { total, completed };
}

/**
 * Narrows the corpus to the matching ids, entirely out of the indexes.
 *
 * The intersection walks the smallest posting set and probes the others, so the cost is
 * bounded by the most selective dimension rather than by the workspace. A filter for one
 * assignee in a five-thousand-issue workspace touches that person's twenty issues.
 */
function select(source: IssueSource, filter: IssueFilter | undefined): ReadonlySet<UUID> {
  const index = source.index;
  const dimensions: Array<ReadonlySet<UUID>> = [
    filter?.includeArchived === true ? index.all() : index.active(),
  ];

  if (filter !== undefined) {
    if (filter.teamIds !== undefined && filter.teamIds.length > 0) {
      dimensions.push(union(filter.teamIds.map((id) => index.byTeam(id))));
    }
    if (filter.stateIds !== undefined && filter.stateIds.length > 0) {
      dimensions.push(union(filter.stateIds.map((id) => index.byState(id))));
    }
    if (filter.assigneeIds !== undefined && filter.assigneeIds.length > 0) {
      dimensions.push(union(filter.assigneeIds.map((id) => index.byAssignee(id))));
    }
    if (filter.priorities !== undefined && filter.priorities.length > 0) {
      dimensions.push(union(filter.priorities.map((p) => index.byPriority(p))));
    }
    if (filter.labelIds !== undefined && filter.labelIds.length > 0) {
      dimensions.push(union(filter.labelIds.map((id) => source.labelIndex.issueIdsWith(id))));
    }
    if (filter.parentIds !== undefined && filter.parentIds.length > 0) {
      dimensions.push(union(filter.parentIds.map((id) => index.byParent(id))));
    }
    if (filter.projectIds !== undefined && filter.projectIds.length > 0) {
      dimensions.push(union(filter.projectIds.map((id) => index.byProject(id))));
    }
    if (filter.cycleIds !== undefined && filter.cycleIds.length > 0) {
      dimensions.push(union(filter.cycleIds.map((id) => index.byCycle(id))));
    }
    if (filter.text !== undefined && fold(filter.text) !== '') {
      dimensions.push(index.search(filter.text));
    }
  }

  return intersect(dimensions);
}

function union(sets: ReadonlyArray<ReadonlySet<UUID>>): ReadonlySet<UUID> {
  const first = sets[0];
  if (first === undefined) return EMPTY;
  // One value is the overwhelmingly common case — a single team, a single assignee — and
  // returning the live bucket avoids copying it.
  if (sets.length === 1) return first;
  const out = new Set<UUID>();
  for (const set of sets) for (const id of set) out.add(id);
  return out;
}

function intersect(sets: Array<ReadonlySet<UUID>>): ReadonlySet<UUID> {
  sets.sort((a, b) => a.size - b.size);
  const smallest = sets[0];
  if (smallest === undefined) return EMPTY;
  if (sets.length === 1) return smallest;

  const out = new Set<UUID>();
  candidate: for (const id of smallest) {
    for (let i = 1; i < sets.length; i++) {
      const set = sets[i];
      if (set === undefined || !set.has(id)) continue candidate;
    }
    out.add(id);
  }
  return out;
}

function order(
  source: IssueSource,
  candidates: ReadonlySet<UUID>,
  sortBy: SortBy,
  direction: SortDirection,
): readonly UUID[] {
  if (candidates.size === 0) return [];

  if (sortBy === 'updatedAt') {
    // Filtered out of the index's shared ordering rather than sorted here. The corpus is
    // ordered once per delta batch and every open view reads the same array, so N lists
    // sorting by recency cost one sort between them instead of N.
    const ordered: UUID[] = [];
    for (const id of source.index.updatedOrder()) if (candidates.has(id)) ordered.push(id);
    if (direction === 'asc') ordered.reverse();
    return ordered;
  }

  return sortByKey([...candidates], keyOf(source, sortBy), direction);
}

function keyOf(source: IssueSource, sortBy: SortBy): (id: UUID) => string | number {
  switch (sortBy) {
    case 'priority':
      // Ranked, not raw: the server stores 0 for "no priority", so the numeric order puts
      // unprioritised work above everything urgent.
      return (id) => priorityRank(source.issues.get(id)?.priority ?? 0);
    case 'title':
      // The folded title, which the index already holds — sorting on the raw string would
      // put "Zebra" before "ábaco" and cost a collator per comparison to avoid it.
      return (id) => source.index.titleOf(id);
    case 'sortOrder':
    case 'updatedAt':
    default:
      // Fractional indices are built to compare as plain strings; that is the whole point
      // of them, and it is what makes an issue dragged between two others a single write.
      return (id) => source.issues.get(id)?.sortOrder ?? LAST;
  }
}

/**
 * Sorts by a key computed once per id rather than once per comparison.
 *
 * Five thousand issues is roughly sixty thousand comparisons; recomputing the key inside
 * the comparator means sixty thousand map lookups instead of five thousand.
 */
function sortByKey(
  ids: UUID[],
  keyFor: (id: UUID) => string | number,
  direction: SortDirection,
): readonly UUID[] {
  const decorated = ids.map((id) => [keyFor(id), id] as const);
  const sign = direction === 'desc' ? -1 : 1;
  decorated.sort((a, b) => {
    const byKey = compare(a[0], b[0]);
    // Ids break ties so a re-query returns the same order and rows do not swap under the
    // user's cursor when two issues share a priority.
    return byKey !== 0 ? sign * byKey : compare(a[1], b[1]);
  });
  return decorated.map((entry) => entry[1]);
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return a < b ? -1 : a > b ? 1 : 0;
}

function group(source: IssueSource, ids: readonly UUID[], groupBy: GroupBy): readonly IssueGroup[] {
  if (groupBy === 'none') return [{ key: null, ids }];

  const buckets = new Map<UUID | number | null, UUID[]>();
  for (const id of ids) {
    const issue = source.issues.get(id);
    if (issue === undefined) continue;
    const key = groupKeyOf(issue, groupBy);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [id]);
    else bucket.push(id);
  }

  const groups = [...buckets].map(([key, members]) => ({ key, ids: members }));
  groups.sort((a, b) =>
    compare(groupOrderOf(source, a.key, groupBy), groupOrderOf(source, b.key, groupBy)),
  );
  return groups;
}

function groupKeyOf(issue: Issue, groupBy: GroupBy): UUID | number | null {
  switch (groupBy) {
    case 'state':
      return issue.stateId;
    case 'assignee':
      return issue.assigneeId ?? null;
    case 'priority':
      return issue.priority;
    case 'team':
      return issue.teamId;
    case 'none':
    default:
      return null;
  }
}

function groupOrderOf(
  source: IssueSource,
  key: UUID | number | null,
  groupBy: GroupBy,
): string | number {
  switch (groupBy) {
    case 'state': {
      const state = typeof key === 'string' ? source.workflowStates.get(key) : undefined;
      if (state === undefined) return LAST;
      // Category first, then the fractional position inside it. Positions are only
      // comparable within a category, so comparing them across one would interleave
      // "In Progress" with "Backlog" in an order nobody chose.
      return `${String(CATEGORY_ORDER[state.category]).padStart(2, '0')}:${state.position}`;
    }
    case 'assignee': {
      // Unassigned last: it is where work goes to be picked up, not a person's column.
      if (key === null) return LAST;
      const user = typeof key === 'string' ? source.users.get(key) : undefined;
      return user === undefined ? LAST : fold(user.displayName);
    }
    case 'priority':
      return typeof key === 'number' ? priorityRank(key) : Number.MAX_SAFE_INTEGER;
    case 'team': {
      const team = typeof key === 'string' ? source.teams.get(key) : undefined;
      return team === undefined ? LAST : team.key;
    }
    case 'none':
    default:
      return 0;
  }
}
