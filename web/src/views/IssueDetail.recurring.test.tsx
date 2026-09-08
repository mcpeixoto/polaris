/**
 * The two halves of a schedule an issue could not reach: editing it and stopping it.
 *
 * The rail's Repeats row was text, the ⋯ menu offered "Make recurring" and nothing else, and
 * `UPDATE_RECURRING_ISSUE` had never had a caller — so a cadence chosen once in the convert
 * dialog was a cadence for good. The dialog seeding is the part most worth pinning: it hard
 * reset to weekly on every open, so an edit of a monthly schedule would have proposed weekly
 * and called it the current value.
 *
 * Stopping is confirmed first because it is not a fact about this issue. `recurringIssue` is
 * a team row — it is listed in that team's settings and `ArchiveRecurringIssue` emits at team
 * scope — so the control that sits on one issue stops the schedule for everybody.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueDetail } from './IssueDetail';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const ISSUE = '01900000-0000-7000-8000-000000000004' as UUID;
const VIEWER = '01900000-0000-7000-8000-000000000005' as UUID;
const SCHEDULE = '01900000-0000-7000-8000-000000000006' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, displayName: 'Ada', role: 'member' }),
  useViewerRole: () => 'member',
}));

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn(async () => ({ comments: [], issueHistory: [] })) };
});

afterEach(cleanup);

function seeded(recurring: boolean): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'UTC',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'a',
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'user',
      {
        id: VIEWER,
        workspaceId: WORKSPACE,
        displayName: 'Ada',
        email: 'ada@example.com',
        role: 'member',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    ...(recurring
      ? ([
          [
            'recurringIssue',
            {
              id: SCHEDULE,
              workspaceId: WORKSPACE,
              teamId: TEAM,
              title: 'Ship the importer',
              body: '',
              properties: {},
              cadence: 'monthly',
              nextDueDate: '2026-03-02',
              createdAt: AT,
              updatedAt: AT,
            } as unknown as Entity,
          ],
        ] as [string, Entity][])
      : []),
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        title: 'Ship the importer',
        description: '',
        priority: 0,
        stateId: TODO,
        creatorId: VIEWER,
        dueDateSource: 'manual',
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
        ...(recurring ? { recurringIssueId: SCHEDULE } : null),
      } as unknown as Entity,
    ],
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

function mount(recurring = true) {
  const store = seeded(recurring);
  const mutate = vi.fn(async (input: { optimistic?: OptimisticPatch }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/issue/ENG-7']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/issue/:identifier" element={<IssueDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate, store };
}

/** The GraphQL document a call carried, so create and update can be told apart. */
function mutationsSent(mutate: ReturnType<typeof vi.fn>): string[] {
  return mutate.mock.calls.map((call) => String((call[0] as { mutation: string }).mutation));
}

/** The variables the last call carried, which is what the server would actually receive. */
function lastVariables(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mutate.mock.calls.at(-1)?.[0] as { variables: Record<string, unknown> };
  return call.variables;
}

describe('the Repeats row', () => {
  it('opens the dialog seeded with the schedule it names, not with the default', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: /Monthly/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Cadence' })).toHaveProperty(
      'value',
      'monthly',
    );
    // The day on offer is the schedule's next occurrence, not today.
    expect(within(dialog).getByLabelText('Next due')).toHaveProperty('value', '2026-03-02');
  });

  it('edits the schedule rather than writing a second one', async () => {
    const { user, mutate, store } = mount();

    await user.click(screen.getByRole('button', { name: /Monthly/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Cadence' }), 'quarterly');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));

    const sent = mutationsSent(mutate);
    expect(sent.some((doc) => doc.includes('mutation UpdateRecurringIssue'))).toBe(true);
    expect(sent.some((doc) => doc.includes('mutation CreateRecurringIssue'))).toBe(false);
    expect(lastVariables(mutate).input).toEqual({
      id: SCHEDULE,
      cadence: 'QUARTERLY',
      nextDueDate: '2026-03-02',
    });
    expect(store.get('recurringIssue', SCHEDULE)?.cadence).toBe('quarterly');
  });
});

describe('the header menu', () => {
  it('offers editing and stopping for a recurring issue, and never making it one', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });

    expect(within(menu).getByRole('menuitem', { name: 'Edit schedule' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Stop repeating' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Make recurring' })).toBeNull();
  });

  it('offers only making one for an issue that is not on a schedule', async () => {
    const { user } = mount(false);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });

    expect(within(menu).getByRole('menuitem', { name: 'Make recurring' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit schedule' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Stop repeating' })).toBeNull();
  });
});

describe('stopping a schedule', () => {
  it('says whose schedule it is before archiving it', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stop repeating' }));

    // Nothing has been written yet, and what the dialog says is that the schedule is the
    // team's and the occurrences already minted are not affected.
    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Stop repeating ENG-7?' });
    expect(within(dialog).getByText(/Engineering stops getting this issue/)).toBeTruthy();
    expect(within(dialog).getByText(/keep their dates/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Stop repeating' }));

    expect(mutationsSent(mutate).some((doc) => doc.includes('ArchiveRecurringIssue'))).toBe(true);
    expect(lastVariables(mutate)).toEqual({ id: SCHEDULE, archived: true });
  });

  it('leaves the schedule alone when the confirmation is dismissed', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Stop repeating' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Monthly/ })).toBeTruthy();
  });
});
