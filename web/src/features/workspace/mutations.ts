import type { EntityPatch, Workspace } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { UPDATE_WORKSPACE } from './operations';

export interface WorkspaceReminderFields {
  readonly projectUpdateReminderIntervalDays?: number | undefined;
  readonly projectUpdateReminderWeekday?: number | undefined;
  readonly projectUpdateReminderHour?: number | undefined;
}

export async function updateWorkspaceReminderCadence(
  engine: SyncEngine,
  fields: WorkspaceReminderFields,
): Promise<void> {
  const before = engine.store.workspaces.get(engine.store.workspaceId);
  if (before === undefined) return;

  const after: Workspace = {
    ...before,
    ...(fields.projectUpdateReminderIntervalDays === undefined
      ? null
      : { projectUpdateReminderIntervalDays: fields.projectUpdateReminderIntervalDays }),
    ...(fields.projectUpdateReminderWeekday === undefined
      ? null
      : { projectUpdateReminderWeekday: fields.projectUpdateReminderWeekday }),
    ...(fields.projectUpdateReminderHour === undefined
      ? null
      : { projectUpdateReminderHour: fields.projectUpdateReminderHour }),
    updatedAt: new Date().toISOString(),
  };

  const optimistic: EntityPatch = { type: 'workspace', id: before.id, before, after };

  await engine.mutate<{ updateWorkspace: { workspace: Workspace } }>({
    mutation: UPDATE_WORKSPACE,
    variables: {
      input: {
        ...(fields.projectUpdateReminderIntervalDays === undefined
          ? null
          : { projectUpdateReminderIntervalDays: fields.projectUpdateReminderIntervalDays }),
        ...(fields.projectUpdateReminderWeekday === undefined
          ? null
          : { projectUpdateReminderWeekday: fields.projectUpdateReminderWeekday }),
        ...(fields.projectUpdateReminderHour === undefined
          ? null
          : { projectUpdateReminderHour: fields.projectUpdateReminderHour }),
      },
    },
    optimistic: [optimistic],
  });
}
