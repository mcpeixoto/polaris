/**
 * A deep link on a cold start waits for the replica instead of announcing a deletion.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { InitiativeShell } from './InitiativeShell';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => null,
  useViewer: () => null,
}));

function renderShell(status: EngineStatus) {
  const engine = { store: new Store('w1'), mutate: async () => ({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/initiative/missing']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('InitiativeShell entity gate', () => {
  it('shows a skeleton while the replica is still hydrating', () => {
    renderShell({ phase: 'hydrating' });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('No such initiative')).toBeNull();
  });

  it('shows a skeleton while the first snapshot is still arriving', () => {
    renderShell({ phase: 'bootstrapping', received: 12 });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('No such initiative')).toBeNull();
  });

  it('says the initiative is not there once the store has settled', () => {
    renderShell({ phase: 'ready', connection: 'ready', pending: 0 });
    expect(screen.getByText('No such initiative')).toBeTruthy();
  });
});
