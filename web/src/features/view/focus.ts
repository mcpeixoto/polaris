/**
 * Focus grouping for My Issues.
 *
 * Assigned work is not one flat list: Linear's morning view puts each issue in the first
 * bucket that fits — urgent, then SLA-bound, then blockers, then cycle work, then the rest
 * of active, then triage, backlog, and completed. Sections that have nobody in them stay
 * hidden; within a section, started work leads and priority decides the rest.
 *
 * Exclusive first-match, not a multi-label: an urgent issue that also blocks something sits
 * under Urgent, not under both. That is the point of a routing view — one place to look.
 */

import { priorityRank, type Issue, type Store, type UUID } from '~/store';

export const FOCUS_KEYS = [
  'urgent',
  'sla',
  'blockers',
  'cycle',
  'active',
  'triage',
  'backlog',
  'completed',
] as const;

export type FocusKey = (typeof FOCUS_KEYS)[number];

export const FOCUS_LABELS: Readonly<Record<FocusKey, string>> = {
  urgent: 'Urgent',
  sla: 'SLA',
  blockers: 'Blockers',
  cycle: 'Cycle',
  active: 'Active',
  triage: 'Triage',
  backlog: 'Backlog',
  completed: 'Completed',
};

const FOCUS_RANK: Readonly<Record<FocusKey, number>> = {
  urgent: 0,
  sla: 1,
  blockers: 2,
  cycle: 3,
  active: 4,
  triage: 5,
  backlog: 6,
  completed: 7,
};

/** Which Focus section an issue belongs in — the first matching rule wins. */
export function focusKeyOf(issue: Issue, store: Store): FocusKey {
  const category = store.workflowStates.get(issue.stateId)?.category;
  if (category === 'completed' || category === 'canceled') return 'completed';

  if (issue.priority === 1) return 'urgent';
  if (issue.dueDateSource === 'sla') return 'sla';
  if (isBlocking(store, issue.id)) return 'blockers';
  if (issue.cycleId !== undefined) return 'cycle';
  if (category === 'triage') return 'triage';
  if (category === 'backlog') return 'backlog';
  return 'active';
}

export function focusRank(key: string): number {
  return FOCUS_RANK[key as FocusKey] ?? 99;
}

/**
 * Within a Focus section: started work first, then priority, then id for stability.
 *
 * The display menu's order-by is ignored here on purpose — Focus is a curated routing, and
 * letting "updated" reshuffle Urgent under the cursor would undo the point of the sections.
 */
export function sortFocusIssues(issues: Issue[], store: Store): Issue[] {
  return [...issues].sort((a, b) => {
    const startedA = store.workflowStates.get(a.stateId)?.category === 'started' ? 0 : 1;
    const startedB = store.workflowStates.get(b.stateId)?.category === 'started' ? 0 : 1;
    if (startedA !== startedB) return startedA - startedB;
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    if (byPriority !== 0) return byPriority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function isBlocking(store: Store, issueId: UUID): boolean {
  const blocked = store.relationIndex.blockingByIssue().get(issueId);
  return blocked !== undefined && blocked.size > 0;
}
