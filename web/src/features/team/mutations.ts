/**
 * Team settings writes: the team itself, and its workflow statuses.
 *
 * These go through `engine.mutate` like every other change in the product, and for the same
 * reason — the outbox, the idempotency key, the optimistic patch — but the balance between
 * optimism and honesty is struck differently here than in the issue list. A status rename or
 * a reorder is applied locally at once, because it is a keystroke-scale edit whose only
 * plausible failure is a duplicate name. Archiving a status is not: the server refuses while
 * issues still sit in it, that refusal is common and it is the whole answer the user needs,
 * so it waits for the reply and reports what came back rather than making a status vanish
 * and reappear with an explanation in the console.
 *
 * Reordering deserves its own note. The API can only say "put this status after that one" —
 * there is no way to express "put it first", because positions are fractional indices minted
 * between two neighbours and there is no neighbour before the first. Moving something *up* is
 * therefore sent as moving the status above it *down*, which is the same swap and is always
 * expressible. See `moveStatus`.
 */

import { toWire } from '~/gql/enums';
import {
  ARCHIVE_WORKFLOW_STATE,
  CREATE_WORKFLOW_STATE,
  UPDATE_TEAM,
  UPDATE_WORKFLOW_STATE,
} from '~/gql/operations';
import {
  uuidv7,
  type EntityPatch,
  type StateCategory,
  type Team,
  type UUID,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

export interface TeamFields {
  readonly name?: string | undefined;
  /** The prefix in every identifier the team owns. Renaming it renames sixty thousand issues. */
  readonly key?: string | undefined;
  readonly private?: boolean | undefined;
  /** IANA zone due dates and cycle midnights are reckoned in. */
  readonly timezone?: string | undefined;
}

/**
 * Renames a team, or changes its key.
 *
 * The key is applied optimistically along with everything else, and that is the interesting
 * half: identifiers are derived from the team's key rather than stored on the issue, so one
 * patch to one row re-labels every issue in the team on the next frame. It is also why this
 * awaits its result — a key collides with another team's about as often as anyone tries — and
 * hands the failure back for the screen to show.
 */
export async function updateTeam(
  engine: SyncEngine,
  teamId: UUID,
  fields: TeamFields,
): Promise<void> {
  const before = engine.store.get('team', teamId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const key = fields.key?.trim().toUpperCase();
  const after: Team = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(key === undefined || key === '' ? null : { key }),
    ...(fields.private === undefined ? null : { private: fields.private }),
    ...(fields.timezone === undefined || fields.timezone === ''
      ? null
      : { timezone: fields.timezone }),
    updatedAt: new Date().toISOString(),
  };
  if (
    after.name === before.name &&
    after.key === before.key &&
    after.private === before.private &&
    after.timezone === before.timezone
  )
    return;

  await engine.mutate({
    mutation: UPDATE_TEAM,
    variables: {
      input: {
        id: teamId,
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.key === before.key ? null : { key: after.key }),
        ...(after.private === before.private ? null : { private: after.private }),
        ...(after.timezone === before.timezone ? null : { timezone: after.timezone }),
      },
    },
    optimistic: [{ type: 'team', id: teamId, before, after }],
  });
}

export interface StatusFields {
  readonly name?: string | undefined;
  readonly color?: string | undefined;
  /** Makes this the status new issues are born in. Only legal for backlog and unstarted. */
  readonly makeDefault?: boolean | undefined;
}

/**
 * Renames, recolours, or promotes a status to the team's default.
 *
 * The default is exclusive, so promoting one demotes the other in the same patch. Sending
 * only the promotion would leave two statuses drawn as the default until the server's delta
 * arrived to settle the argument.
 */
export async function updateStatus(
  engine: SyncEngine,
  stateId: UUID,
  fields: StatusFields,
): Promise<void> {
  const store = engine.store;
  const before = store.get('workflowState', stateId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: WorkflowState = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.color === undefined ? null : { color: fields.color }),
    ...(fields.makeDefault === true ? { isDefault: true } : null),
    updatedAt: new Date().toISOString(),
  };

  const patch: EntityPatch[] = [{ type: 'workflowState', id: stateId, before, after }];
  if (fields.makeDefault === true) {
    for (const id of store.workflowStateIdsFor(before.teamId)) {
      const other = store.get('workflowState', id);
      if (other === undefined || other.id === stateId || !other.isDefault) continue;
      patch.push({
        type: 'workflowState',
        id: other.id,
        before: other,
        after: { ...other, isDefault: false },
      });
    }
  }

  await engine.mutate({
    mutation: UPDATE_WORKFLOW_STATE,
    variables: {
      input: {
        id: stateId,
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.color === before.color ? null : { color: after.color }),
        ...(fields.makeDefault === true ? { makeDefault: true } : null),
      },
    },
    optimistic: patch,
  });
}

/**
 * Moves a status one place within its category.
 *
 * `siblings` is the category's statuses in the order they are displayed, which the caller
 * already has — recomputing it here would mean sorting the team's statuses twice for one
 * click.
 *
 * The optimistic patch swaps the two positions rather than minting a new fractional index.
 * That is not a shortcut: the client has no business inventing keys in the space the server
 * owns, and a swap produces exactly the order the reorder is asking for, which is the only
 * thing on screen. The server's real key arrives moments later and changes nothing visible.
 */
