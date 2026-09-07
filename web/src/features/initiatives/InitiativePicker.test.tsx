import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { EngineProvider } from '~/app/context';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { Store, type Change, type Initiative } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativePicker } from './InitiativePicker';

/**
 * The picker is tested against a real Store, like the issue pickers beside it: the rows it
 * offers are the product of a live query with a filter and a sort in it, and a mocked store
 * would keep answering correctly through exactly the change — an archived row that stops
 * being hidden, an exclusion that stops excluding — that puts a cycle in the graph.
 *
 * The two rules worth pinning are the ones a `<select>` could not express and that this
 * component exists for: an initiative is never offered as its own parent, and an archived
 * one is out of the list unless it is the value already set, because a pill has to be able
 * to show what it is holding.
 */

const WORKSPACE = 'workspace-1';

function initiative(id: string, name: string, extra: Partial<Initiative> = {}): Initiative {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status: 'active',
    priority: 0,
    sortOrder: 'V',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function storeWith(rows: readonly Initiative[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map((row, index) => ({
      v: index + 1,
      type: 'initiative',
      id: row.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: row,
    })) as Change[],
  );
  return store;
}

function Harness({
  store,
  ...props
}: { store: Store } & Omit<
  Parameters<typeof InitiativePicker>[0],
  'open' | 'onClose' | 'trigger'
>) {
  const trigger = useMenuTrigger();
  const engine = { store } as unknown as SyncEngine;
  return (
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      <button {...trigger.props}>Open</button>
      <InitiativePicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        {...props}
      />
    </EngineProvider>
  ) as ReactNode;
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

const ROWS = [
  initiative('i-reliability', 'Reliability'),
  initiative('i-growth', 'Growth'),
  initiative('i-old', 'Last year', { archivedAt: '2026-02-01T00:00:00Z' }),
];

describe('InitiativePicker', () => {
  it('offers the live initiatives by name and reports the chosen one', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness store={storeWith(ROWS)} value={null} onSelect={onSelect} />);

    await open(user);
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
    expect(names[0]).toContain('No initiative');
    expect(names.join(' ')).toContain('Growth');
    expect(names.join(' ')).toContain('Reliability');

    await user.click(screen.getByRole('menuitem', { name: /Growth/ }));
    expect(onSelect).toHaveBeenCalledWith('i-growth');
  });

  it('reports null from the empty row, because "no initiative" is a real answer', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness store={storeWith(ROWS)} value="i-growth" onSelect={onSelect} />);

    await open(user);
    await user.click(screen.getByRole('menuitem', { name: /No initiative/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('leaves the empty row out when the property must hold an initiative', async () => {
    const user = userEvent.setup();
    render(<Harness store={storeWith(ROWS)} value={null} onSelect={vi.fn()} noneLabel={null} />);

    await open(user);
    expect(screen.queryByRole('menuitem', { name: /No initiative/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Growth/ })).toBeTruthy();
  });

  it('never offers an excluded initiative, so nothing can be nested under itself', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        store={storeWith(ROWS)}
        value={null}
        onSelect={vi.fn()}
        exclude={new Set(['i-growth'])}
      />,
    );

    await open(user);
    expect(screen.queryByRole('menuitem', { name: /Growth/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Reliability/ })).toBeTruthy();
  });

  it('hides an archived initiative unless it is the value already set', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness store={storeWith(ROWS)} value={null} onSelect={vi.fn()} />);

    await open(user);
    expect(screen.queryByRole('menuitem', { name: /Last year/ })).toBeNull();
    unmount();

    render(<Harness store={storeWith(ROWS)} value="i-old" onSelect={vi.fn()} />);
    await open(user);
    const archived = screen.getByRole('menuitem', { name: /Last year/ });
    expect(archived.textContent).toContain('Archived');
  });
});
