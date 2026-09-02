import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Issue,
  type IssueRelation,
  type OptimisticPatch,
  type RelationType,
  type Team,
  type WorkflowState,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Relations, SubIssues } from './relations';

/**
 * Both panels are read models over the store's indexes and write models over `mutations.ts`,
 * so a mocked store would leave nothing worth testing: the assertions that matter are that the
 * right index was asked, that the answer survives an optimistic change with no round trip, and
 * that a relation goes onto the wire pointing the way the user asked. All three are properties
 * of a real Store and a real mutation call.
 */

const WORKSPACE = 'workspace-1';
const ENG = 'team-eng';
const PLAT = 'team-plat';
const AT = '2026-01-01T00:00:00Z';

function team(id: string, key: string, name: string): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
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
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...extras,
  };
}

function relation(
  id: string,
  issueId: string,
  relatedIssueId: string,
  type: RelationType,
  extras: Partial<IssueRelation> = {},
): IssueRelation {
  return {
    id,
    workspaceId: WORKSPACE,
    issueId,
    relatedIssueId,
    type,
    teamId: ENG,
    relatedTeamId: ENG,
    createdAt: AT,
    ...extras,
  };
}

type Seed = readonly [string, { id: string }][];

function seeded(entities: Seed, from = 1): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(changes(entities, from));
  return store;
}

function changes(entities: Seed, from: number): Change[] {
  return entities.map(([type, entity], index) => ({
    v: from + index,
    type,
    id: entity.id,
    op: 'upsert' as const,
    actor: { type: 'system' as const },
    payload: entity,
  })) as Change[];
}

/**
 * An engine reduced to the two things these panels ask of it: apply the optimistic patch, then
 * answer with the row a server that accepted the write would have returned.
 *
 * A bare `mockResolvedValue({})` is the right stub for a screen whose writes only *send*
 * something — the pickers, the list's bulk actions — and it is the wrong one here. Both
 * `createSubIssue` and `createRelation` read the response to settle the stand-in they have just
 * put on screen, so a stub answering with nothing makes them throw for a reason that has
 * nothing to do with the panel under test, and the console fills with failures that are not the
 * ones being looked for. Echoing the patch back is exactly what the server does.
 */
function engineFor(store: Store) {
  const mutate = vi.fn(async (request: { optimistic?: OptimisticPatch }) => {
    const patch = request.optimistic ?? [];
    store.applyOptimistic(patch);
    // The last entry is the row being created, when there is one. Both callers name the entity
    // they are settling, so one shape answers for either and neither reads the other's key.
    const created = patch[patch.length - 1]?.after ?? null;
    return { createIssue: { issue: created }, createIssueRelation: { relation: created } };
  });
  return { mutate, engine: { store, mutate } as unknown as SyncEngine };
}

