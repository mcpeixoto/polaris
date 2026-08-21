/**
 * Customer page leftovers: attributes and archive were on the API and missing here.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CustomerDetail } from './CustomerDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const CUSTOMER = 'c1';
const AT = '2026-01-01T00:00:00.000Z';

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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', {
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
    upsert(2, 'customer', {
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
    upsert(3, 'customer', {
      id: 'c2',
      workspaceId: WORKSPACE,
      name: 'Acme West',
      domains: ['west.acme.com'],
      status: 'active',
      logoUrl: '',
      sortOrder: 'b',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderDetail() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
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
  return { mutate, user: userEvent.setup() };
}

describe('Customer page leftovers', () => {
  it('has a heading', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeTruthy();
  });

  it('writes status through updateCustomer', async () => {
    const { mutate, user } = renderDetail();
    await user.selectOptions(screen.getByLabelText('Status'), 'churned');
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as { variables: { input: { status?: string } } };
    expect(input.variables.input.status).toBe('CHURNED');
  });

  it('archives and leaves the list', async () => {
    const { mutate, user } = renderDetail();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('heading', { name: 'Archive Acme?' })).toBeTruthy();
    const confirms = screen.getAllByRole('button', { name: 'Archive' });
    await user.click(confirms[confirms.length - 1]!);
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as { variables: { archived?: boolean } };
    expect(call.variables.archived).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeTruthy();
  });

  it('offers merge into another customer', async () => {
    const { mutate, user } = renderDetail();
    await user.selectOptions(screen.getByLabelText('Merge into'), 'c2');
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.getByRole('heading', { name: 'Merge Acme into Acme West?' })).toBeTruthy();
    const confirms = screen.getAllByRole('button', { name: 'Merge' });
    await user.click(confirms[confirms.length - 1]!);
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as {
      variables: { sourceId?: string; intoId?: string };
    };
    expect(call.variables.sourceId).toBe(CUSTOMER);
    expect(call.variables.intoId).toBe('c2');
  });
});
