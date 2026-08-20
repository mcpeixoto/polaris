import { fromWire, toWire } from '~/gql/enums';
import type { FilterNode } from '~/filter';
import { uuidv7, type EntityOf, type EntityPatch, type Issue, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { CLEAR_ISSUE_SLA, CREATE_SLA_RULE, DELETE_SLA_RULE, SET_ISSUE_SLA } from './operations';

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
    });
    const real = fromWire('slaRule', data.createSlaRule.slaRule as EntityOf<'slaRule'>);
    const patch: EntityPatch[] = [
      { type: 'slaRule', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'slaRule', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
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