/** The provider stack every screen in this product sits under, and nothing more. */
function mount(store: Store, children: ReactNode) {
  const { mutate, engine } = engineFor(store);
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          {children}
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

/** A delta arriving from the sync stream, which is a render and therefore an `act`. */
function deliver(store: Store, entities: Seed, from: number): void {
  act(() => {
    store.applyChanges(changes(entities, from));
  });
}

/** The variables of the one mutation a test provoked, whatever operation carried them. */
function variablesOf(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(mutate).toHaveBeenCalledTimes(1);
  const [request] = mutate.mock.calls[0] as [{ variables: Record<string, unknown> }];
  return request.variables;
}

const BASE: Seed = [
  ['team', team(ENG, 'ENG', 'Engineering')],
  ['team', team(PLAT, 'PLAT', 'Platform')],
  ['workflowState', state('s-todo', 'Todo', 'unstarted')],
  ['workflowState', state('s-done', 'Done', 'completed')],
  ['workflowState', state('s-dropped', 'Cancelled', 'canceled')],
];

/**
 * Only this level can prove that the rollup moves on a local write. `subIssueProgress` is
 * already tested against a store in store/query.test; what cannot be proven there is that this
 * panel subscribes to the entity types the answer depends on, which is the difference between
 * a ring that updates as the child's status menu closes and one that waits for a delta.
 */
describe('SubIssues', () => {
  const PARENT = 'issue-parent';

  function renderPanel(extra: Seed = []) {
    const onDetach = vi.fn();
    const store = seeded([...BASE, ['issue', issue(PARENT, 1, 'Ship the importer')], ...extra]);
    const mounted = mount(store, <SubIssues issueId={PARENT} teamId={ENG} onDetach={onDetach} />);
    return { ...mounted, onDetach };
  }

  it('lists the children in checklist order with their status and identifier', () => {
    renderPanel([
      ['issue', issue('c-2', 2, 'Parse the CSV', { parentId: PARENT, subIssueSortOrder: 'W' })],
      ['issue', issue('c-3', 3, 'Map the columns', { parentId: PARENT, subIssueSortOrder: 'V' })],
    ]);

    // The sub-issue order, not the backlog's: a checklist's order has nothing to do with the
    // list's, so ENG-3 leads despite the higher number.
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'ENG-3Map the columns',
      'ENG-2Parse the CSV',
    ]);
    expect(screen.getAllByRole('img', { name: 'Todo' })).toHaveLength(2);
  });

  it('names the child a team the parent is not in, and says nothing when they match', () => {
    renderPanel([
      ['issue', issue('c-2', 2, 'Parse the CSV', { parentId: PARENT })],
      [
        'issue',
        issue('c-9', 9, 'Raise the rate limit', {
          parentId: PARENT,
          teamId: PLAT,
          identifier: 'PLAT-9',
        }),
      ],
    ]);

    // Cross-team children are normal — platform work under a feature epic — so the team is
    // identification rather than a warning, and it is only drawn where it differs.
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(screen.queryByText('Engineering')).toBeNull();
  });

  it('moves the rollup when a child completes, with nothing on the wire', () => {
    const { store, mutate } = renderPanel([
      ['issue', issue('c-2', 2, 'Parse the CSV', { parentId: PARENT })],
      ['issue', issue('c-3', 3, 'Map the columns', { parentId: PARENT })],
    ]);

    expect(screen.getByRole('img', { name: 'Sub-issues: 0 of 2 done' })).toBeTruthy();

    // Exactly what an optimistic status change writes: one entity, applied locally.
    deliver(
      store,
      [['issue', issue('c-2', 2, 'Parse the CSV', { parentId: PARENT, stateId: 's-done' })]],
      50,
    );

    expect(screen.getByRole('img', { name: 'Sub-issues: 1 of 2 done' })).toBeTruthy();
    // Nothing was asked of the server to redraw the ring. The children are already here, so
    // the parent's progress is a read rather than a round trip.
    expect(mutate).not.toHaveBeenCalled();
  });

  it('drops a cancelled child out of the total rather than holding the parent at incomplete', () => {
    const { store } = renderPanel([
      ['issue', issue('c-2', 2, 'Parse the CSV', { parentId: PARENT })],
      ['issue', issue('c-3', 3, 'Map the columns', { parentId: PARENT })],
    ]);

    deliver(
      store,
      [['issue', issue('c-3', 3, 'Map the columns', { parentId: PARENT, stateId: 's-dropped' })]],
      50,
    );

    // Work the team explicitly dropped must not leave a parent reading "1 of 2" forever, which
    // looks like a stuck issue rather than a finished one.
    expect(screen.getByRole('img', { name: 'Sub-issues: 0 of 1 done' })).toBeTruthy();
  });

  it('creates a child inline, in the parent’s team, and keeps the box open for the next one', async () => {
    const { user, mutate, store } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Add sub-issue' }));
    await user.type(screen.getByRole('textbox', { name: 'Sub-issue title' }), 'Parse the CSV');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const variables = variablesOf(mutate) as { input: Record<string, unknown> };
    expect(variables.input.title).toBe('Parse the CSV');
    expect(variables.input.parentId).toBe(PARENT);
    expect(variables.input.teamId).toBe(ENG);

    // On screen before the request is answered, which is the whole point of the optimistic
    // patch — breaking an epic into eight children is eight round trips otherwise.
    expect(store.childIssueIdsFor(PARENT).size).toBe(1);
    // Emptied but still open: the second child should not cost a click more than the first.
    expect(
      (screen.getByRole('textbox', { name: 'Sub-issue title' }) as HTMLInputElement).value,
    ).toBe('');
  });

  it('says what detaching will actually do before it does it', async () => {
    const { user, onDetach } = renderPanel([
      ['issue', issue('c-2', 2, 'Parse the CSV', { parentId: PARENT })],
    ]);

    await user.click(screen.getByRole('button', { name: 'Remove ENG-2 from this issue' }));

    // The consequence, not "are you sure?": "remove" is the word people read as "delete", and
    // the dialog exists to say which of the two this is.
    expect(screen.getByText(/stays exactly as it is/)).toBeTruthy();
    expect(onDetach).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove ENG-2' }));
    expect(onDetach).toHaveBeenCalledWith('c-2');
  });

  it('renders no row for a child the replica does not hold', () => {
    const { store } = renderPanel();
    // A parent id pointing at an issue that never arrived: the index has nothing to offer, and
    // the panel must not invent a row with an undefined identifier in it.
    expect(store.childIssueIdsFor('nobody').size).toBe(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Nothing underneath this one yet.')).toBeTruthy();
  });
});

