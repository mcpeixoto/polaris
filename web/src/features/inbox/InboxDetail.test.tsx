/**
 * Answering a mention without leaving the inbox, and editing the issue behind it.
 *
 * The pane was read-only, so the commonest thing anybody wants to do with a notification —
 * reply to the person who wrote it — meant opening the issue and finding the way back. The
 * composer posts through `postComment`, so what is asserted here is that a reply from this
 * pane is an ordinary comment on the issue and reaches the replica as one.
 *
 * The five property rows are the second half. Each one is the control that changes it, each
 * has the chord the inbox registers beside it, and the pair of them writes through the same
 * mutations the issue page uses. The `⇧E` test is the one worth reading twice: that chord
 * belongs to `inbox.markAllRead`, so this pane has no estimate row at all, and the sentinel
 * below makes a future one fail loudly rather than quietly lose the key.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useActions, useKeyContext } from '~/app/keymap';
import {
  Store,
  type Change,
  type Entity,
  type Issue,
  type Label,
  type Project,
  type User,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InboxDetail } from './InboxDetail';

const WORKSPACE = 'w1';
const AT = '2026-08-16T11:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

const viewer: User = {
  id: 'u1',
  workspaceId: WORKSPACE,
  name: 'ada',
  displayName: 'Ada',
  timezone: 'UTC',
  role: 'member',
  status: 'active',
  kind: 'human',
  createdAt: AT,
  updatedAt: AT,
};

const state: WorkflowState = {
  id: 's1',
  workspaceId: WORKSPACE,
  teamId: 't1',
  name: 'In Progress',
  color: '#3366ff',
  category: 'started',
  position: 'V',
  isDefault: false,
  isSystem: false,
  createdAt: AT,
  updatedAt: AT,
};

/** A second status, so choosing one is a change and not a no-op the planner discards. */
const done: WorkflowState = { ...state, id: 's2', name: 'Done', category: 'completed' };

const project: Project = {
  id: 'p1',
  workspaceId: WORKSPACE,
  name: 'Apollo',
  description: '',
  color: '#5e6ad2',
  statusId: 'ps1',
  priority: 0,
  sortOrder: 'V',
  updateSchedule: 'default',
  createdAt: AT,
  updatedAt: AT,
};

/** Workspace-scoped, so it is offered whatever team the issue is in. */
const bug: Label = {
  id: 'l1',
  workspaceId: WORKSPACE,
  isGroup: false,
  name: 'Bug',
  color: '#eb5757',
  position: 'V',
  createdAt: AT,
  updatedAt: AT,
};

const issue: Issue = {
  id: 'i1',
  workspaceId: WORKSPACE,
  teamId: 't1',
  number: 4,
  identifier: 'ENG-4',
  title: 'Fix the flake',
  dueDateSource: 'manual',
  description: 'A paragraph about it.',
  stateId: 's1',
  priority: 2,
  sortOrder: 'V',
  createdAt: AT,
  updatedAt: AT,
};

/**
 * The inbox's own `⇧E`, standing in for `inbox.markAllRead`.
 *
 * Registered unguarded in `list`, exactly as `views/Inbox` registers it, and mounted before
 * the pane so it claims the key first. The registry refuses a second binding on a chord an
 * unguarded action already holds — so if this pane ever grows an estimate row on `⇧E`, every
 * test in this file throws at mount rather than shipping a shortcut that silently loses to
 * the one people already use.
 */
function InboxKeys({ onMarkAllRead }: { onMarkAllRead: () => void }) {
  useKeyContext('list');
  useActions(
    [
      {
        id: 'inbox.markAllRead',
        title: 'Mark everything read',
        keys: ['alt+u', 'shift+e'],
        when: 'list',
        group: 'Inbox',
        run: onMarkAllRead,
      },
    ],
    [],
  );
  return null;
}

interface Options {
  /** What the pane is pointed at. `null` is the inbox before the cursor has been moved. */
  readonly issueId?: string | null;
  /** Seeded onto the issue, for the rows that only have something to say when set. */
  readonly seed?: readonly Change[];
}

function renderDetail({ issueId = 'i1', seed = [] }: Options = {}) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', viewer),
    upsert(2, 'workflowState', state),
    upsert(3, 'issue', issue),
    upsert(4, 'workflowState', done),
    upsert(5, 'project', project),
    upsert(6, 'label', bug),
    ...seed,
  ]);
  const mutate = vi.fn(
    async (input: {
      variables?: Record<string, unknown>;
      optimistic?: Parameters<Store['applyOptimistic']>[0];
    }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      return {};
    },
  );
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  const markAllRead = vi.fn();
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <InboxKeys onMarkAllRead={markAllRead} />
          <InboxDetail issueId={issueId} unread={0} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, markAllRead, user: userEvent.setup() };
}

/** The variables of the last mutation the pane sent. */
function sent(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mutate.mock.calls.at(-1)?.[0] as { variables: Record<string, unknown> };
  return call.variables;
}

