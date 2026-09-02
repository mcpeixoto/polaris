/**
 * Grouping and ordering a filtered list.
 *
 * The filter decides which issues; this decides what they look like. Both come out of the
 * same `DisplayOptions`, both are shared and saved with a view, and both run on every
 * keystroke — so like the filter, neither is debounced and neither builds a map per call.
 *
 * The one rule worth stating up front: a group is never invented from the data. Grouping by
 * status shows every status the view's team has, including the empty ones, because an empty
 * column is information — "nothing is in review" is a fact somebody wants to see, and a
 * board whose columns appear and disappear as work moves through it is one nobody can
 * build a habit around.
 */

import type { DisplayDirection, DisplayGroupBy, DisplayOrderBy } from '~/filter';
import {
  CATEGORY_ORDER,
  priorityRank,
  type Issue,
  type Store,
  type UUID,
  type WorkflowState,
} from '~/store';
import { priorityLabel } from '~/components';
import { personName } from '~/features/prefs/prefs';

export interface IssueGroup {
  /** Stable across renders and unique within the view: the DOM key and the board column id. */
  readonly key: string;
  readonly label: string;
  /** The entity the group is of, when there is one — for a status colour or an avatar. */
  readonly stateId?: UUID;
  readonly userId?: UUID;
  readonly labelId?: UUID;
  readonly teamId?: UUID;
  readonly priority?: number;
  readonly issues: Issue[];
}

/** The key used for "no value": unassigned, unlabelled, no due date. */
const NONE = ' none';

/**
 * Groups issues, then orders within each group.
 *
 * Returns groups in a stable, meaningful order rather than in the order the data happened
 * to arrive: statuses by category then position, priorities by display rank, people
 * alphabetically. A list whose group order changes when somebody files an issue is a list
 * people stop trusting their muscle memory on.
 */
export function groupIssues(
  issues: readonly Issue[],
  store: Store,
  groupBy: DisplayGroupBy,
  orderBy: DisplayOrderBy,
  direction: DisplayDirection,
  teamId?: UUID,
  admits?: (state: WorkflowState) => boolean,
  /**
   * Whether groups that nothing falls into are drawn.
   *
   * The default is the module's opening rule — an empty status column is information, and a
   * board whose columns come and go as work moves through it is one nobody can build a habit
   * around. `09-views-filters-layouts.md` asks for it to be a toggle, because the argument
   * stops holding on a filtered view: five zero-count headers over one matching issue is the
   * padding displacing the answer.
   */
  showEmptyGroups = true,
): IssueGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: '', issues: sortIssues([...issues], store, orderBy, direction) }];
  }

  const buckets = new Map<string, Issue[]>();
  const put = (key: string, issue: Issue) => {
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [issue]);
    else bucket.push(issue);
  };

  for (const issue of issues) {
    switch (groupBy) {
      case 'state':
        put(issue.stateId, issue);
        break;
      case 'stateCategory':
        put(store.workflowStates.get(issue.stateId)?.category ?? NONE, issue);
        break;
      case 'assignee':
        put(issue.assigneeId ?? NONE, issue);
        break;
      case 'priority':
        put(String(issue.priority), issue);
        break;
      case 'team':
        put(issue.teamId, issue);
        break;
      case 'parent':
        put(issue.parentId ?? NONE, issue);
        break;
      case 'dueDate':
        put(issue.dueDate ?? NONE, issue);
        break;
      case 'label': {
        // An issue with three labels appears in three groups, and that is correct rather
        // than a duplicate: "show me everything tagged regression" has to include work
        // that is also tagged something else. The count at the top of a label-grouped view
        // is therefore not the number of issues, which is worth knowing before somebody
        // reports it as a bug.
        const labels = store.labelIdsFor(issue.id);
        if (labels.size === 0) put(NONE, issue);
        else for (const labelId of labels) put(labelId, issue);
        break;
      }
    }
  }

  // Empty groups are added for the dimensions where absence is information. Statuses and
  // priorities are fixed sets the team can see the whole of; assignees and labels are not,
  // and a column per member of a two-hundred-person workspace is not a board.
  if (groupBy === 'state' && showEmptyGroups) {
    // Statuses belong to a team, so the fixed set to show the whole of is the scoped
    // team's — not the workspace's. Padding from every status in the workspace puts other
    // teams' columns on this team's board (three "Todo"s in a three-team workspace) for
    // issues that could never land in them. A view that spans teams has no one such set,
    // and falls back to the statuses of the teams its issues are actually in.
    //
    // `admits` narrows it the second way, for the same reason and by the same argument: a
    // status the view's own filter can never let through is a column no work can reach.
    // The triage inbox is the sharpest case — it is pinned to one status, and without this
    // it drew a column for every other status the team has, six headers that could only
    // ever read zero. A team's ordinary list is the mirror image: it hides triage by
    // default, so a Triage column there says "0" while the queue behind it is full.
    const teams =
      teamId === undefined ? new Set(issues.map((issue) => issue.teamId)) : new Set([teamId]);
    for (const [id, state] of store.workflowStates) {
      if (state.archivedAt !== undefined || !teams.has(state.teamId) || buckets.has(id)) continue;
      if (admits !== undefined && !admits(state)) continue;
      buckets.set(id, []);
    }
  }
  if (groupBy === 'priority' && showEmptyGroups) {
    for (const priority of [1, 2, 3, 4, 0]) {
      if (!buckets.has(String(priority))) buckets.set(String(priority), []);
    }
  }

  const groups: IssueGroup[] = [];
  for (const [key, bucket] of buckets) {
    groups.push({
      ...describe(key, groupBy, store),
      issues: sortIssues(bucket, store, orderBy, direction),
    });
  }
  groups.sort((a, b) => compareGroups(a, b, groupBy, store));
  return groups;
}

