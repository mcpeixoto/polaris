/**
 * The customer header's menu, whichever way it was opened.
 *
 * The ⋯ button and a right-click on the header render the same array, built by the same
 * helper the list uses — less `Open customer`, which is the customer already open. Merge and
 * the status change were `<select>`s and a button in the header and nothing else; the menu
 * puts them where the list screen's equivalents are.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Customer, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CustomerDetail } from './CustomerDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const CUSTOMER = 'c1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
  useViewerRole: () => 'admin',
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function customer(id: string, name: string): Customer {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    domains: [],
    status: 'active',
    logoUrl: '',
    sortOrder: 'a',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'customer', customer(CUSTOMER, 'Acme')),
    upsert(2, 'customer', customer('c2', 'Bluebird')),
  ]);
  return store;
}

function mount() {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/customer/${CUSTOMER}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/customer/:customerId" element={<CustomerDetail />} />
            <Route path="/customers" element={<h1>Customers</h1>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

/** What a menu offers, in the order it offers it. */
function labels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

afterEach(cleanup);

describe('CustomerDetail header menu', () => {
  it('opens on a right-click of the header, not only from the ⋯ button', async () => {
    const { user } = mount();

    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('banner') });

    const menu = await screen.findByRole('menu', { name: 'Options for Acme' });
    expect(labels(menu)).toContain('Copy link');
  });

  it('offers the same items in the same order whichever way it was opened', async () => {
    const kebab = mount();
    await kebab.user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    const fromKebab = labels(await screen.findByRole('menu', { name: 'Customer options' }));
    cleanup();

    const right = mount();
    await right.user.pointer({ keys: '[MouseRight]', target: screen.getByRole('banner') });
    const fromRightClick = labels(await screen.findByRole('menu', { name: 'Options for Acme' }));

    expect(fromRightClick).toEqual(fromKebab);
    // `Open customer` is the one list row dropped: this is the customer it would open.
    expect(fromKebab).toEqual(['Copy link', 'Status', 'Merge into', 'Archive customer']);
  });

  it('writes the status the submenu was asked for', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Customer options' })).getByRole('menuitem', {
        name: 'Status',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Prospect' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0]?.[0] as { variables: { input: Record<string, unknown> } };
    expect(call.variables.input).toMatchObject({ id: CUSTOMER, status: 'PROSPECT' });
  });

  it('asks before archiving, and archives only once the answer is yes', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive customer' }));

    expect(mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Archive Acme?' });

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0]?.[0] as { variables: Record<string, unknown> };
    expect(call.variables).toMatchObject({ id: CUSTOMER, archived: true });
  });

  it('asks before merging, and merges into the customer the submenu named', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Customer options' })).getByRole('menuitem', {
        name: 'Merge into',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Bluebird' }));

    expect(mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Merge Acme into Bluebird?' });

    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0]?.[0] as { variables: Record<string, unknown> };
    expect(call.variables).toMatchObject({ sourceId: CUSTOMER, intoId: 'c2' });
  });
});
