/**
 * The two auto-assign habits live on this device, next to the theme.
 *
 * They are not a workspace default assignee — there is no such field — they are "what I
 * do with my own hands": assign what I file, and assign what I start. Both have to be
 * applied at the moment of the write rather than afterwards, or the issue spends a frame
 * unassigned and any filter watching assignee flickers.
 */

import { getPrefs } from '~/features/prefs/prefs';
import type { Store, UUID } from '~/store';

interface StatusFields {
  readonly stateId?: UUID | undefined;
  readonly assigneeId?: UUID | null | undefined;
}

/**
 * Adds `assigneeId: me` when the write is a move into started and the issue has nobody.
 *
 * Issues that already have an assignee are left alone: taking work off someone else because
 * you changed a status is not what the preference says.
 */
export function withAutoAssignOnStart<T extends StatusFields>(
  store: Store,
  id: UUID,
  fields: T,
  viewerId: UUID | null,
  prefs: { readonly autoAssignOnStart: boolean } = getPrefs(),
): T {
  if (fields.stateId === undefined || viewerId === null) return fields;
  if (!prefs.autoAssignOnStart) return fields;
  const issue = store.issues.get(id);
  if (issue === undefined || issue.assigneeId !== undefined) return fields;
  const state = store.workflowStates.get(fields.stateId);
  if (state?.category !== 'started') return fields;
  return { ...fields, assigneeId: viewerId };
}
