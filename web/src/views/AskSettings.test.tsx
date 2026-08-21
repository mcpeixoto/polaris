import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AskSettings } from './AskSettings';

const AT = '2026-08-20T12:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({
    id: 'u1',
    workspaceId: 'w',
    name: 'Ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

function renderAsks() {
  const store = new Store('w');
  const engine = { store } as unknown as SyncEngine;
  return render(
    <MemoryRouter initialEntries={['/settings/asks']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AskSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('AskSettings', () => {
  it('points at Slack settings when Slack is not connected', () => {
    renderAsks();
    expect(screen.getByRole('heading', { name: 'Asks' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Settings → Slack/i })).toBeTruthy();
  });
});
