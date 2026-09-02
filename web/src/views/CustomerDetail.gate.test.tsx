/**
 * The two things this page used to get wrong when something did not go to plan: it called a
 * row that had not arrived yet "No such customer", and it swallowed every failed write.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

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

function seeded(withCustomer: boolean): Store {
  const store = new Store(WORKSPACE);
  const changes: Change[] = [];
  if (withCustomer) {
    changes.push(
      upsert(1, 'customer', {
        id: CUSTOMER,
        workspaceId: WORKSPACE,
        name: 'Acme',
        domains: ['acme.com'],
        status: 'active',
        logoUrl: '',
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      }),
    );
  }
  store.applyChanges(changes);
  return store;
}

function renderDetail(options: {
  withCustomer: boolean;
  status: EngineStatus;
  mutate?: ReturnType<typeof vi.fn>;
}) {
  const mutate = options.mutate ?? vi.fn().mockResolvedValue({});
  const engine = { store: seeded(options.withCustomer), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/customer/${CUSTOMER}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={options.status}>
          <Routes>
            <Route path="/customer/:customerId" element={<CustomerDetail />} />
            <Route path="/customers" element={<h1>Customers</h1>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('CustomerDetail while the replica is still filling', () => {
  it('waits rather than claiming the customer does not exist', () => {
    renderDetail({ withCustomer: false, status: { phase: 'hydrating' } });

    expect(screen.queryByText('No such customer')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Loading customer…')).toBeTruthy();
  });

  it('says the customer is gone once the store has settled', () => {
    renderDetail({
      withCustomer: false,
      status: { phase: 'ready', connection: 'ready', pending: 0 },
    });

    expect(screen.getByText('No such customer')).toBeTruthy();
  });
});

describe('CustomerDetail write failures', () => {
  it('tells the reader when a property could not be saved', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('offline'));
    const { user } = renderDetail({
      withCustomer: true,
      status: { phase: 'idle' },
      mutate,
    });

    await user.selectOptions(screen.getByLabelText('Status'), 'churned');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That change could not be saved.');
  });
});
