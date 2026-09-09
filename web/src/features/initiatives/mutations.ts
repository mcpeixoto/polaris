import { fromWire, toWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityOf,
  type InitiativeStatus,
  type StateCategory,
  type TimeframeGranularity,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_INITIATIVE_PROJECT,
  ADD_INITIATIVE_RELATION,
  ARCHIVE_INITIATIVE,
  CREATE_INITIATIVE,
  REMOVE_INITIATIVE_PROJECT,
  REMOVE_INITIATIVE_RELATION,
  UPDATE_INITIATIVE,
} from './operations';

type Initiative = EntityOf<'initiative'>;
type InitiativeProject = EntityOf<'initiativeProject'>;

/**
 * Everything `CreateInitiativeInput` accepts, which is everything the create dialog offers.
 *
 * It used to be name, description, owner and parent — three fields short of the input the
 * API has always taken — so a status, a priority, a target date or a lead team chosen in the
 * dialog would have been dropped on the way to the wire. Labels are the exception and are
 * not here: they are link rows rather than columns, and are applied after the id resolves.
 */
export interface NewInitiative {
  readonly name: string;
  readonly description?: string | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly status?: InitiativeStatus | undefined;
  readonly priority?: number | undefined;
  readonly ownerId?: UUID | undefined;
  readonly leadTeamId?: UUID | undefined;
  readonly targetDate?: string | undefined;
  readonly targetDateGranularity?: TimeframeGranularity | undefined;
  readonly parentInitiativeId?: UUID | undefined;
}

