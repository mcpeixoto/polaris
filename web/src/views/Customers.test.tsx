/**
 * The customer list: the four controls it grew, and the keyboard that reaches the rows.
 *
 * A search box is the one control this screen could not do without — customers are filed
 * under nothing, so a workspace with three hundred of them had one flat alphabet and a
 * scrollbar — and the status pills and the tier column are the two questions asked of it
 * that the rows could not previously answer.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    [
      customer('c-acme', 'Acme', { tier: 'Enterprise', domains: ['acme.example'] }),
      customer('c-blue', 'Bluebird', { status: 'prospect', tier: 'Starter' }),
      customer('c-cinder', 'Cinder', { status: 'churned' }),
    ].map(
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
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/customers']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/customers" element={<Customers />} />
            <Route path="/customer/:id" element={<p>opened</p>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

function names(): string[] {
  return screen.getAllByRole('option').map((row) => row.textContent ?? '');
}

afterEach(cleanup);

describe('Customers controls', () => {
  it('searches by name and by domain, which is how half a workspace refers to a customer', async () => {
    const user = mount(seeded());
    const field = screen.getByRole('searchbox', { name: 'Search customers' });

    await user.type(field, 'blue');
    expect(names().map((text) => text.slice(0, 8))).toEqual(['Bluebird']);

    await user.clear(field);
    await user.type(field, 'acme.example');
    expect(names()[0]).toContain('Acme');
  });

  it('filters by status through the segmented pills', async () => {
    const user = mount(seeded());

    await user.click(
      within(screen.getByRole('group', { name: 'Which customers' })).getByRole('button', {
        name: 'Prospect',
      }),
    );

    expect(names()).toHaveLength(1);
    expect(names()[0]).toContain('Bluebird');
  });

  it('shows the tier, and says so when a customer has none', () => {
    mount(seeded());

    expect(within(screen.getByRole('link', { name: /Acme/ })).getByText('Enterprise')).toBeTruthy();
    // A blank cell reads as missing data; "No tier" is the fact.
    expect(within(screen.getByRole('link', { name: /Cinder/ })).getByText('No tier')).toBeTruthy();
  });

  it('sorts by requests when asked, and by name otherwise', async () => {
    const store = seeded();
    store.applyChanges([
      {
        v: 10,
        type: 'customerRequest',
        id: 'r1',
        op: 'upsert',
        actor: { type: 'system' },
        payload: {
          id: 'r1',
          workspaceId: WORKSPACE,
          customerId: 'c-cinder',
          body: 'Please',
          important: false,
          createdAt: AT,
          updatedAt: AT,
        },
      } as Change,
    ]);
    const user = mount(store);

    expect(names()[0]).toContain('Acme');

    await user.click(
      within(screen.getByRole('group', { name: 'Sort customers' })).getByRole('button', {
        name: 'Requests',
      }),
    );
    expect(names()[0]).toContain('Cinder');
  });

  it('says nothing matches rather than that there are no customers', async () => {
    const user = mount(seeded());

    await user.type(screen.getByRole('searchbox', { name: 'Search customers' }), 'zzz');

    expect(screen.getByText('Nothing matches')).toBeTruthy();
    expect(screen.queryByText('No customers yet')).toBeNull();
  });
});

describe('Customers keyboard', () => {
  it('moves a cursor with j and k and opens the row under it', async () => {
    const user = mount(seeded());

    await user.keyboard('j');
    expect(screen.getAllByRole('option')[1]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('k');
    expect(screen.getAllByRole('option')[0]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('opened')).toBeTruthy());
  });
});
