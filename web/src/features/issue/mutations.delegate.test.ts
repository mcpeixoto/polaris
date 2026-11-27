/**
 * Setting and clearing a delegate, which is the agent working an issue.
 *
 * The assignee stays the owner. A delegate is a separate column, and it has the same
 * wire problem the assignee has: a null id in a partial update means "leave it alone",
 * so taking the agent off is `clearDelegate` rather than `delegateId: null`. The
 * optimistic row is what the property rail shows in the frame of the click, which is
 * why both halves are asserted — a payload that is right and a store that did not move
 * is a click that appears to have missed.
 */

import { describe, expect, it, vi } from 'vitest';

import { Store, type Change, type Entity, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { updateIssues } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const STATE = '01900000-0000-7000-8000-000000000003';
const ISSUE = '01900000-0000-7000-8000-00000000000a' as UUID;
const AGENT = '01900000-0000-7000-8000-00000000000e' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

function storeWith(delegateId?: UUID): Store {
  const store = new Store(WORKSPACE);
  const issue: Entity = {
    id: ISSUE,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the importer',
    description: '',
    stateId: STATE,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    ...(delegateId === undefined ? null : { delegateId }),
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
  store.applyChanges([
    {
      v: 1,
      type: 'issue',
      id: ISSUE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: issue,
    },
  ] as Change[]);
  return store;
}

/** Applies the optimistic patch, which is what the real engine does before the response. */
function engineOver(store: Store) {
  // The return type is the loose mock, so the assertion can read `variables`. A parameter
  // type that only names `optimistic` hides every other field the call actually carries.
  const mutate: ReturnType<typeof vi.fn> = vi.fn((input: { optimistic?: OptimisticPatch }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return Promise.resolve({});
  });
  const engine = { store, mutate } as unknown as SyncEngine;
  return { engine, mutate };
}

describe('updateIssues delegate', () => {
  it('patches the delegate onto the issue and sends delegateId', async () => {
    const store = storeWith();
    const { engine, mutate } = engineOver(store);

    await updateIssues(engine, [ISSUE], { delegateId: AGENT });

    expect(store.get('issue', ISSUE)?.delegateId).toBe(AGENT);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: ISSUE, delegateId: AGENT },
    });
  });

  it('clears the delegate with clearDelegate and takes it off the row', async () => {
    const store = storeWith(AGENT);
    const { engine, mutate } = engineOver(store);

    await updateIssues(engine, [ISSUE], { delegateId: null });

    // Absence, not null: the replica spells "nobody" by leaving the field out, and a
    // null left behind would read as a delegate to every filter that checks for one.
    expect(store.get('issue', ISSUE)?.delegateId).toBeUndefined();
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: ISSUE, clearDelegate: true },
    });
  });
});
