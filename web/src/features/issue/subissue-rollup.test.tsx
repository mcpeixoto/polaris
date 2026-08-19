import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { updateIssue } from './mutations';
import { SubIssues } from './relations';

/**
 * Acceptance test 4 in docs/07-milestones/01-milestone-1.md:
 *
 *     A sub-issue's completion updates its parent's progress with no extra round trip.
 *
 * The existing coverage in relations.test.tsx proves that the ring redraws when a completed
 * child arrives as a delta, and asserts that `mutate` was not called. That is a true fact
 * and it is not this criterion: nothing in that test could have called a mutation, so the
 * negative assertion had nothing to rule out. What the criterion is about is the path a
 * person actually takes — they change the child's status, one write goes out, and the
 * parent's bar moves without a second one.
 *
 * So the difference here is that the child is completed through `updateIssue`, the real
 * mutation the status menu calls, against an engine that counts what it is asked to send.
 * "No extra round trip" then has something to be extra to.
 */

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const PARENT = 'i-parent';
const TODO = 's-todo';
const DONE = 's-done';
const AT = '2026-01-01T00:00:00Z';

function team(): Team {
  return {
    id: ENG,
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
  };
}

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: ENG,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(id: string, number: number, title: string, extras: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: ENG,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...extras,
  };
}

type Seed = readonly [string, { id: string }][];

function seeded(entities: Seed): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

/**
 * An engine that applies the optimistic patch and counts the calls, which is what makes the
 * round trip countable.
 *
 * It deliberately does NOT deliver a delta afterwards. A server echo would move the ring
 * whether or not the local write did, and the whole claim is that the local write is enough.
 */
function countingEngine(store: Store) {
  const mutate = vi.fn(
    async (request: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
      if (request.optimistic !== undefined) store.applyOptimistic(request.optimistic);
      return {};
    },
  );
  return { mutate, engine: { store, mutate } as unknown as SyncEngine };
}

function mount(store: Store, children: ReactNode) {
  const { mutate, engine } = countingEngine(store);
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          {children}
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, engine };
}

const BASE: Seed = [
  ['team', team()],
  ['workflowState', state(TODO, 'Todo', 'unstarted')],
  ['workflowState', state(DONE, 'Done', 'completed')],
  ['issue', issue(PARENT, 1, 'The parent')],
  ['issue', issue('c-1', 2, 'Read the file', { parentId: PARENT })],
  ['issue', issue('c-2', 3, 'Parse the CSV', { parentId: PARENT })],
];

describe('sub-issue rollup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Only this level can prove the criterion. `subIssueProgress` tested against a store shows
   * the arithmetic is right; a component test with a delta shows the panel is subscribed.
   * Neither can say what a completion COSTS, because neither performs one — and the cost is
   * the entire claim. A rollup stored on the parent rather than derived would pass both of
   * those and fail this one, because keeping it in step needs a second write.
   */
  it('moves the parent ring on the write that completes the child, with nothing extra sent', async () => {
    const store = seeded(BASE);
    const { mutate, engine } = mount(
      store,
      <SubIssues issueId={PARENT} teamId={ENG} onDetach={() => {}} />,
    );

    // A network the component is not allowed to reach behind the engine's back. `mutate` is
    // the only proxy the other tests have, so a refetch issued through `gql()` directly
    // would be invisible to them; this closes that hole for the one claim that is about
    // round trips.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(screen.getByRole('img', { name: 'Sub-issues: 0 of 2 done' })).toBeTruthy();

    await act(async () => {
      await updateIssue(engine, 'c-2', { stateId: DONE });
    });

    // The ring moved, and it moved off the optimistic patch: no delta has arrived and the
    // stub answered with nothing a caller could read a new state out of.
    expect(screen.getByRole('img', { name: 'Sub-issues: 1 of 2 done' })).toBeTruthy();

    // Exactly one round trip: the child's own status change. A second call here would be
    // the parent being told about its own progress, which is the round trip the criterion
    // says does not happen.
    expect(mutate).toHaveBeenCalledTimes(1);
    const [request] = mutate.mock.calls[0] as [{ variables: { input: Record<string, unknown> } }];
    expect(request.variables.input).toMatchObject({ id: 'c-2', stateId: DONE });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * The same claim from the other side: the parent is not a row that has to be rewritten.
   *
   * If progress were a stored count, completing a child would have to touch the parent
   * entity, and the store would hold a different `issue` row for it afterwards. Asserting
   * the parent is byte-for-byte the object it was is what makes "derived" a fact rather
   * than an implementation detail somebody could quietly change.
   */
  it('does not rewrite the parent issue when a child completes', async () => {
    const store = seeded(BASE);
    const { engine } = mount(
      store,
      <SubIssues issueId={PARENT} teamId={ENG} onDetach={() => {}} />,
    );

    const parentBefore = store.get('issue', PARENT);

    await act(async () => {
      await updateIssue(engine, 'c-1', { stateId: DONE });
    });

    expect(screen.getByRole('img', { name: 'Sub-issues: 1 of 2 done' })).toBeTruthy();
    // Identity, not equality: a rebuilt-but-equal parent would still mean the rollup is
    // being written somewhere rather than read.
    expect(store.get('issue', PARENT)).toBe(parentBefore);
  });
});
