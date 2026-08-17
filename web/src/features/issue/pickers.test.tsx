import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { EngineProvider } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { Store, type Change, type User, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AssigneePicker, PriorityPicker, StatusPicker } from './pickers';

/**
 * The pickers are tested through the keyboard, because the keyboard is what they are for.
 * `S`, `A` and `P` open them with the user's hands already on the keys, and a picker that
 * can only be driven with a pointer is a picker the intended audience never reaches.
 *
 * They run against a real Store with no database behind it. Mocking the store would mean
 * asserting that a component asked a mock a question, which stays green through exactly the
 * kind of change — a renamed index, a category that stops sorting — that breaks the screen.
 */

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';

function state(
  id: string,
  name: string,
  category: WorkflowState['category'],
  position: string,
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: category === 'backlog',
    isSystem: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function person(id: string, displayName: string, status: User['status'] = 'active'): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name: displayName,
    displayName,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status,
    kind: 'human',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function upsert(
  entities: readonly (WorkflowState | User)[],
  type: 'workflowState' | 'user',
): Change[] {
  return entities.map((entity, index) => ({
    v: index + 1,
    type,
    id: entity.id,
    op: 'upsert' as const,
    actor: { type: 'system' as const },
    payload: entity,
  })) as Change[];
}

function storeWith(states: readonly WorkflowState[], users: readonly User[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(upsert(states, 'workflowState'));
  store.applyChanges(upsert(users, 'user'));
  return store;
}

/** The engine's only role here is to carry the store; nothing under test touches the rest. */
function withStore(store: Store, children: ReactNode) {
  const engine = { store } as unknown as SyncEngine;
  return (
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      {children}
    </EngineProvider>
  );
}

/** A trigger and its picker, wired the way every real call site wires them. */
function Harness({
  render: renderPicker,
}: {
  render: (trigger: ReturnType<typeof useMenuTrigger>) => ReactNode;
}) {
  const trigger = useMenuTrigger();
  return (
    <>
      <button {...trigger.props}>Open</button>
      {renderPicker(trigger)}
    </>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

/** Without a filter box the active item is the focused one; see Menu. */
function activeText(): string | null {
  return document.activeElement?.textContent ?? null;
}

const STATES = [
  state('s-done', 'Done', 'completed', 'V'),
  state('s-todo', 'Todo', 'unstarted', 'V'),
  state('s-backlog', 'Backlog', 'backlog', 'V'),
  state('s-doing', 'In Progress', 'started', 'V'),
  state('s-review', 'In Review', 'started', 'W'),
];

describe('StatusPicker', () => {
  it('lists the team statuses in workflow order, under their category', async () => {
    const user = userEvent.setup();
    render(
      withStore(
        storeWith(STATES, []),
        <Harness
          render={(trigger) => (
            <StatusPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              teamId={TEAM}
              value={undefined}
              onSelect={() => {}}
            />
          )}
        />,
      ),
    );
    await open(user);

    // Category order first, then the team's own fractional position inside a category —
    // which is why In Progress precedes In Review rather than sorting alphabetically.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'In Review',
      'Done',
    ]);
    // One group per category represented, each named by its heading — which is what tells a
    // reader that this team's "In Review" counts as started rather than completed.
    expect(screen.getAllByRole('group')).toHaveLength(4);
  });

  it('opens on the current status rather than at the top', async () => {
    const user = userEvent.setup();
    render(
      withStore(
        storeWith(STATES, []),
        <Harness
          render={(trigger) => (
            <StatusPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              teamId={TEAM}
              value="s-doing"
              onSelect={() => {}}
            />
          )}
        />,
      ),
    );
    await open(user);

    expect(activeText()).toBe('In Progress');
    expect(screen.getByRole('menuitem', { name: 'In Progress' }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('chooses with the arrow keys and Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      withStore(
        storeWith(STATES, []),
        <Harness
          render={(trigger) => (
            <StatusPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              teamId={TEAM}
              value="s-backlog"
              onSelect={onSelect}
            />
          )}
        />,
      ),
    );
    await open(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('s-doing');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('jumps to a status as the user types its name', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      withStore(
        storeWith(STATES, []),
        <Harness
          render={(trigger) => (
            <StatusPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              teamId={TEAM}
              value={undefined}
              onSelect={onSelect}
            />
          )}
        />,
      ),
    );
    await open(user);

    await user.keyboard('in r{Enter}');

    expect(onSelect).toHaveBeenCalledWith('s-review');
  });

  it('closes on Escape without choosing, and gives the trigger its focus back', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      withStore(
        storeWith(STATES, []),
        <Harness
          render={(trigger) => (
            <StatusPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              teamId={TEAM}
              value={undefined}
              onSelect={onSelect}
            />
          )}
        />,
      ),
    );
    await open(user);

    await user.keyboard('{Escape}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('never offers the system-managed status', async () => {
    const user = userEvent.setup();
    const duplicate: WorkflowState = {
      ...state('s-dup', 'Duplicate', 'duplicate', 'V'),
      isSystem: true,
    };
    render(
      withStore(
        storeWith([...STATES, duplicate], []),
        <Harness
          render={(trigger) => (
            <StatusPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              teamId={TEAM}
              value={undefined}
              onSelect={() => {}}
            />
          )}
        />,
      ),
    );
    await open(user);

    expect(screen.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull();
  });
});

const PEOPLE = [
  person('u-ada', 'Ada Lovelace'),
  person('u-alan', 'Alan Turing'),
  person('u-grace', 'Grace Hopper'),
  person('u-gone', 'Katherine Johnson', 'suspended'),
];

describe('AssigneePicker', () => {
  function renderPicker(value: string | null | undefined, onSelect = vi.fn()) {
    render(
      withStore(
        storeWith([], PEOPLE),
        <Harness
          render={(trigger) => (
            <AssigneePicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              value={value}
              onSelect={onSelect}
            />
          )}
        />,
      ),
    );
    return onSelect;
  }

  it('puts focus in the filter and narrows as the user types', async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker(null);
    await open(user);

    const filter = screen.getByRole('textbox', { name: 'Assignee' });
    expect(document.activeElement).toBe(filter);

    await user.keyboard('grace');
    // The avatar's initial is decorative, so it is in the row but not in its name.
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Grace Hopper' })).toBeTruthy();

    // Focus never leaves the box, so the active item is named rather than focused.
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('u-grace');
  });

  it('unassigns from the top of the list', async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker('u-ada');
    await open(user);

    await user.click(screen.getByRole('menuitem', { name: 'No assignee' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('hides a suspended member unless they are the one assigned', async () => {
    const user = userEvent.setup();
    renderPicker(null);
    await open(user);

    expect(screen.queryByRole('menuitem', { name: /Katherine/ })).toBeNull();
  });

  it('shows a suspended member who still holds the issue', async () => {
    const user = userEvent.setup();
    renderPicker('u-gone');
    await open(user);

    expect(screen.getByRole('menuitem', { name: /Katherine/ })).toBeTruthy();
  });

  it('says so when the filter matches nobody', async () => {
    const user = userEvent.setup();
    renderPicker(null);
    await open(user);

    await user.keyboard('zzz');

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByText('Nobody by that name')).toBeTruthy();
  });
});

describe('PriorityPicker', () => {
  function renderPicker(value: number | undefined, onSelect = vi.fn()) {
    render(
      withStore(
        storeWith([], []),
        <Harness
          render={(trigger) => (
            <PriorityPicker
              open={trigger.open}
              onClose={trigger.hide}
              trigger={trigger.ref}
              value={value}
              onSelect={onSelect}
            />
          )}
        />,
      ),
    );
    return onSelect;
  }

  it('offers the scale in display order, urgent first and none last', async () => {
    const user = userEvent.setup();
    renderPicker(undefined);
    await open(user);

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
      'No priority',
    ]);
  });

  it('opens on the current level and chooses with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker(3);
    await open(user);

    expect(activeText()).toBe('Medium');

    await user.keyboard('{ArrowUp}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('jumps to a level by its first letter', async () => {
    const user = userEvent.setup();
    const onSelect = renderPicker(0);
    await open(user);

    await user.keyboard('u{Enter}');

    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
