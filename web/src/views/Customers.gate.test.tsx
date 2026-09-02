/**
 * An empty customer list and a customer list that has not arrived look identical to a live
 * query, and only one of them should be offered "No customers yet".
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Customers } from './Customers';

const WORKSPACE = 'w1';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewerRole: () => 'admin',
}));

function renderCustomers(status: EngineStatus) {
  const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Customers />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Customers', () => {
  it('waits while the replica is still filling', () => {
    renderCustomers({ phase: 'hydrating' });

    expect(screen.queryByText('No customers yet')).toBeNull();
    expect(screen.getByText('Loading customers…')).toBeTruthy();
  });

  it('offers the first customer once the store has settled', () => {
    renderCustomers({ phase: 'ready', connection: 'ready', pending: 0 });

    expect(screen.getByText('No customers yet')).toBeTruthy();
  });
});
