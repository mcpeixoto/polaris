/**
 * Archiving a customer from its own page, and the way back.
 *
 * The offer is read out of the undo module rather than off a rendered `UndoToast`, because
 * what this file is about is the offer surviving the screen that made it: `confirmArchive`
 * navigates to the list, and a toast asserted through the tree would only prove that the
 * label rendered somewhere, not that the closure still names the right customer.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { snapshot } from '~/features/undo/offers';
import { clearUndoOffers } from '~/features/undo/UndoToast';
import { latest } from '~/features/undo/undo';
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

function renderDetail() {
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
  ]);
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

async function archive(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  const confirms = screen.getAllByRole('button', { name: 'Archive' });
  await user.click(confirms[confirms.length - 1]!);
  expect(await screen.findByRole('heading', { name: 'Customers' })).toBeTruthy();
}

afterEach(() => clearUndoOffers());

describe('archiving a customer', () => {
  it('offers an undo that names the customer', async () => {
    const { user } = renderDetail();
    await archive(user);

    expect(latest(snapshot())?.label).toBe('Archived Acme');
  });

  it('un-archives that customer when the undo is run', async () => {
    const { mutate, user } = renderDetail();
    await archive(user);

    mutate.mockClear();
    await latest(snapshot())!.undo();

    const call = mutate.mock.calls[0]![0] as { variables: { id: string; archived: boolean } };
    expect(call.variables).toMatchObject({ id: CUSTOMER, archived: false });
  });
});
