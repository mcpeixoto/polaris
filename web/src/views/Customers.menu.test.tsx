/**
 * The customer list's row menu, whichever way it was opened.
 *
 * Until this the list was rows and nothing else: changing a customer's status or getting it
 * out of the list meant opening it first. The ⋯ button and a right-click render the same
 * array, from the same builder every other list uses, so the two cannot drift apart.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Customer, type CustomerStatus } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Customers } from './Customers';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewerRole: () => 'admin',
}));

function customer(
  id: string,
  name: string,
  extra: Partial<Customer> & { status?: CustomerStatus } = {},
): Customer {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    domains: [],
    status: 'active',
    logoUrl: '',
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    [customer('c-acme', 'Acme'), customer('c-blue', 'Bluebird', { status: 'prospect' })].map(
      (payload, index) =>
        ({
          v: index + 1,
          type: 'customer',
          id: payload.id,
          op: 'upsert',
          actor: { type: 'system' },
          payload,
        }) as Change,
    ),
  );
  return store;
}

function mount(store: Store) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/customers']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/customers" element={<Customers />} />
            <Route path="/customer/:customerId" element={<p>opened</p>} />
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

function row(name: string): HTMLElement {
  return screen.getByRole('option', { name: new RegExp(name) });
}

afterEach(cleanup);

describe('Customers row menu', () => {
  it('opens on a right-click of the row, not only from the kebab', async () => {
    const { user } = mount(seeded());

    await user.pointer({ keys: '[MouseRight]', target: row('Acme') });

    const menu = await screen.findByRole('menu', { name: 'Options for Acme' });
    expect(labels(menu)).toContain('Open customer');
  });

  it('offers the same items in the same order whichever way it was opened', async () => {
    const kebab = mount(seeded());
    await kebab.user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    const fromKebab = labels(await screen.findByRole('menu', { name: 'Options for Acme' }));
    cleanup();

    const right = mount(seeded());
    await right.user.pointer({ keys: '[MouseRight]', target: row('Acme') });
    const fromRightClick = labels(await screen.findByRole('menu', { name: 'Options for Acme' }));

    expect(fromRightClick).toEqual(fromKebab);
    expect(fromKebab).toEqual(['Open customer', 'Copy link', 'Status', 'Archive customer']);
  });

  it('writes the status the submenu was asked for, and only when it changes', async () => {
    const { user, mutate } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Options for Acme' })).getByRole('menuitem', {
        name: 'Status',
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Churned' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0]?.[0] as { variables: { input: Record<string, unknown> } };
    expect(call.variables.input).toMatchObject({ id: 'c-acme', status: 'CHURNED' });
  });

  it('asks before archiving, and archives only once the answer is yes', async () => {
    const { user, mutate } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive customer' }));

    // Nothing has been written yet: the row is still there and the question is on screen.
    expect(mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Archive Acme?' });

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0]?.[0] as { variables: Record<string, unknown> };
    expect(call.variables).toMatchObject({ id: 'c-acme', archived: true });
  });

  it('acts on the row that was right-clicked, not on wherever the cursor was', async () => {
    const { user } = mount(seeded());

    await user.pointer({ keys: '[MouseRight]', target: row('Bluebird') });

    const menu = await screen.findByRole('menu', { name: 'Options for Bluebird' });
    expect(labels(menu)).toContain('Archive customer');
  });
});
