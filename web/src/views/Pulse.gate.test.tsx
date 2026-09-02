/**
 * "Nothing for you yet" is a claim about the workspace. It must not be made about a replica
 * that has not finished arriving.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Pulse } from './Pulse';

const AT = '2026-08-20T12:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewerRole: () => 'member',
  useViewer: () => ({
    id: 'u1',
    workspaceId: 'w1',
    name: 'Ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

function renderPulse(status: EngineStatus) {
  const engine = { store: new Store('w1') } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Pulse />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Pulse while the replica is still filling', () => {
  it('waits instead of saying the feed is empty', () => {
    renderPulse({ phase: 'bootstrapping', received: 0 });

    expect(screen.queryByText('Nothing for you yet')).toBeNull();
    expect(screen.getByText('Loading updates…')).toBeTruthy();
  });

  it('says the feed is empty once the store has settled', () => {
    renderPulse({ phase: 'ready', connection: 'ready', pending: 0 });

    expect(screen.getByText('Nothing for you yet')).toBeTruthy();
  });
});
