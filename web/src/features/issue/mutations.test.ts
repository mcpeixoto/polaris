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
 *   - `createIssue` wrote the server's row into the store with its `null`s intact, where the
 *     client spells absence `undefined`. `archivedAt: null` reads as archived to
 *     `compileFilter` and to `IssueIndex`, so the issue somebody had just created vanished
 *     from the list they created it in — about half the time, because the socket delta for
 *     the same row carries it in the stream's spelling and whichever landed second won.
 *
 * They are tested here rather than in each feature's own file because they are one bug with
 * five faces, and splitting them up would lose the thing worth remembering: any mutation
 * whose argument or whose response reaches the store has to go through `~/gql/enums`, for the
 * case of its enums AND for the shape of its absences.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setRole } from '~/features/members/mutations';
import { createStatus } from '~/features/team/mutations';
import {
  Store,
  type Change,
  type Entity,
  type OptimisticPatch,
  type Reconciliation,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';
import { settle } from '~/sync/reconcile';

import { createIssue, createRelation, updateIssues } from './mutations';

/**
 * The one device preference these mutations read, held where a test can move it.
 *
 * `getPrefs` reads `localStorage`, and vitest's jsdom does not provide a working one — a
 * `setPrefs` call in a test is silently a no-op, which would make the auto-assign case below
 * pass for the wrong reason. Mocking the module is what makes the preference an input to the
 * test rather than an accident of the environment; everything else in the module is the real
 * thing, so no other caller changes behaviour.
 */
const prefs = vi.hoisted(() => ({ autoAssignOnStart: false }));
vi.mock('~/features/prefs/prefs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/prefs/prefs')>();
  return { ...actual, getPrefs: () => ({ ...actual.getPrefs(), ...prefs }) };
});

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
        cyclesEnabled: false,
        cycleDurationWeeks: 1,
        cycleCooldownWeeks: 0,
        cycleStartDay: 'monday',
        cycleUpcomingCount: 2,
        cycleAutoAddStarted: false,
        cycleAutoAddCompleted: false,
        triageEnabled: false,
        triageRequirePriority: false,
        autoCloseDays: 0,
        autoArchiveDays: 0,
        autoCloseParent: false,
        autoCloseChildren: false,
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
    const response = { createIssueRelation: { relation: serverRelation('BLOCKS') } };
    mutate.mockResolvedValue(response);

    await createRelation(engine, { issueId: ISSUE_A, relatedIssueId: ISSUE_B, type: 'blocks' });

    // `createRelation` no longer writes the response itself. It *declares* how the server's
    // row is to be paired with the stand-in, and the engine applies that — from the outbox
    // as well as from this call, which is what makes the pairing survive a reload taken
    // while the request is in flight. So the conversion is asserted where it now happens.
    const spec = mutate.mock.calls[0]?.[0].reconcile as Reconciliation;
    expect(spec.path).toEqual(['createIssueRelation', 'relation']);
    settle(store, spec, response);

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

    // The pairing is declared, not done after the await, so `settle` is what puts the
    // server's row in — from the outbox as readily as from this call. And it converts the
    // response's `STARTED` back to the spelling every reader in the client compares against.
    const spec = mutate.mock.calls[0]?.[0].reconcile as Reconciliation;
    expect(spec.path).toEqual(['createWorkflowState', 'state']);
    settle(store, spec, await mutate.mock.results[0]?.value);
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