/** …and, for the four that take one, the `input` inside it. */
function sentInput(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return sent(mutate).input as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the inbox detail pane', () => {
  it('posts a reply as a comment on the issue it is about', async () => {
    const { user, mutate, store } = renderDetail();

    const box = screen.getByRole('textbox', { name: 'Reply to ENG-4' });
    await user.type(box, 'On it, thanks.');
    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0]?.[0].variables as { input: Record<string, unknown> };
    expect(input.input).toMatchObject({ issueId: 'i1', body: 'On it, thanks.' });
    // Optimistic like every other comment: it is in the replica before the request settles.
    expect([...store.comments.values()].map((comment) => comment.body)).toEqual(['On it, thanks.']);
  });

  it('will not post an empty reply', () => {
    renderDetail();
    const button = screen.getByRole('button', { name: 'Reply' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the pane property rows', () => {
  it('draws every value as the control that changes it', () => {
    renderDetail();

    // The `dt` names the property, so the button's name is the value alone.
    expect(screen.getByRole('button', { name: 'In Progress' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'High' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No assignee' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No labels' })).toBeTruthy();
  });

  it('shows the project and the label rows when nothing is set', () => {
    renderDetail();

    // Both rows used to be hidden when empty, which hid the only way to fill them.
    expect(screen.getByText('Project')).toBeTruthy();
    expect(screen.getByText('Labels')).toBeTruthy();
  });

  it('writes the status the picker chose', async () => {
    const { user, mutate, store } = renderDetail();

    await user.click(screen.getByRole('button', { name: 'In Progress' }));
    await user.click(screen.getByRole('menuitem', { name: 'Done' }));

    expect(sentInput(mutate)).toMatchObject({ id: 'i1', stateId: 's2' });
    expect(store.issues.get('i1')?.stateId).toBe('s2');
  });

  it('writes the priority the picker chose', async () => {
    const { user, mutate } = renderDetail();

    await user.click(screen.getByRole('button', { name: 'High' }));
    await user.click(screen.getByRole('menuitem', { name: 'Urgent' }));

    expect(sentInput(mutate)).toMatchObject({ id: 'i1', priority: 1 });
  });

  it('writes the assignee the picker chose', async () => {
    const { user, mutate } = renderDetail();

    await user.click(screen.getByRole('button', { name: 'No assignee' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ada' }));

    expect(sentInput(mutate)).toMatchObject({ id: 'i1', assigneeId: 'u1' });
  });

  it('writes the project the picker chose', async () => {
    const { user, mutate } = renderDetail();

    await user.click(screen.getByRole('button', { name: 'No project' }));
    await user.click(screen.getByRole('menuitem', { name: 'Apollo' }));

    expect(sentInput(mutate)).toMatchObject({ id: 'i1', projectId: 'p1' });
  });

  it('applies the label the picker chose', async () => {
    const { user, mutate, store } = renderDetail();

    await user.click(screen.getByRole('button', { name: 'No labels' }));
    await user.click(screen.getByRole('menuitem', { name: 'Bug' }));

    expect(sent(mutate)).toMatchObject({ issueId: 'i1', labelId: 'l1' });
    expect([...store.labelIdsFor('i1')]).toEqual(['l1']);
  });
});

describe('the pane shortcuts', () => {
  const chords: readonly { keys: string; opens: string }[] = [
    { keys: 's', opens: 'Status' },
    { keys: 'a', opens: 'Assignee' },
    { keys: 'p', opens: 'Priority' },
    { keys: '{Shift>}P{/Shift}', opens: 'Project' },
    { keys: 'l', opens: 'Labels' },
  ];

  for (const chord of chords) {
    it(`opens the ${chord.opens.toLowerCase()} picker on ${chord.keys}`, async () => {
      const { user } = renderDetail();

      await user.keyboard(chord.keys);

      expect(screen.getByRole('menu', { name: chord.opens })).toBeTruthy();
    });
  }

  it('does nothing while no notification is selected', async () => {
    const { user } = renderDetail({ issueId: null });

    for (const chord of chords) await user.keyboard(chord.keys);

    // The pane is the count, not an issue: nothing to point five pickers at, and no picker.
    expect(screen.getByText('No unread notifications')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'No project' })).toBeNull();
    expect(screen.queryAllByRole('menu')).toEqual([]);
  });

  /*
   * The collision this pane is shaped around. `⇧E` marks the whole inbox read, so there is
   * no estimate row here and no chord for one — the sentinel above would have thrown at
   * mount if there were, and this asserts the other half: the key still does the inbox's job
   * and opens nothing.
   */
  it('leaves ⇧E to the inbox and opens no estimate picker', async () => {
    const { user, markAllRead } = renderDetail();

    await user.keyboard('{Shift>}E{/Shift}');

    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole('menu')).toEqual([]);
    expect(screen.queryByText('Estimate')).toBeNull();
  });
});