/**
 * Only this level can prove the two things that make relations confusing: that one stored row
 * is read as two different words depending on which end you stand at, and that adding a blocker
 * writes that row the other way round. Both are invisible to a type checker — a swapped pair of
 * uuids is still a pair of uuids — and both produce a panel that is wrong rather than broken.
 */
describe('Relations', () => {
  const HERE = 'issue-here';
  const THERE = 'issue-there';

  function renderPanel(extra: Seed = []) {
    const store = seeded([
      ...BASE,
      ['issue', issue(HERE, 1, 'Ship the importer')],
      ['issue', issue(THERE, 2, 'Fix the flake')],
      ...extra,
    ]);
    return mount(store, <Relations issueId={HERE} />);
  }

  it('reads one blocks row as “blocking” from the end that declares it', () => {
    renderPanel([['issueRelation', relation('r-1', HERE, THERE, 'blocks')]]);

    expect(screen.getByRole('heading', { name: 'Blocking' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Blocked by' })).toBeNull();
    expect(screen.getByRole('link', { name: 'ENG-2 Fix the flake' })).toBeTruthy();
  });

  it('reads the same row as “blocked by” from the other end', () => {
    renderPanel([['issueRelation', relation('r-1', THERE, HERE, 'blocks')]]);

    // The same single row. Storing an inverse as well would allow two rows that disagree, and
    // an issue that blocks another without the other being blocked by it is a state no user can
    // explain or repair.
    expect(screen.getByRole('heading', { name: 'Blocked by' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Blocking' })).toBeNull();
  });

  it('reads a symmetric row as “related” whichever end holds it', () => {
    renderPanel([['issueRelation', relation('r-1', THERE, HERE, 'related')]]);

    // `related` is normalised smaller-id-first by the server, so this issue is at whichever end
    // that put it and both readings have to be the same word.
    expect(screen.getByRole('heading', { name: 'Related' })).toBeTruthy();
  });

  it('adds a blocker as a blocks row pointing at this issue, not away from it', async () => {
    const { user, mutate } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Link type' }), 'blockedBy');
    await user.type(screen.getByRole('textbox', { name: 'Search issues' }), 'flake');
    await user.click(screen.getByRole('button', { name: /ENG-2/ }));

    // The whole point: there is no inverse type, so a blocker is the other issue blocking this
    // one. Swapping these two ids produces a relation that is present, well-formed, and says
    // the opposite of what was asked for.
    expect(variablesOf(mutate)).toEqual({
      issueId: THERE,
      relatedIssueId: HERE,
      // Upper case on the wire and lower case in the store — see ~/gql/enums, where writing the
      // wire spelling into the replica made a new relation invisible until a reload.
      type: 'BLOCKS',
    });
  });

  it('adds a blocked issue the other way about', async () => {
    const { user, mutate } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Link type' }), 'blocking');
    await user.type(screen.getByRole('textbox', { name: 'Search issues' }), 'ENG-2');
    await user.click(screen.getByRole('button', { name: /ENG-2/ }));

    expect(variablesOf(mutate)).toEqual({
      issueId: HERE,
      relatedIssueId: THERE,
      type: 'BLOCKS',
    });
  });

  it('finds an issue by identifier as well as by title', async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    const box = screen.getByRole('textbox', { name: 'Search issues' });

    await user.type(box, 'eng-2');
    expect(screen.getByRole('button', { name: /Fix the flake/ })).toBeTruthy();

    await user.clear(box);
    await user.type(box, 'zzz');
    expect(screen.getByText('Nothing here by that name.')).toBeTruthy();
  });

  it('never offers this issue, or one already linked', async () => {
    const { user } = renderPanel([['issueRelation', relation('r-1', HERE, THERE, 'blocks')]]);

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByRole('textbox', { name: 'Search issues' }), 'the');

    // Both titles contain "the". Offering either would produce a duplicate row on the server or
    // a silent no-op, and nobody clicking a name asked for either of those.
    expect(screen.getByText('Nothing here by that name.')).toBeTruthy();
  });

  it('says so, rather than rendering a broken row, when the other end is not in the replica', () => {
    renderPanel([
      [
        'issueRelation',
        relation('r-1', HERE, 'issue-invisible', 'blocks', { relatedTeamId: PLAT }),
      ],
    ]);

    // The relation is real and the reader is entitled to know something they cannot open is
    // involved — so the row stays, named by the team it belongs to. What it must not be is a
    // link to a route built out of `undefined`.
    expect(screen.getByRole('heading', { name: 'Blocking' })).toBeTruthy();
    expect(screen.getByText('An issue you cannot see')).toBeTruthy();
    expect(screen.getByText('in Platform')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('removes a link the reader cannot see the other end of', async () => {
    const { user, mutate } = renderPanel([
      ['issueRelation', relation('r-1', HERE, 'issue-invisible', 'blocks')],
    ]);

    await user.click(
      screen.getByRole('button', { name: 'Remove the blocking link to an issue you cannot see' }),
    );

    // A row is identified by its own id, so either end may unlink it — including the end that
    // cannot resolve the other.
    expect(variablesOf(mutate)).toEqual({ id: 'r-1' });
  });

  it('says nothing is linked rather than showing empty headings', () => {
    renderPanel();

    expect(screen.getByText('Nothing linked to this one.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Blocked by' })).toBeNull();
  });
});

/**
 * Everything below is about the two things these panels did with a decision the server had
 * already made: they threw a refusal at the console and rolled the row back, and they wrote a
 * duplicate relation while leaving the issue open in every list it was in.
 */
describe('Relations, when the write is refused or means more than a row', () => {
  const HERE = 'issue-here';
  const THERE = 'issue-there';
  const DUPLICATE_STATE = 's-duplicate';

  function refusing(store: Store, error: ApiError) {
    const mutate = vi.fn(async () => {
      throw error;
    });
    return { mutate, engine: { store, mutate } as unknown as SyncEngine };
  }

  function mountWith(
    store: Store,
    children: ReactNode,
    engine: { mutate: ReturnType<typeof vi.fn>; engine: SyncEngine },
  ) {
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine.engine} status={{ phase: 'idle' }}>
            {children}
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    return { store, mutate: engine.mutate, user: userEvent.setup() };
  }

  const PAIR: Seed = [
    ...BASE,
    ['issue', issue(HERE, 1, 'Ship the importer')],
    ['issue', issue(THERE, 2, 'Fix the flake')],
  ];

  it('closes the issue as a duplicate as well as writing the relation', async () => {
    // The team's reserved Duplicate status: system-managed, one per team, and hidden by
    // `StatusPicker` on purpose.
    const duplicateState: WorkflowState = {
      ...state(DUPLICATE_STATE, 'Duplicate', 'duplicate'),
      isSystem: true,
    };
    const store = seeded([...PAIR, ['workflowState', duplicateState]]);
    const { user, mutate } = mount(store, <Relations issueId={HERE} />);

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Link type' }), 'duplicateOf');
    await user.type(screen.getByRole('textbox', { name: 'Search issues' }), 'ENG-2');
    await user.click(screen.getByRole('button', { name: /ENG-2/ }));

    // Two writes, in order: the link, then the status. `StatusPicker` hides the system
    // Duplicate state on purpose, so this is the only route the client has to it — a
    // duplicate that stayed open was one nobody could close through the product.
    const calls = mutate.mock.calls.map(
      ([request]) => (request as { variables: unknown }).variables,
    );
    expect(calls[0]).toEqual({ issueId: HERE, relatedIssueId: THERE, type: 'DUPLICATE' });
    expect(calls[1]).toMatchObject({ input: { id: HERE, stateId: DUPLICATE_STATE } });
  });

  it('still writes the link when the team’s Duplicate status is not in the replica', async () => {
    const { user, mutate } = mount(seeded(PAIR), <Relations issueId={HERE} />);

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Link type' }), 'duplicateOf');
    await user.type(screen.getByRole('textbox', { name: 'Search issues' }), 'ENG-2');
    await user.click(screen.getByRole('button', { name: /ENG-2/ }));

    // The relation is the write that matters and it is not gated on a status this replica
    // may simply not have received yet.
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('says why a link was refused, and gives the search box back', async () => {
    const store = seeded(PAIR);
    const refused = refusing(store, new ApiError('VALIDATION', 'these two are already linked'));
    const { user } = mountWith(store, <Relations issueId={HERE} />, refused);

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByRole('textbox', { name: 'Search issues' }), 'ENG-2');
    await user.click(screen.getByRole('button', { name: /ENG-2/ }));

    // The optimistic row is rolled back either way. What used to happen as well is that the
    // reason went to the console and the form closed, so the link appeared and then left.
    expect((await screen.findByRole('alert')).textContent).toBe('these two are already linked');
    expect((screen.getByRole('textbox', { name: 'Search issues' }) as HTMLInputElement).value).toBe(
      'ENG-2',
    );
  });

  it('says why a sub-issue was refused, and gives the title back', async () => {
    const store = seeded([...BASE, ['issue', issue(HERE, 1, 'Ship the importer')]]);
    const refused = refusing(store, new ApiError('VALIDATION', 'that title is too long'));
    const { user } = mountWith(
      store,
      <SubIssues issueId={HERE} teamId={ENG} onDetach={vi.fn()} />,
      refused,
    );

    await user.click(screen.getByRole('button', { name: 'Add sub-issue' }));
    await user.type(screen.getByRole('textbox', { name: 'Sub-issue title' }), 'Parse the CSV');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect((await screen.findByRole('alert')).textContent).toBe('that title is too long');
    expect(
      (screen.getByRole('textbox', { name: 'Sub-issue title' }) as HTMLInputElement).value,
    ).toBe('Parse the CSV');
  });

  it('titles the panel Relations, so it is not a second “Links” beside the attachments', () => {
    mount(seeded(PAIR), <Relations issueId={HERE} />);

    expect(screen.getByRole('heading', { name: 'Relations' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Links' })).toBeNull();
  });
});
