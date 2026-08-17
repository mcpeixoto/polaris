/**
 * Every write the label surfaces make, with the optimistic patch that goes with it.
 *
 * The shape is the same bargain `features/issue/mutations` strikes: compute what the change
 * looks like locally, hand it to `engine.mutate` with the mutation, and return. The store
 * applies the patch synchronously, the picker and the issue row re-render inside the frame,
 * and the network happens afterwards to somebody else's schedule.
 *
 * What is specific to labels, and the reason this file exists at all rather than three
 * helpers next to their components:
 *
 * **An application is one row.** Adding a label is an upsert of a single `issueLabel` and
 * removing one is a delete of a single `issueLabel`. Nothing here ever writes "the issue's
 * labels" as a set, and nothing here should be given a variadic form that does. A set
 * written whole loses writes — two people adding different labels a second apart both send
 * the new set and the second overwrites the first — and the entity exists precisely so that
 * both survive with no merge logic anywhere. There is a store test asserting exactly that.
 *
 * **The database owns three rules the client cannot re-derive**: one label per group per
 * issue, a team's label only on that team's issues, and a group is never applicable. The
 * screens keep the user away from all three rather than letting the server refuse, which is
 * what `applyLabel` and the picker's filtering are for — but the rules live in Postgres and
 * this file does not restate them.
 *
 * On failure: `engine.mutate` reverts the patch when the server rejects a write and leaves
 * it standing when the request never left the building. Everything here still rejects, so a
 * caller with somewhere to put an error can use it; the rest pass `report` from the issue
 * mutations, which is the one console line the M0 shell can offer.
 */

import { fromWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityPatch,
  type IssueLabel,
  type Label,
  type Store,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_ISSUE_LABEL,
  ARCHIVE_LABEL,
  CREATE_LABEL,
  REMOVE_ISSUE_LABEL,
  UPDATE_LABEL,
} from './operations';

export interface NewLabel {
  readonly name: string;
  /** Absent makes it a workspace label, offered in every team. */
  readonly teamId?: UUID | undefined;
  /** The group to create it in. A group and its labels must share one scope. */
  readonly parentId?: UUID | undefined;
  /** Makes it a container, which can never itself be applied to an issue. */
  readonly isGroup?: boolean | undefined;
  readonly color?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Creates a label and returns the id it has locally.
 *
 * The id is the server's, not the client's: `CreateLabelInput` has no `id` field, so the
 * local row is a stand-in swapped for the real one when the reply lands — the same trade
 * `createStatus` makes, and for the same reason it is acceptable here. A label is created on
 * a settings screen by somebody who is watching, not queued behind an hour of tunnel, so the
 * one case where the stand-in is visible for longer than a frame is rare and self-heals on
 * the next delta.
 */
export async function createLabel(engine: SyncEngine, input: NewLabel): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const now = new Date().toISOString();
  const provisional: Label = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    teamId: input.teamId,
    parentId: input.parentId,
    isGroup: input.isGroup === true,
    name,
    description: input.description,
    // Left to the server when the caller has no opinion: the column's default is the
    // product's grey, and inventing a different one here would make a label created from
    // this screen a different colour from one created through the API.
    color: input.color ?? DEFAULT_LABEL_COLOR,
    position: lastPositionIn(store, input.teamId),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createLabel: { label: Label } }>({
    mutation: CREATE_LABEL,
    variables: {
      input: {
        name,
        ...(input.teamId === undefined ? null : { teamId: input.teamId }),
        ...(input.parentId === undefined ? null : { parentId: input.parentId }),
        ...(input.isGroup === true ? { isGroup: true } : null),
        ...(input.color === undefined ? null : { color: input.color }),
        ...(input.description === undefined || input.description === ''
          ? null
          : { description: input.description }),
      },
    },
    optimistic: [{ type: 'label', id: provisional.id, before: null, after: provisional }],
  });

  const real = data.createLabel.label;
  swapLabel(store, provisional.id, real);
  return real.id;
}

export interface LabelFields {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly color?: string | undefined;
  /**
   * The group to move it into. `null` lifts it out of the one it is in, which is a separate
   * case from `undefined` — in a partial update a null parent is indistinguishable from
   * "leave the group alone", which is why the API carries a `clearParent` flag.
   */
  readonly parentId?: UUID | null | undefined;
}