describe('createIssue', () => {
  /**
   * The server's row, as GraphQL actually sends it: every optional field present and `null`.
   *
   * This is the whole defect. `IssueFields` asks for twenty-four fields and the server answers
   * all of them, so a freshly created issue comes back with `archivedAt`, `parentId`,
   * `assigneeId`, `estimate`, `dueDate` and four timestamps all spelled `null` — none of which
   * is `undefined`, which is what the client means by "not set".
   *
   * `id` is echoed from the request rather than minted here, because that is what the server
   * does: the client mints the id and sends it, which is what makes the response an upsert
   * over the optimistic row instead of a swap. A fixture that answered with an id of its own
   * would be testing a protocol this build does not speak.
   */
  function serverIssue(id: unknown): Record<string, unknown> {
    return {
      id,
      workspaceId: WORKSPACE,
      teamId: TEAM,
      number: 9,
      identifier: 'ENG-9',
      title: 'Made in the browser',
      description: '',
      stateId: STATE,
      assigneeId: null,
      creatorId: USER,
      priority: 0,
      sortOrder: 'V',
      estimate: null,
      dueDate: null,
      dueDateSource: 'MANUAL',
      parentId: null,
      subIssueSortOrder: null,
      templateId: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      archivedAt: null,
      createdAt: AT,
      updatedAt: AT,
    };
  }

  /** The engine, answering with the row the request asked to create. */
  function engineOver(store: Store): SyncEngine {
    const mutate = vi.fn(async (call: { variables: { input: { id: unknown } } }) => ({
      createIssue: { issue: serverIssue(call.variables.input.id) },
    }));
    return { store, mutate } as unknown as SyncEngine;
  }

  it('stores the response with its absences absent rather than null', async () => {
    const store = seeded();
    const engine = engineOver(store);

    const id = await createIssue(engine, { teamId: TEAM, title: 'Made in the browser' });

    // The row the server sent is now the row in the replica, under the client's own id.
    const stored = store.get('issue', id);
    expect(stored?.identifier).toBe('ENG-9');
    expect('archivedAt' in (stored as object)).toBe(false);
    expect('parentId' in (stored as object)).toBe(false);
    expect('assigneeId' in (stored as object)).toBe(false);
    expect('dueDate' in (stored as object)).toBe(false);
    // And the enum came down in the store's spelling, like every other response.
    expect(stored?.dueDateSource).toBe('manual');
  });

  it('leaves the new issue in the corpus every list is drawn from', async () => {
    const store = seeded();
    const engine = engineOver(store);

    const id = await createIssue(engine, { teamId: TEAM, title: 'Made in the browser' });

    // `active()` is the non-archived set, and `compileFilter` gates every unfiltered list on
    // the same question. A `null` archivedAt takes the issue out of both, which is what made
    // it disappear from the list it was created in — and stay gone across a reload, because
    // the null had been persisted to IndexedDB.
    expect(store.index.active().has(id)).toBe(true);
    expect(store.index.byTeam(TEAM).has(id)).toBe(true);
  });
});

/**
 * `updateIssues` and the reason it is not a loop any more.
 *
 * It sent one `updateIssue` per selected issue, and the comment above it said no bulk
 * mutation existed. One had existed since M1 opened, and the loop was quietly costing the
 * product acceptance test 8 in docs/07-milestones/01-milestone-1.md: every `updateIssue`
 * mints its own version block, the notification engine derives an inbox row's group key from
 * that block, so a watcher of two hundred issues moved in one action got two hundred inbox
 * rows rather than one saying "and 199 others". The server had the coalescing; nothing ever
 * called the mutation that would let it happen.
 *
 * These pin the four decisions that make batching safe to do from a click handler.
 */
