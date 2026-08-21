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

export interface WorkspaceGeneralFields {
  readonly name?: string | undefined;
  readonly logoUrl?: string | null | undefined;
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

export async function updateWorkspaceGeneral(
  engine: SyncEngine,
  fields: WorkspaceGeneralFields,
): Promise<void> {
  return updateWorkspace(engine, fields);
}

async function updateWorkspace(
  engine: SyncEngine,
  fields: WorkspaceReminderFields & WorkspacePulseFields & WorkspaceGeneralFields,
): Promise<void> {
  const before = engine.store.workspaces.get(engine.store.workspaceId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: Workspace = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.logoUrl === undefined
      ? null
      : fields.logoUrl === null || fields.logoUrl.trim() === ''
        ? { logoUrl: undefined }
        : { logoUrl: fields.logoUrl.trim() }),
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
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.logoUrl === before.logoUrl ? null : { logoUrl: after.logoUrl ?? '' }),
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