/**
 * Renames, recolours or regroups a label.
 *
 * Applied before the server answers, because every one of those edits is keystroke-scale and
 * its only plausible failure is a duplicate name in one scope. A label's *scope* is not here
 * and cannot be: moving a team label to the workspace would hand every team a label they
 * never agreed to, and moving one the other way would unapply it from every other team's
 * issues without saying so. The server refuses it; the screen does not offer it.
 */
export async function updateLabel(
  engine: SyncEngine,
  labelId: UUID,
  fields: LabelFields,
): Promise<void> {
  const before = engine.store.get('label', labelId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: Label = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.color === undefined ? null : { color: fields.color }),
    ...(fields.parentId === undefined
      ? null
      : { parentId: fields.parentId === null ? undefined : fields.parentId }),
    updatedAt: new Date().toISOString(),
  };
  if (sameLabel(before, after)) return;

  await engine.mutate({
    mutation: UPDATE_LABEL,
    variables: {
      input: {
        id: labelId,
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.description === before.description ? null : { description: after.description }),
        ...(after.color === before.color ? null : { color: after.color }),
        ...(fields.parentId === undefined
          ? null
          : fields.parentId === null
            ? { clearParent: true }
            : { parentId: fields.parentId }),
      },
    },
    optimistic: [{ type: 'label', id: labelId, before, after }],
  });
}

/**
 * Retires a label, and waits to find out whether it was allowed to.
 *
 * Deliberately not optimistic, exactly as archiving a workflow status is not. The server
 * refuses while any issue still carries the label, and while a group still holds labels, and
 * both refusals are the common case rather than the exception — somebody archives a label
 * *because* it is in use and has to be told how much work removing it first would be. A
 * label that vanished and came back would be a puzzle; one that stays put with "forty issues
 * still carry this" beside it is an instruction.
 *
 * There is also no optimistic patch that would be honest. Locally a label's deletion cascades
 * to every application of it, and reverting a rejected write restores the label alone — so an
 * optimistic archive that failed would leave the issues it was applied to permanently
 * unlabelled until the next full sync.
 */
export async function archiveLabel(engine: SyncEngine, labelId: UUID): Promise<void> {
  await engine.mutate({ mutation: ARCHIVE_LABEL, variables: { id: labelId } });
}

/**
 * Applies one label to one issue: one row, one mutation.
 *
 * Re-applying a label already on the issue is a no-op rather than a second row. The picker
 * toggles, so a double press is an ordinary thing to do, and the database's own uniqueness
 * rule would turn the second one into an error message about something the user cannot see.
 */
export async function addLabel(engine: SyncEngine, issueId: UUID, labelId: UUID): Promise<void> {
  const store = engine.store;
  const issue = store.get('issue', issueId);
  if (issue === undefined) return;
  if (store.labelIdsFor(issueId).has(labelId)) return;

  const provisional: IssueLabel = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    issueId,
    labelId,
    // The issue's team, never the label's: a workspace label carries no team, and the
    // application is scoped to the issue it is on.
    teamId: issue.teamId,
    groupId: store.get('label', labelId)?.parentId,
    createdAt: new Date().toISOString(),
  };

  try {
    const data = await engine.mutate<{ addIssueLabel: { issueLabel: IssueLabel } }>({
      mutation: ADD_ISSUE_LABEL,
      variables: { issueId, labelId },
      optimistic: [{ type: 'issueLabel', id: provisional.id, before: null, after: provisional }],
    });
    swapApplication(store, provisional.id, data.addIssueLabel.issueLabel);
  } catch (error) {
    // Queued rather than refused. The chip is on the issue, the outbox holds the mutation,
    // and the row the server eventually mints replaces the stand-in on the next delta — the
    // same trade a posted comment makes, and acceptable for the same reason: an id the
    // client cannot mint is the only thing that is provisional about it.
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** Unapplies one label: the delete of the single row that recorded it. */
export async function removeLabel(engine: SyncEngine, issueId: UUID, labelId: UUID): Promise<void> {
  const store = engine.store;
  const before = applicationOf(store, issueId, labelId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: REMOVE_ISSUE_LABEL,
    variables: { issueId, labelId },
    optimistic: [{ type: 'issueLabel', id: before.id, before, after: null }],
  });
}

