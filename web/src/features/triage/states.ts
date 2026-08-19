/**
 * The statuses triage moves an issue between.
 *
 * Accept lands on the team's default. Decline takes the first canceled status. Duplicate
 * is the reserved system status, one per team. All three are looked up here so the
 * optimistic patch and the server agree about where the row went.
 */

import type { StateCategory, Store, UUID, WorkflowState } from '~/store';

export function teamDefaultState(store: Store, teamId: UUID): WorkflowState | undefined {
  const states = statesOf(store, teamId);
  return states.find((state) => state.isDefault) ?? states[0];
}

export function stateInCategory(
  store: Store,
  teamId: UUID,
  category: StateCategory,
): WorkflowState | undefined {
  return statesOf(store, teamId).find((state) => state.category === category);
}

function statesOf(store: Store, teamId: UUID): WorkflowState[] {
  const states: WorkflowState[] = [];
  for (const id of store.workflowStateIdsFor(teamId)) {
    const state = store.get('workflowState', id);
    if (state === undefined || state.archivedAt !== undefined) continue;
    states.push(state);
  }
  return states;
}
