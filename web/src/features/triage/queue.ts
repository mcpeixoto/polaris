/**
 * How much unreviewed work a team is still holding.
 *
 * Read from the statuses and never from the team's switch, because the two are
 * deliberately independent: turning triage off stops new intake and leaves whatever is
 * already queued exactly where it is. This is the number that decides whether the inbox is
 * still a screen somebody needs.
 *
 * Archived work is left out so the count agrees with the rows the inbox lists — the filter
 * grammar drops archived issues unless a clause names them, and a count that disagreed
 * with what is underneath it would be worse than no count at all. Snoozed work is counted:
 * a snooze is a deferred decision, not a decision.
 */

import type { Store, UUID } from '~/store';

export function triageQueueCount(store: Store, teamId: UUID): number {
  // The cheap gate first. A team that has never run triage has no triage status, and the
  // shell asks this question on every issue delta to decide where `G T` goes — without
  // this it would walk every issue in every team of a workspace that does not use triage
  // at all. A team's statuses are a handful; its issues are thousands.
  if (!hasTriageStatus(store, teamId)) return 0;

  let count = 0;
  for (const id of store.index.byTeam(teamId)) {
    const issue = store.issues.get(id);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    if (store.workflowStates.get(issue.stateId)?.category === 'triage') count += 1;
  }
  return count;
}

function hasTriageStatus(store: Store, teamId: UUID): boolean {
  for (const id of store.workflowStateIdsFor(teamId)) {
    const state = store.workflowStates.get(id);
    // Archived counts: a status can be archived with work still in it, and that work is
    // still waiting on somebody.
    if (state?.category === 'triage') return true;
  }
  return false;
}