describe('updateIssues', () => {
  const OTHER_STATE = '01900000-0000-7000-8000-0000000000f1';
  const STARTED_STATE = '01900000-0000-7000-8000-0000000000f2';
  const PROJECT = '01900000-0000-7000-8000-0000000000f3';

  function withStates(): Store {
    const store = seeded();
    const base = {
      workspaceId: WORKSPACE,
      teamId: TEAM,
      isDefault: false,
      isSystem: false,
      createdAt: AT,
      updatedAt: AT,
    };
    store.applyChanges([
      {
        v: 90,
        type: 'workflowState',
        id: OTHER_STATE,
        op: 'upsert',
        actor: { type: 'system' },
        payload: { ...base, id: OTHER_STATE, name: 'Done', category: 'completed', position: 'W' },
      },
      {
        v: 91,
        type: 'workflowState',
        id: STARTED_STATE,
        op: 'upsert',
        actor: { type: 'system' },
        payload: {
          ...base,
          id: STARTED_STATE,
          name: 'In Progress',
          category: 'started',
          position: 'X',
        },
      },
    ] as Change[]);
    return store;
  }

  /**
   * A `mutate` that applies the optimistic patch the way the real engine does.
   *
   * Without it the store never moves, and every assertion about what the user sees in the
   * frame they pressed the key in would be asserting on the seed.
   */
  function mutateInto(store: Store, response: unknown): ReturnType<typeof vi.fn> {
    return vi.fn((input: { optimistic?: OptimisticPatch }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      return Promise.resolve(response);
    });
  }

  function engineWith(store: Store, mutate: ReturnType<typeof vi.fn>): SyncEngine {
    return { store, mutate } as unknown as SyncEngine;
  }

  it('sends one bulkUpdateIssues for a selection rather than one write each', async () => {
    const store = withStates();
    const mutate = mutateInto(store, { bulkUpdateIssues: { skipped: [] } });

    await updateIssues(engineWith(store, mutate), [ISSUE_A, ISSUE_B], { stateId: OTHER_STATE });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { ids: [ISSUE_A, ISSUE_B], stateId: OTHER_STATE },
    });
    // Still optimistic, and for every row: a batch is what the user sees in the frame they
    // pressed the key in, not what they see when the response lands.
    expect(store.get('issue', ISSUE_A)?.stateId).toBe(OTHER_STATE);
    expect(store.get('issue', ISSUE_B)?.stateId).toBe(OTHER_STATE);
  });

  it('takes back only the rows the server said it skipped', async () => {
    const store = withStates();
    const mutate = mutateInto(store, {
      bulkUpdateIssues: { skipped: [{ id: ISSUE_B, reason: 'no such issue' }] },
    });

    await updateIssues(engineWith(store, mutate), [ISSUE_A, ISSUE_B], { stateId: OTHER_STATE });

    // A skipped id gets no delta, so nothing else is ever coming to correct it. Without the
    // revert the row sits there wearing a status the server refused to give it, until the
    // next bootstrap.
    expect(store.get('issue', ISSUE_A)?.stateId).toBe(OTHER_STATE);
    expect(store.get('issue', ISSUE_B)?.stateId).toBe(STATE);
  });

  it('splits the selection when auto-assign applies to some of it and not the rest', async () => {
    const store = withStates();
    // ISSUE_B already has an owner; ISSUE_A has none. Moving both into a started status with
    // the habit switched on is two different writes, and flattening them into one would take
    // ISSUE_B away from whoever holds it.
    store.applyChanges([
      {
        v: 92,
        type: 'issue',
        id: ISSUE_B,
        op: 'upsert',
        actor: { type: 'system' },
        payload: { ...(store.get('issue', ISSUE_B) as object), assigneeId: USER },
      },
    ] as Change[]);
    prefs.autoAssignOnStart = true;

    const mutate = mutateInto(store, { bulkUpdateIssues: { skipped: [] } });
    await updateIssues(
      engineWith(store, mutate),
      [ISSUE_A, ISSUE_B],
      { stateId: STARTED_STATE },
      USER,
    );

    // Two batches of one, so two single-issue writes. Neither is a bulk call, because a
    // batch of one is a wrapper around a write that already exists.
    expect(mutate.mock.calls.map((call) => call[0].variables)).toEqual([
      { input: { id: ISSUE_A, stateId: STARTED_STATE, assigneeId: USER } },
      { input: { id: ISSUE_B, stateId: STARTED_STATE } },
    ]);
  });

  it('falls back to one write each for a field the bulk input cannot express', async () => {
    const store = withStates();
    const mutate = mutateInto(store, {});

    // `BulkUpdateIssuesInput` carries no project, so this is still N mutations —
    // deliberately, rather than silently dropping the field on the floor.
    await updateIssues(engineWith(store, mutate), [ISSUE_A, ISSUE_B], { projectId: PROJECT });

    expect(mutate.mock.calls.map((call) => call[0].variables)).toEqual([
      { input: { id: ISSUE_A, projectId: PROJECT } },
      { input: { id: ISSUE_B, projectId: PROJECT } },
    ]);
  });

  it('leaves out the issues the change would not move, and writes nothing for none', async () => {
    const store = withStates();
    const mutate = mutateInto(store, { bulkUpdateIssues: { skipped: [] } });
    const engine = engineWith(store, mutate);

    // Both are already in STATE. Sending them would bump two versions and wake every client
    // in the workspace to deliver a change that changed nothing.
    await updateIssues(engine, [ISSUE_A, ISSUE_B], { stateId: STATE });
    expect(mutate).not.toHaveBeenCalled();

    await updateIssues(engine, [ISSUE_A, ISSUE_B], { priority: 2 });
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { ids: [ISSUE_A, ISSUE_B], priority: 2 },
    });
  });
});
