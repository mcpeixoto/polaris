import { fromWire, toWire } from '~/gql/enums';
import type { FilterNode } from '~/filter';
import { byOrderKey, orderKeyBetween, uuidv7, type EntityOf, type Issue, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  CLEAR_ISSUE_SLA,
  CREATE_SLA_RULE,
  DELETE_SLA_RULE,
  SET_ISSUE_SLA,
  UPDATE_SLA_RULE,
} from './operations';

type SlaRule = EntityOf<'slaRule'>;

export interface NewSlaRule {
  readonly filter: FilterNode;
  readonly action: SlaRule['action'];
  readonly durationMinutes?: number | undefined;
}

export async function createSlaRule(engine: SyncEngine, input: NewSlaRule): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: SlaRule = {
    id,
    workspaceId: store.workspaceId,
    position: 'z',
    filter: input.filter,
    action: input.action,
    ...(input.durationMinutes === undefined ? null : { durationMinutes: input.durationMinutes }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createSlaRule: { slaRule: SlaRule } }>({
      mutation: CREATE_SLA_RULE,
      variables: {
        input: {
          filter: input.filter,
          action: toWire(input.action),
          ...(input.durationMinutes === undefined
            ? null
            : { durationMinutes: input.durationMinutes }),
        },
      },
      optimistic: [{ type: 'slaRule', id, before: null, after: provisional }],
      reconcile: {
        type: 'slaRule',
        provisionalId: id,
        path: ['createSlaRule', 'slaRule'],
        // And from the delta stream, which on a loaded machine arrives first: the socket
        // pushes the row the moment the mutation commits while the response is still being
        // parsed. Without a match the stand-in sits beside it until `settle` runs, and
        // "Load defaults" — three creates chained one after another — shows a rule twice for
        // as long as that takes. Action and duration, because the third field is a filter
        // object and `adopt` compares with `===`.
        match: ['action', 'durationMinutes'],
      },
    });
    return data.createSlaRule.slaRule.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

/**
 * Moves a rule to sit immediately after another one.
 *
 * Order is the whole behaviour here — first match wins — so until this existed the only way
 * to change which rule owned an issue's due date was to delete the set and retype it in a
 * different sequence.
 *
 * It is expressed as "put this one after that one" because that is the only thing the server
 * accepts: `UpdateSlaRuleInput` takes an `afterId` and mints the real position from it, and
 * there is no way to say "move to the top". A caller wanting to raise a rule therefore lowers
 * the rule above it instead, which is the same permutation and asks nothing new of the API.
 *
 * The optimistic position is minted locally with `orderKeyBetween` so the list reorders on
 * the keystroke rather than a round trip later; the server's own key arrives in the delta and
 * replaces it. The two need not agree on the string, only on the order. See `reorderIssue`,
 * which is the same trade for the same reason.
 */
export async function moveSlaRule(engine: SyncEngine, id: UUID, afterId: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('slaRule', id);
  if (before === undefined || afterId === id) return;

  const ordered = [...store.slaRules.values()].sort(byOrderKey('position'));
  const anchorAt = ordered.findIndex((rule) => rule.id === afterId);
  if (anchorAt === -1) return;
  // The rule the moved one lands in front of — skipping itself, because a rule already
  // sitting in that gap is not one of its own neighbours.
  const following = ordered.slice(anchorAt + 1).find((rule) => rule.id !== id);
  const position = orderKeyBetween(ordered[anchorAt]!.position, following?.position ?? '');
  if (position === null || position === before.position) return;

  const after: SlaRule = { ...before, position, updatedAt: new Date().toISOString() };
  try {
    await engine.mutate({
      mutation: UPDATE_SLA_RULE,
      variables: { input: { id, afterId } },
      optimistic: [{ type: 'slaRule', id, before, after }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteSlaRule(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('slaRule', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: DELETE_SLA_RULE,
      variables: { id },
      optimistic: [{ type: 'slaRule', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function setIssueSla(
  engine: SyncEngine,
  issueId: UUID,
  durationMinutes: number,
): Promise<void> {
  const before = engine.store.get('issue', issueId);
  if (before === undefined) return;
  const due = new Date(Date.now() + durationMinutes * 60_000);
  const after: Issue = {
    ...before,
    dueDate: due.toISOString().slice(0, 10),
    dueDateSource: 'sla',
    updatedAt: new Date().toISOString(),
  };
  try {
    const data = await engine.mutate<{ setIssueSla: { issue: Issue } }>({
      mutation: SET_ISSUE_SLA,
      variables: { input: { issueId, durationMinutes } },
      optimistic: [{ type: 'issue', id: issueId, before, after }],
    });
    const real = fromWire('issue', data.setIssueSla.issue as EntityOf<'issue'>);
    engine.store.applyOptimistic([{ type: 'issue', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function clearIssueSla(engine: SyncEngine, issueId: UUID): Promise<void> {
  const before = engine.store.get('issue', issueId);
  if (before === undefined || before.dueDateSource !== 'sla') return;
  const after: Issue = {
    ...before,
    dueDate: undefined,
    dueDateSource: 'manual',
    updatedAt: new Date().toISOString(),
  };
  try {
    const data = await engine.mutate<{ clearIssueSla: { issue: Issue } }>({
      mutation: CLEAR_ISSUE_SLA,
      variables: { issueId },
      optimistic: [{ type: 'issue', id: issueId, before, after }],
    });
    const real = fromWire('issue', data.clearIssueSla.issue as EntityOf<'issue'>);
    engine.store.applyOptimistic([{ type: 'issue', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export const DEFAULT_SLA_RULES: readonly NewSlaRule[] = [
  {
    filter: { field: 'priority', op: 'eq', values: ['1'] },
    action: 'apply',
    durationMinutes: 1440,
  },
  {
    filter: { field: 'priority', op: 'eq', values: ['2'] },
    action: 'apply',
    durationMinutes: 10080,
  },
  {
    filter: { field: 'priority', op: 'in', values: ['0', '3', '4'] },
    action: 'remove',
  },
];
