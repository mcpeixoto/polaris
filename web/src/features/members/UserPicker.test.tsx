import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { Store, type Change, type User, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { UserPicker } from './UserPicker';

/**
 * The three things that generalising `AssigneePicker` added, tested where they can actually
 * go wrong: a property that must have somebody (no "nobody" row), a property that takes
 * several (toggling, and a menu that does not shut between choices), and a list somebody has
 * already been taken out of.
 *
 * Run against a real Store, for the reason `pickers.test.tsx` gives: asserting that the
 * component asked a mock a question stays green through exactly the kind of change that
 * breaks the screen.
 */

const WORKSPACE = 'workspace-1';

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

const PEOPLE = [
  person('u-ada', 'Ada Lovelace'),
  person('u-grace', 'Grace Hopper'),
  person('u-alan', 'Alan Turing'),
];

function storeWith(users: readonly User[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    users.map((entity, index) => ({
      v: index + 1,
      type: 'user',
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

function withStore(store: Store, children: ReactNode) {
  const engine = { store } as unknown as SyncEngine;
  return (
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      {children}
    </EngineProvider>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

describe('UserPicker choosing one person', () => {
  function Harness({
    noneLabel,
    onSelect,
    exclude,
  }: {
    noneLabel?: string | null;
    onSelect: (id: UUID | null) => void;
    exclude?: ReadonlySet<UUID>;
  }) {
    const trigger = useMenuTrigger();
    return (
      <>
        <button {...trigger.props}>Open</button>
        <UserPicker
          open={trigger.open}
          onClose={trigger.hide}
          trigger={trigger.ref}
          value={null}
          onSelect={onSelect}
          label="Lead"
          noneLabel={noneLabel}
          filterPlaceholder="Choose a lead…"
          exclude={exclude}
        />
      </>
    );
  }

  it('offers nobody by default, and reports it as null', async () => {
    const onSelect = vi.fn();
    render(withStore(storeWith(PEOPLE), <Harness noneLabel="No lead" onSelect={onSelect} />));
    const user = userEvent.setup();
    await open(user);

    await user.click(screen.getByRole('menuitem', { name: 'No lead' }));

    // `null` and not an empty string: nobody is an answer, and the caller writes it.
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('hides the nobody row when the property must have somebody', async () => {
    const onSelect = vi.fn();
    render(withStore(storeWith(PEOPLE), <Harness noneLabel={null} onSelect={onSelect} />));
    const user = userEvent.setup();
    await open(user);

    // Absent, not disabled. A required owner has no "unset" to offer, and a row that declines
    // silently is indistinguishable from a broken one.
    expect(screen.queryByRole('menuitem', { name: /^No/ })).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(PEOPLE.length);
  });

  it('leaves out the people it was told to exclude', async () => {
    const onSelect = vi.fn();
    render(
      withStore(
        storeWith(PEOPLE),
        <Harness noneLabel={null} onSelect={onSelect} exclude={new Set(['u-grace'])} />,
      ),
    );
    const user = userEvent.setup();
    await open(user);

    expect(screen.queryByRole('menuitem', { name: 'Grace Hopper' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Ada Lovelace' })).toBeTruthy();
  });
});

describe('UserPicker choosing several', () => {
  function Harness({ onToggle }: { onToggle: (id: UUID) => void }) {
    const trigger = useMenuTrigger();
    const [chosen, setChosen] = useState<ReadonlySet<UUID>>(new Set());
    return (
      <>
        <button {...trigger.props}>Open</button>
        <UserPicker
          multiple
          open={trigger.open}
          onClose={trigger.hide}
          trigger={trigger.ref}
          value={chosen}
          onToggle={(id) => {
            onToggle(id);
            setChosen((current) => {
              const next = new Set(current);
              if (!next.delete(id)) next.add(id);
              return next;
            });
          }}
          label="Members"
          filterPlaceholder="Add a member…"
        />
      </>
    );
  }

  it('toggles a person on and off without shutting between choices', async () => {
    const onToggle = vi.fn();
    render(withStore(storeWith(PEOPLE), <Harness onToggle={onToggle} />));
    const user = userEvent.setup();
    await open(user);

    await user.click(screen.getByRole('menuitem', { name: 'Ada Lovelace' }));
    // Still open: a set is built by several acts, and a menu that closed after each one would
    // make adding three people three round trips.
    expect(screen.getByRole('menu', { name: 'Members' })).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Ada Lovelace' }).getAttribute('aria-current'),
    ).toBe('true');

    await user.click(screen.getByRole('menuitem', { name: 'Grace Hopper' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ada Lovelace' }));

    expect(onToggle.mock.calls).toEqual([['u-ada'], ['u-grace'], ['u-ada']]);
    expect(
      screen.getByRole('menuitem', { name: 'Ada Lovelace' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Grace Hopper' }).getAttribute('aria-current'),
    ).toBe('true');
  });

  it('never offers a nobody row, because a set already expresses nobody', async () => {
    render(withStore(storeWith(PEOPLE), <Harness onToggle={vi.fn()} />));
    const user = userEvent.setup();
    await open(user);

    expect(screen.getAllByRole('menuitem')).toHaveLength(PEOPLE.length);
  });

  it('still closes on Escape, which is how somebody says they are finished', async () => {
    render(withStore(storeWith(PEOPLE), <Harness onToggle={vi.fn()} />));
    const user = userEvent.setup();
    await open(user);

    await user.click(screen.getByRole('menuitem', { name: 'Ada Lovelace' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Members' })).toBeNull();
  });
});