/**
 * Applies a label, taking off the group-mate it displaces.
 *
 * At most one label from a group may sit on an issue, and the database enforces it. That
 * leaves two possible interactions and only one of them is a product: refuse the second
 * choice and make the user work out that "Priority: P1" is in the way, or replace. This
 * replaces — which is why the picker hands the displaced ids back rather than the caller
 * having to work them out.
 *
 * The removals go first, and one at a time. An add sent before its group-mate's removal has
 * landed is exactly the write the uniqueness rule rejects, so firing them together would
 * reintroduce the refusal this function exists to avoid. Offline they are queued in this
 * order and the outbox replays them in it, which is why an offline failure carries on rather
 * than abandoning the add: the user's intent is "P1, not P0", and half of it is worse than
 * neither.
 */
export async function applyLabel(
  engine: SyncEngine,
  issueId: UUID,
  labelId: UUID,
  displaced: readonly UUID[] = [],
): Promise<void> {
  for (const id of displaced) {
    try {
      await removeLabel(engine, issueId, id);
    } catch (error) {
      if (!(error instanceof ApiError && error.isOffline)) throw error;
    }
  }
  await addLabel(engine, issueId, labelId);
}

/**
 * What a new label is coloured until somebody chooses otherwise.
 *
 * A literal, and it has to be: a label's colour is *data* — written to the row, sent over the
 * wire, rendered by every client — so it cannot be a design token, because a theme is a list
 * of custom properties and there is no custom property that survives being stored in
 * Postgres. This is the column's own default, so a label added here and a label added through
 * the API are the same grey rather than two greys somebody has to notice.
 */
export const DEFAULT_LABEL_COLOR = '#6b7280';

/** The `issueLabel` row recording one label on one issue, if it is there. */
function applicationOf(store: Store, issueId: UUID, labelId: UUID): IssueLabel | undefined {
  for (const rowId of store.issueLabelIdsFor(issueId)) {
    const row = store.get('issueLabel', rowId);
    if (row !== undefined && row.labelId === labelId) return row;
  }
  return undefined;
}

/**
 * Puts the server's row in place of the stand-in, in one store write.
 *
 * One write rather than two because every subscribed row re-renders between them otherwise,
 * and a chip that disappears for a frame on its way to being replaced by itself is the exact
 * flicker an optimistic add is supposed to prevent.
 */
function swapApplication(store: Store, provisionalId: UUID, wire: IssueLabel): void {
  // Neither of these two entities carries an enumerated field today, so `fromWire` returns
  // its argument untouched. It is here anyway, so that "a response goes through fromWire
  // before it reaches the store" is a rule with no exceptions to remember — the exceptions
  // are what let `"BLOCKS"` into the store in the first place. See web/src/gql/enums.ts.
  const real = fromWire('issueLabel', wire);
  const patch: EntityPatch[] = [
    {
      type: 'issueLabel',
      id: real.id,
      before: store.get('issueLabel', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'issueLabel', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

/** The same swap for a created label. See `swapApplication`. */
function swapLabel(store: Store, provisionalId: UUID, wire: Label): void {
  const real = fromWire('label', wire);
  const patch: EntityPatch[] = [
    { type: 'label', id: real.id, before: store.get('label', real.id) ?? null, after: real },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'label', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

/**
 * A position after every label in the same scope.
 *
 * Fractional indices compare as plain strings, so extending the current maximum sorts after
 * all of them whatever they look like. It never leaves this machine — the server mints the
 * real key — so it only has to order correctly for the moment it is on screen. Scope matters:
 * positions are minted per workspace or per team and are not comparable across the two.
 */
function lastPositionIn(store: Store, teamId: UUID | undefined): string {
  let highest = '';
  for (const label of store.labels.values()) {
    if (label.teamId !== teamId) continue;
    if (label.position > highest) highest = label.position;
  }
  return `${highest}z`;
}

/** Whether an update would change anything, so a colour input re-emitting its value is free. */
function sameLabel(before: Label, after: Label): boolean {
  return (
    before.name === after.name &&
    before.description === after.description &&
    before.color === after.color &&
    before.parentId === after.parentId
  );
}
