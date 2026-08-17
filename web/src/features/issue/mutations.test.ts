/**
 * What crosses the GraphQL boundary, in both directions.
 *
 * `gql/enums.test.ts` proves the conversion functions are correct. This proves they are
 * *called* — which is the half that was actually wrong, and the half a unit test of a helper
 * can never reach. Every bug this file pins had a working converter available and simply did
 * not use it.
 *
 * Each case below is a defect that shipped:
 *
 *   - `createRelation` sent `"blocks"` for an argument declared `RelationType!`. GraphQL enum
 *     values are case-sensitive, so the server rejected the write outright.
 *   - The same call wrote the server's `"BLOCKS"` straight into the store, where every reader
 *     compares against `'blocks'`. The relation existed, was rendered nowhere, and came back
 *     correct only after a reload re-bootstrapped it from the sync stream.
 *   - `setRole` sent `"admin"` for `UserRole!`, so changing a member's role never worked —
 *     and the optimistic patch made it look as though it had, until the rollback landed.
 *   - `createStatus` did both at once for `StateCategory!`.
 *
 * They are tested here rather than in each feature's own file because they are one bug with
 * four faces, and splitting them up would lose the thing worth remembering: any mutation
 * whose argument or whose response mentions an enum has to go through `~/gql/enums`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setRole } from '~/features/members/mutations';
import { createStatus } from '~/features/team/mutations';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { createRelation } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const STATE = '01900000-0000-7000-8000-000000000003';
const ISSUE_A = '01900000-0000-7000-8000-00000000000a';
const ISSUE_B = '01900000-0000-7000-8000-00000000000b';
const USER = '01900000-0000-7000-8000-00000000000c';
const RELATION = '01900000-0000-7000-8000-00000000000d';

const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'Europe/Lisbon',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'user',
      {
        id: USER,
        workspaceId: WORKSPACE,
        name: 'Ana',
        role: 'member',
        status: 'active',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'workflowState',
      {
        id: STATE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'V',
        isDefault: true,
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    ['issue', issue(ISSUE_A, 1)],
    ['issue', issue(ISSUE_B, 2)],
  ];

  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function issue(id: string, number: number): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title: `Issue ${number}`,
    description: '',
    stateId: STATE,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

describe('createRelation', () => {
  let store: Store;
  let mutate: ReturnType<typeof vi.fn>;
  let engine: SyncEngine;

  beforeEach(() => {
    store = seeded();
    mutate = vi.fn();
    engine = { store, mutate } as unknown as SyncEngine;
  });

  it('sends the relation type in the schema’s spelling', async () => {
    mutate.mockResolvedValue({
      createIssueRelation: { relation: serverRelation('BLOCKS') },
    });

    await createRelation(engine, { issueId: ISSUE_A, relatedIssueId: ISSUE_B, type: 'blocks' });

    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      issueId: ISSUE_A,
      relatedIssueId: ISSUE_B,
      type: 'BLOCKS',
    });
  });

  it('stores the response in the replica’s spelling', async () => {
    mutate.mockResolvedValue({
      createIssueRelation: { relation: serverRelation('BLOCKS') },
    });

    await createRelation(engine, { issueId: ISSUE_A, relatedIssueId: ISSUE_B, type: 'blocks' });

    // The whole defect in one assertion: without the conversion this reads 'BLOCKS', which
    // is not equal to anything the relation panel or the filter grammar looks for, so the
    // row is in the store and on screen nowhere.
    expect(store.get('issueRelation', RELATION)?.type).toBe('blocks');
  });

  it('leaves the optimistic row in the replica’s spelling too', async () => {
    // Never resolves, so the optimistic patch is all there is — this is what the user sees
    // in the frame between the click and the response.
    mutate.mockReturnValue(new Promise(() => {}));

    void createRelation(engine, { issueId: ISSUE_A, relatedIssueId: ISSUE_B, type: 'blocks' });

    expect(mutate.mock.calls[0]?.[0].optimistic[0].after.type).toBe('blocks');
  });
});

describe('setRole', () => {
  it('sends the role in the schema’s spelling', async () => {
    const store = seeded();
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;

    await setRole(engine, USER, 'admin');

    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ userId: USER, role: 'ADMIN' });
    // The same value twice, in the two spellings: `ADMIN` on the wire, `admin` in the patch
    // that goes into the replica. Both are needed, and conflating them is the bug.
    expect(mutate.mock.calls[0]?.[0].optimistic[0].after.role).toBe('admin');
  });
});

describe('createStatus', () => {
  it('sends the category up and stores the response down', async () => {
    const store = seeded();
    const created = '01900000-0000-7000-8000-00000000000e';
    const mutate = vi.fn().mockResolvedValue({
      createWorkflowState: {
        state: {
          id: created,
          workspaceId: WORKSPACE,
          teamId: TEAM,
          name: 'In Review',
          category: 'STARTED',
          position: 'W',
          isDefault: false,
          isSystem: false,
          createdAt: AT,
          updatedAt: AT,
        },
      },
    });
    const engine = { store, mutate } as unknown as SyncEngine;

    await createStatus(engine, {
      teamId: TEAM,
      name: 'In Review',
      category: 'started',
      color: '#6b7280',
    });

    expect(mutate.mock.calls[0]?.[0].variables.input.category).toBe('STARTED');
    expect(store.get('workflowState', created)?.category).toBe('started');
  });
});

function serverRelation(type: string): Record<string, unknown> {
  return {
    id: RELATION,
    workspaceId: WORKSPACE,
    issueId: ISSUE_A,
    relatedIssueId: ISSUE_B,
    // Upper case, exactly as the server sends it.
    type,
    teamId: TEAM,
    relatedTeamId: TEAM,
    createdAt: AT,
  };
}