export async function createInitiative(engine: SyncEngine, input: NewInitiative): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: Initiative = {
    id,
    workspaceId: store.workspaceId,
    name: input.name,
    description: input.description ?? '',
    ...(input.icon === undefined || input.icon === '' ? null : { icon: input.icon }),
    // The server's default too, so the row does not change colour when the real one lands.
    color: input.color ?? '#6b7280',
    // The same defaults the server applies, so the row the list draws on the first frame is
    // the row the stream sends back — a provisional that said "planned" while the dialog set
    // "active" would move between statuses on its own a second later.
    status: input.status ?? 'planned',
    priority: input.priority ?? 0,
    sortOrder: 'z',
    ...(input.ownerId === undefined ? null : { ownerId: input.ownerId }),
    ...(input.leadTeamId === undefined ? null : { leadTeamId: input.leadTeamId }),
    ...(input.targetDate === undefined
      ? null
      : {
          targetDate: input.targetDate,
          targetDateGranularity: input.targetDateGranularity ?? 'day',
        }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createInitiative: { initiative: Initiative } }>({
      mutation: CREATE_INITIATIVE,
      variables: {
        input: {
          name: input.name,
          description: input.description ?? '',
          ...(input.icon === undefined || input.icon === '' ? null : { icon: input.icon }),
          ...(input.color === undefined || input.color === '' ? null : { color: input.color }),
          ownerId: input.ownerId,
          ...(input.status === undefined ? null : { status: toWire(input.status) }),
          ...(input.priority === undefined ? null : { priority: input.priority }),
          ...(input.leadTeamId === undefined ? null : { leadTeamId: input.leadTeamId }),
          ...(input.targetDate === undefined
            ? null
            : {
                targetDate: input.targetDate,
                targetDateGranularity: toWire(input.targetDateGranularity ?? 'day'),
              }),
          ...(input.parentInitiativeId === undefined
            ? null
            : { parentInitiativeId: input.parentInitiativeId }),
        },
      },
      optimistic: [{ type: 'initiative', id, before: null, after: provisional }],
      // The API mints an initiative's id, so the stand-in above has to be retired when the
      // real row turns up — by either route. Declared rather than swapped in the `await`
      // below: that closure does not survive a reload, and the stand-in does. See
      // `web/src/sync/reconcile.ts`.
      reconcile: {
        type: 'initiative',
        provisionalId: id,
        path: ['createInitiative', 'initiative'],
        // The name is what the client chose, and two initiatives are rarely opened under
        // one name in the same second.
        match: ['workspaceId', 'name'],
      },
    });
    return fromWire('initiative', data.createInitiative.initiative as EntityOf<'initiative'>).id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

/**
 * The five statuses, in the order a person reads them: proposed through to cancelled.
 *
 * Exported because every surface that offers the choice has to offer the same five in the
 * same order — the shell's status pill, the rail, the create dialog — and three private
 * copies of a list is how one of them ends up missing "canceled".
 */
export const INITIATIVE_STATUSES: readonly InitiativeStatus[] = [
  'proposed',
  'planned',
  'active',
  'completed',
  'canceled',
];

export interface InitiativeFields {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly status?: InitiativeStatus | undefined;
  readonly priority?: number | undefined;
  readonly ownerId?: UUID | null | undefined;
  readonly leadTeamId?: UUID | null | undefined;
  readonly targetDate?: string | null | undefined;
  /**
   * How precisely the target date is meant — a day, a month, a quarter, a half or a year.
   * It used to be pinned to `'day'` here while the create input took the real thing, so a
   * quarter chosen in the dialog became a day the first time anybody touched the date on
   * the detail screen. Ignored without a `targetDate`, which is the only thing it qualifies.
   */
  readonly targetDateGranularity?: TimeframeGranularity | undefined;
}

export async function updateInitiative(
  engine: SyncEngine,
  id: UUID,
  fields: InitiativeFields,
): Promise<void> {
  const store = engine.store;
  const before = store.get('initiative', id);
  if (before === undefined) return;

  const after: Initiative = {
    ...before,
    ...(fields.name === undefined ? null : { name: fields.name }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.icon === undefined ? null : { icon: fields.icon }),
    ...(fields.color === undefined ? null : { color: fields.color }),
    ...(fields.status === undefined ? null : { status: fields.status }),
    ...(fields.priority === undefined ? null : { priority: fields.priority }),
    ...(fields.ownerId === undefined
      ? null
      : { ownerId: fields.ownerId === null ? undefined : fields.ownerId }),
    ...(fields.leadTeamId === undefined
      ? null
      : { leadTeamId: fields.leadTeamId === null ? undefined : fields.leadTeamId }),
    ...(fields.targetDate === undefined
      ? null
      : fields.targetDate === null
        ? { targetDate: undefined, targetDateGranularity: undefined }
        : {
            targetDate: fields.targetDate,
            targetDateGranularity: fields.targetDateGranularity ?? 'day',
          }),
    updatedAt: new Date().toISOString(),
  };

  try {
    await engine.mutate({
      mutation: UPDATE_INITIATIVE,
      variables: {
        input: {
          id,
          ...(fields.name === undefined ? null : { name: fields.name }),
          ...(fields.description === undefined ? null : { description: fields.description }),
          ...(fields.icon === undefined ? null : { icon: fields.icon }),
          ...(fields.color === undefined ? null : { color: fields.color }),
          ...(fields.status === undefined ? null : { status: toWire(fields.status) }),
          ...(fields.priority === undefined ? null : { priority: fields.priority }),
          ...(fields.ownerId === undefined
            ? null
            : fields.ownerId === null
              ? { clearOwner: true }
              : { ownerId: fields.ownerId }),
          ...(fields.leadTeamId === undefined
            ? null
            : fields.leadTeamId === null
              ? { clearLeadTeam: true }
              : { leadTeamId: fields.leadTeamId }),
          ...(fields.targetDate === undefined
            ? null
            : fields.targetDate === null
              ? { clearTarget: true }
              : {
                  targetDate: fields.targetDate,
                  targetDateGranularity: toWire(fields.targetDateGranularity ?? 'day'),
                }),
        },
      },
      optimistic: [{ type: 'initiative', id, before, after }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function archiveInitiative(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('initiative', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: ARCHIVE_INITIATIVE,
      variables: { id, archived: true },
      optimistic: [{ type: 'initiative', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/**
 * Which state glyph an initiative status wears.
 *
 * An initiative's five statuses are the project status categories under different names,
 * so they borrow the same drawings — `PROJECT_STATUS_ICON` in `features/projects/
 * statusCategories.ts` makes the identical mapping for a project, and the two agreeing is
 * the point. "Proposed" is a backlog: an objective somebody has written down and nobody
 * has committed to. "Active" is started.
 *
 * These are the state tokens' own categories, not a colour borrowed from somewhere else,
 * so a theme that recolours "in progress" recolours an active initiative too — which is
 * what a reader looking at both screens expects.
 */
export const INITIATIVE_STATUS_ICON: Readonly<Record<InitiativeStatus, StateCategory>> = {
  proposed: 'backlog',
  planned: 'unstarted',
  active: 'started',
  completed: 'completed',
  canceled: 'canceled',
};

export function formatInitiativeStatus(status: InitiativeStatus): string {
  switch (status) {
    case 'proposed':
      return 'Proposed';
    case 'planned':
      return 'Planned';
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    case 'canceled':
      return 'Canceled';
    default:
      return status;
  }
}

export async function addInitiativeProject(
  engine: SyncEngine,
  initiativeId: UUID,
  projectId: UUID,
): Promise<void> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: InitiativeProject = {
    id,
    workspaceId: store.workspaceId,
    initiativeId,
    projectId,
    createdAt: now,
  };

  try {
    await engine.mutate<{ addInitiativeProject: { initiativeProject: InitiativeProject } }>({
      mutation: ADD_INITIATIVE_PROJECT,
      variables: { initiativeId, projectId },
      optimistic: [{ type: 'initiativeProject', id, before: null, after: provisional }],
      reconcile: {
        type: 'initiativeProject',
        provisionalId: id,
        path: ['addInitiativeProject', 'initiativeProject'],
        // One link row per pair, so this pairing is exact.
        match: ['initiativeId', 'projectId'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function removeInitiativeProject(
  engine: SyncEngine,
  initiativeId: UUID,
  projectId: UUID,
): Promise<void> {
  const store = engine.store;
  const link = [...store.initiativeProjectIdsFor(initiativeId)]
    .map((rowId) => store.get('initiativeProject', rowId))
    .find((row) => row?.projectId === projectId);
  if (link === undefined) return;

  try {
    await engine.mutate({
      mutation: REMOVE_INITIATIVE_PROJECT,
      variables: { initiativeId, projectId },
      optimistic: [{ type: 'initiativeProject', id: link.id, before: link, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function addInitiativeRelation(
  engine: SyncEngine,
  parentInitiativeId: UUID,
  childInitiativeId: UUID,
): Promise<void> {
  const store = engine.store;
  if (store.initiativeChildIdsFor(parentInitiativeId).has(childInitiativeId)) return;

  const id = uuidv7();
  const provisional: EntityOf<'initiativeRelation'> = {
    id,
    workspaceId: store.workspaceId,
    parentInitiativeId,
    childInitiativeId,
    sortOrder: 'z',
    createdAt: new Date().toISOString(),
  };

  try {
    await engine.mutate<{
      addInitiativeRelation: { initiativeRelation: EntityOf<'initiativeRelation'> };
    }>({
      mutation: ADD_INITIATIVE_RELATION,
      variables: { parentInitiativeId, childInitiativeId },
      optimistic: [{ type: 'initiativeRelation', id, before: null, after: provisional }],
      reconcile: {
        type: 'initiativeRelation',
        provisionalId: id,
        path: ['addInitiativeRelation', 'initiativeRelation'],
        // One nest per parent/child pair, which the server treats as unique anyway.
        match: ['parentInitiativeId', 'childInitiativeId'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function removeInitiativeRelation(
  engine: SyncEngine,
  parentInitiativeId: UUID,
  childInitiativeId: UUID,
): Promise<void> {
  const store = engine.store;
  const link = [...store.initiativeRelations.values()].find(
    (row) =>
      row.parentInitiativeId === parentInitiativeId && row.childInitiativeId === childInitiativeId,
  );
  if (link === undefined) return;

  try {
    await engine.mutate({
      mutation: REMOVE_INITIATIVE_RELATION,
      variables: { parentInitiativeId, childInitiativeId },
      optimistic: [{ type: 'initiativeRelation', id: link.id, before: link, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
