import { toWire } from '~/gql/enums';
import type { EntityPatch, Workspace } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { UPDATE_WORKSPACE } from './operations';

export interface WorkspaceReminderFields {
  readonly projectUpdateReminderIntervalDays?: number | undefined;
  readonly projectUpdateReminderWeekday?: number | undefined;
  readonly projectUpdateReminderHour?: number | undefined;
}

export interface WorkspacePulseFields {
  readonly pulseEnabled?: boolean | undefined;
  readonly pulseDigestCadence?: Workspace['pulseDigestCadence'] | undefined;
}

export async function updateWorkspaceReminderCadence(
  engine: SyncEngine,
  fields: WorkspaceReminderFields,
): Promise<void> {
  return updateWorkspace(engine, fields);
}

export async function updateWorkspacePulse(
  engine: SyncEngine,
  fields: WorkspacePulseFields,
): Promise<void> {
  return updateWorkspace(engine, fields);
}

async function updateWorkspace(
  engine: SyncEngine,
  fields: WorkspaceReminderFields & WorkspacePulseFields,
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
    ...(fields.pulseEnabled === undefined ? null : { pulseEnabled: fields.pulseEnabled }),
    ...(fields.pulseDigestCadence === undefined
      ? null
      : { pulseDigestCadence: fields.pulseDigestCadence }),
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
        ...(fields.pulseEnabled === undefined ? null : { pulseEnabled: fields.pulseEnabled }),
        ...(fields.pulseDigestCadence === undefined
          ? null
          : { pulseDigestCadence: toWire(fields.pulseDigestCadence) }),
      },
    },
    optimistic: [optimistic],
  });
}