export async function moveStatus(
  engine: SyncEngine,
  siblings: readonly UUID[],
  stateId: UUID,
  delta: 1 | -1,
): Promise<void> {
  const store = engine.store;
  const at = siblings.indexOf(stateId);
  if (at === -1) return;
  const neighbourId = siblings[at + delta];
  if (neighbourId === undefined) return;

  // Down is "put me after my next sibling"; up is "put my previous sibling after me". Both
  // are the same exchange, and only one of the two can be said to an API whose sole
  // positioning verb is `afterStateId`.
  const [movedId, anchorId] = delta > 0 ? [stateId, neighbourId] : [neighbourId, stateId];
  const moved = store.get('workflowState', movedId);
  const anchor = store.get('workflowState', anchorId);
  if (moved === undefined || anchor === undefined) return;

  await engine.mutate({
    mutation: UPDATE_WORKFLOW_STATE,
    variables: { input: { id: movedId, afterStateId: anchorId } },
    optimistic: [
      {
        type: 'workflowState',
        id: movedId,
        before: moved,
        after: { ...moved, position: anchor.position },
      },
      {
        type: 'workflowState',
        id: anchorId,
        before: anchor,
        after: { ...anchor, position: moved.position },
      },
    ],
  });
}

export interface NewStatus {
  readonly teamId: UUID;
  readonly name: string;
  readonly category: StateCategory;
  readonly color: string;
}

/**
 * Adds a status at the end of its category.
 *
 * The local row is a stand-in under an id the server did not mint, paired with the real one
 * by the `reconcile` below rather than by anything after the `await`. See
 * `web/src/sync/reconcile.ts` for why that distinction is the whole of it.
 */
export async function createStatus(engine: SyncEngine, input: NewStatus): Promise<void> {
  const store = engine.store;
  const now = new Date().toISOString();
  const provisional: WorkflowState = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    name: input.name,
    color: input.color,
    category: input.category,
    position: lastPositionIn(engine, input.teamId, input.category),
    isDefault: false,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  };

  await engine.mutate<{ createWorkflowState: { state: WorkflowState } }>({
    mutation: CREATE_WORKFLOW_STATE,
    variables: {
      input: {
        teamId: input.teamId,
        name: input.name,
        // `toWire`: the field is declared `StateCategory!`, whose values are `TRIAGE`,
        // `BACKLOG`, … A GraphQL enum value is case-sensitive, so the store's spelling was a
        // value the server could only reject — creating a status did not work at all. See
        // web/src/gql/enums.ts.
        category: toWire(input.category),
        color: input.color,
      },
    },
    optimistic: [{ type: 'workflowState', id: provisional.id, before: null, after: provisional }],
    // And back the other way: the response spells the category in upper case, while every
    // reader in the client compares against the lower-case union — which `settle` does,
    // through `fromWire`, wherever it runs the pairing from.
    reconcile: {
      type: 'workflowState',
      provisionalId: provisional.id,
      path: ['createWorkflowState', 'state'],
      // And from the delta stream, which usually gets here first — the socket pushes the
      // row the moment the mutation commits, while the response is still travelling back.
      // A team's statuses are named uniquely by hand.
      match: ['teamId', 'name'],
    },
  });
}

/**
 * Retires a status, and waits to find out whether it was allowed to.
 *
 * Deliberately not optimistic. The server refuses while issues still sit in the status —
 * because the alternatives are orphaning them or moving them somewhere nobody chose — and
 * that refusal is the common case rather than the exception. A status that vanished and came
 * back would be a puzzle; a status that stays put with "move its issues out first" beside it
 * is an instruction.
 */
export async function archiveStatus(engine: SyncEngine, stateId: UUID): Promise<void> {
  // `archived` is required by the schema and was not being sent, so this mutation was
  // rejected at validation on every call and retiring a status had never once worked. It
  // failed the way a missing argument does — before any resolver ran, with a message about
  // the shape of the document rather than about statuses — which is indistinguishable from
  // the refusal this function is written to expect, and that is why nobody noticed.
  //
  // Passed as `true` rather than taken as a parameter because there is no un-archive on any
  // screen yet. The server takes a boolean and would restore a status happily; when
  // something offers that, this signature is where it goes.
  await engine.mutate({
    mutation: ARCHIVE_WORKFLOW_STATE,
    variables: { id: stateId, archived: true },
  });
}

/**
 * A position after every existing status in the category.
 *
 * Fractional indices compare as plain strings, so extending the current maximum sorts after
 * all of them whatever they look like. It never leaves this machine — the server mints the
 * real key — so it only has to be right for the moment it is on screen.
 */
function lastPositionIn(engine: SyncEngine, teamId: UUID, category: StateCategory): string {
  let highest = '';
  for (const id of engine.store.workflowStateIdsFor(teamId)) {
    const state = engine.store.get('workflowState', id);
    if (state === undefined || state.category !== category) continue;
    if (state.position > highest) highest = state.position;
  }
  return `${highest}z`;
}
