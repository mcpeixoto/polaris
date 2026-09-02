/**
 * Which row the triage screen is working on, and which one it moves to next.
 *
 * Triage is a queue, and a queue is only worth having if finishing one item hands you the
 * one after it. The awkward part is that the row being acted on *disappears* — accept,
 * decline and merge all move the issue out of the triage category, and the optimistic patch
 * lands before the request does. So "the next issue" has to be read before the write, or
 * from the queue as it was a moment ago; asked afterwards it is whatever floated to the top,
 * which is how a reviewer ends up back at the first row after every decision.
 *
 * The order restates the list's default display — statuses in their own order, then manual
 * `sortOrder` — so that "next" here and the row under the list's cursor are the same issue.
 * They are still allowed to disagree: the reviewer may have grouped or sorted the list
 * differently, and when that happens the list's cursor wins, because it is the one they can
 * see. This file only decides where to go when the row under them has just vanished.
 */

import type { Issue, Store, UUID } from '~/store';

/**
 * The team's triage queue, in the order the list draws it.
 *
 * Snoozed rows are left out, which is the list's own default — a snooze is a decision to
 * look later, and a queue that kept offering the row would make it meaningless. Archived
 * rows are out for the same reason `triageQueueCount` leaves them out.
 */
export function triageQueueIds(store: Store, teamId: UUID, now: number = Date.now()): UUID[] {
  const rows: { issue: Issue; statePosition: string }[] = [];
  for (const id of store.index.byTeam(teamId)) {
    const issue = store.issues.get(id);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    const state = store.workflowStates.get(issue.stateId);
    if (state?.category !== 'triage') continue;
    if (isSnoozed(issue.snoozedUntil, now)) continue;
    rows.push({ issue, statePosition: state.position });
  }

  // The id breaks the tie for the same reason the inbox's sort does: two issues filed in the
  // same import share a `sortOrder` often enough, and without a total order the queue
  // reshuffles itself under the cursor when an unrelated delta arrives.
  rows.sort((a, b) => {
    if (a.statePosition !== b.statePosition) return a.statePosition < b.statePosition ? -1 : 1;
    if (a.issue.sortOrder !== b.issue.sortOrder)
      return a.issue.sortOrder < b.issue.sortOrder ? -1 : 1;
    return a.issue.id < b.issue.id ? -1 : a.issue.id > b.issue.id ? 1 : 0;
  });
  return rows.map((row) => row.issue.id);
}

/**
 * The row a decision on `current` should leave the reviewer on.
 *
 * The one after it, or the one before when `current` is last — the end of the queue is a
 * place to keep working from, not a reason to jump back to the top. Null only when `current`
 * was the whole queue, which is the empty state's cue.
 */
export function nextInQueue(ids: readonly UUID[], current: UUID | null): UUID | null {
  if (current === null) return ids[0] ?? null;
  const at = ids.indexOf(current);
  if (at === -1) return ids[0] ?? null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

function isSnoozed(until: string | undefined, now: number): boolean {
  if (until === undefined) return false;
  const at = Date.parse(until);
  // An unparseable timestamp counts as awake, the way the inbox reads one: a row nobody can
  // see and nobody can wake is worse than one that comes back early.
  return !Number.isNaN(at) && at > now;
}