function describe(key: string, groupBy: DisplayGroupBy, store: Store): Omit<IssueGroup, 'issues'> {
  if (key === NONE) {
    return { key, label: emptyLabelFor(groupBy) };
  }
  switch (groupBy) {
    case 'state': {
      const state = store.workflowStates.get(key);
      return { key, label: state?.name ?? 'Unknown status', stateId: key };
    }
    case 'stateCategory':
      return { key, label: categoryLabel(key) };
    case 'assignee': {
      // Through `personName`, so the "full names" preference reaches a column heading as well
      // as the rows under it. Reading `displayName` here meant toggling the preference
      // relabelled every row on an assignee board and left the columns saying the other
      // thing — one setting with two answers on one screen.
      const user = store.get('user', key);
      return { key, label: user === undefined ? 'Unknown' : personName(user), userId: key };
    }
    case 'priority':
      return { key, label: priorityLabel(Number(key)), priority: Number(key) };
    case 'team': {
      const team = store.get('team', key);
      return { key, label: team === undefined ? 'Unknown team' : team.name, teamId: key };
    }
    case 'label':
      return { key, label: store.get('label', key)?.name ?? 'Unknown label', labelId: key };
    case 'parent': {
      const parent = store.get('issue', key);
      return { key, label: parent === undefined ? 'Unknown parent' : parent.title };
    }
    case 'dueDate':
      return { key, label: key };
    default:
      return { key, label: key };
  }
}

/** What "no value" is called, which is different for each dimension and never "None". */
function emptyLabelFor(groupBy: DisplayGroupBy): string {
  switch (groupBy) {
    case 'assignee':
      return 'Unassigned';
    case 'label':
      return 'No label';
    case 'dueDate':
      return 'No due date';
    case 'parent':
      return 'No parent';
    default:
      return 'None';
  }
}

function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1).replace(/([A-Z])/g, ' $1');
}

function compareGroups(
  a: IssueGroup,
  b: IssueGroup,
  groupBy: DisplayGroupBy,
  store: Store,
): number {
  // The unset group always sorts last, whatever the dimension. It is the residue, not a
  // value, and putting "Unassigned" first pushes the actual work below the fold.
  if (a.key === NONE) return 1;
  if (b.key === NONE) return -1;

  switch (groupBy) {
    case 'state': {
      const left = store.workflowStates.get(a.key);
      const right = store.workflowStates.get(b.key);
      return compareStates(left, right);
    }
    case 'stateCategory':
      return (
        (CATEGORY_ORDER[a.key as keyof typeof CATEGORY_ORDER] ?? 99) -
        (CATEGORY_ORDER[b.key as keyof typeof CATEGORY_ORDER] ?? 99)
      );
    case 'priority':
      // By display rank, not by the stored number: 0 means "no priority" and sorting on
      // the raw value puts unprioritised work above everything urgent.
      return priorityRank(a.priority ?? 0) - priorityRank(b.priority ?? 0);
    case 'dueDate':
      // ISO dates compare correctly as strings, which is most of why the format was chosen.
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    default:
      return a.label.localeCompare(b.label);
  }
}

/**
 * Statuses order by category first and only then by position.
 *
 * Never by position alone: a fractional index is only comparable within a category, so
 * comparing a backlog status's key against a completed one's is comparing two unrelated
 * numbers and produces an order that looks almost right, which is worse than one that
 * looks wrong.
 */
