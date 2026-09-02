import { toWire } from '~/gql/enums';
import type { EntityPatch, UUID, Workspace } from '~/store';
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

export interface WorkspaceCustomerFields {
  readonly customerRequestsEnabled?: boolean | undefined;
  readonly customerDefaultTeamId?: UUID | null | undefined;
  readonly customerRevenueUnit?: string | undefined;
  readonly customerTiers?: readonly string[] | undefined;
}

export interface WorkspaceGeneralFields {
  readonly name?: string | undefined;
  readonly logoUrl?: string | null | undefined;
  readonly urlKey?: string | undefined;
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

export async function updateWorkspaceCustomers(
  engine: SyncEngine,
  fields: WorkspaceCustomerFields,
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
  fields: WorkspaceReminderFields &
    WorkspacePulseFields &
    WorkspaceGeneralFields &
    WorkspaceCustomerFields,
): Promise<void> {
  const before = engine.store.workspaces.get(engine.store.workspaceId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const urlKey = fields.urlKey?.trim().toLowerCase();

  /*
   * A required field cleared is a refusal, not a no-op.
   *
   * Dropping an empty name from the patch below and resolving successfully is what let the
   * settings screen show an empty workspace name for ever: the field was uncontrolled, so
   * nothing put the old value back, the sidebar kept the name the store still held, and
   * neither the user nor the screen was told the two disagreed. Rejecting says which field
   * and lets the view revert it.
   */
  if (fields.name !== undefined && name === '') {
    throw new Error('A workspace needs a name.');
  }
  if (fields.urlKey !== undefined && urlKey === '') {
    throw new Error('A workspace needs an address.');
  }
  const after: Workspace = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(urlKey === undefined || urlKey === '' ? null : { urlKey }),
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
    ...(fields.customerRequestsEnabled === undefined
      ? null
      : { customerRequestsEnabled: fields.customerRequestsEnabled }),
    ...(fields.customerDefaultTeamId === undefined
      ? null
      : {
          customerDefaultTeamId:
            fields.customerDefaultTeamId === null ? undefined : fields.customerDefaultTeamId,
        }),
    ...(fields.customerRevenueUnit === undefined
      ? null
      : { customerRevenueUnit: fields.customerRevenueUnit }),
    ...(fields.customerTiers === undefined ? null : { customerTiers: [...fields.customerTiers] }),
    updatedAt: new Date().toISOString(),
  };

  const optimistic: EntityPatch = { type: 'workspace', id: before.id, before, after };

  await engine.mutate<{ updateWorkspace: { workspace: Workspace } }>({
    mutation: UPDATE_WORKSPACE,
    variables: {
      input: {
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.urlKey === before.urlKey ? null : { urlKey: after.urlKey }),
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
        ...(fields.customerRequestsEnabled === undefined
          ? null
          : { customerRequestsEnabled: fields.customerRequestsEnabled }),
        ...(fields.customerDefaultTeamId === undefined
          ? null
          : fields.customerDefaultTeamId === null
            ? { clearCustomerDefaultTeam: true }
            : { customerDefaultTeamId: fields.customerDefaultTeamId }),
        ...(fields.customerRevenueUnit === undefined
          ? null
          : { customerRevenueUnit: fields.customerRevenueUnit }),
        ...(fields.customerTiers === undefined
          ? null
          : { customerTiers: [...fields.customerTiers] }),
      },
    },
    optimistic: [optimistic],
  });
}