function compareStates(a: WorkflowState | undefined, b: WorkflowState | undefined): number {
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const byCategory = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
  if (byCategory !== 0) return byCategory;
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/**
 * Groups, then groups each group again — swimlanes, as one flat list of groups.
 *
 * `09-views-filters-layouts.md` asks for sub-grouping "in list and board (as rows)". This is
 * the list's half of it and it is deliberately flat: the virtualiser measures and positions
 * one list, and real nesting would mean either giving up virtualisation or telling the
 * accessibility tree about a structure that is not in the DOM — the same bargain `rowsOf`
 * already makes about `role="group"`. So a swimlane is a group whose key and label name both
 * dimensions, which collapses, sticks and drops exactly as any other group does.
 *
 * Empty sub-groups are never padded, whatever `showEmptyGroups` says. The padding argument is
 * about a fixed set the team can see the whole of; a status crossed with an assignee is not
 * that set, and a board of statuses times people is a screen of zeroes.
 */
export function subGroupIssues(
  groups: readonly IssueGroup[],
  store: Store,
  subGroupBy: DisplayGroupBy,
  orderBy: DisplayOrderBy,
  direction: DisplayDirection,
): IssueGroup[] {
  if (subGroupBy === 'none') return [...groups];
  const out: IssueGroup[] = [];
  for (const group of groups) {
    if (group.issues.length === 0) {
      out.push(group);
      continue;
    }
    for (const sub of groupIssues(
      group.issues,
      store,
      subGroupBy,
      orderBy,
      direction,
      undefined,
      undefined,
      false,
    )) {
      out.push({
        ...sub,
        // The outer group's identity leads, so the swimlanes of one status stay together and
        // the key is unique across the view rather than only within its lane.
        key: `${group.key}/${sub.key}`,
        label: group.label === '' ? sub.label : `${group.label} · ${sub.label}`,
        // The outer group's entity, not the inner one's: the heading's icon is the status a
        // status board's lane is in, whatever the lane is then split by.
        ...(group.stateId === undefined ? null : { stateId: group.stateId }),
      });
    }
  }
  return out;
}

/** Sorts in place and returns the same array. */
export function sortIssues(
  issues: Issue[],
  store: Store,
  orderBy: DisplayOrderBy,
  direction: DisplayDirection,
): Issue[] {
  const sign = direction === 'desc' ? -1 : 1;
  issues.sort((a, b) => sign * compareIssues(a, b, store, orderBy));
  return issues;
}

function compareIssues(a: Issue, b: Issue, store: Store, orderBy: DisplayOrderBy): number {
  switch (orderBy) {
    case 'manual':
      // Fractional indices compare as plain strings under C collation, which is the whole
      // reason they are strings.
      return a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0;
    case 'priority':
      return priorityRank(a.priority) - priorityRank(b.priority) || tieBreak(a, b);
    case 'dueDate':
      // The undated sort last rather than first. An issue with no due date is not due
      // soonest, and treating an absent value as the smallest one is the classic way to
      // fill the top of a deadline view with work that has no deadline.
      return nullsLast(a.dueDate, b.dueDate) ?? tieBreak(a, b);
    case 'estimate':
      return nullsLast(a.estimate, b.estimate) ?? tieBreak(a, b);
    case 'createdAt':
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : tieBreak(a, b);
    case 'updatedAt':
      return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : tieBreak(a, b);
    case 'title':
      return a.title.localeCompare(b.title) || tieBreak(a, b);
    case 'customerCount':
      return customerCountOf(store, a.id) - customerCountOf(store, b.id) || tieBreak(a, b);
    default:
      return tieBreak(a, b);
  }
}

function customerCountOf(store: Store, issueId: UUID): number {
  return store.customerRequestIdsForIssue(issueId).size;
}

function nullsLast<T extends string | number>(a: T | undefined, b: T | undefined): number | null {
  if (a === undefined && b === undefined) return null;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : a > b ? 1 : null;
}

/**
 * The tie-break, and it is not optional.
 *
 * Array.prototype.sort is stable, so equal elements keep their input order — but the input
 * order here is whatever the index iterated, which changes when an unrelated issue is
 * edited. Without a deterministic tie-break, a list ordered by priority visibly reshuffles
 * its equal-priority rows every time anything in the workspace changes, and it looks like
 * a rendering bug because it is one.
 */
function tieBreak(a: Issue, b: Issue): number {
  return a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0;
}
