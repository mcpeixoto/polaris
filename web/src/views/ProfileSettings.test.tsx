/**
 * Profile and workspace general: the two settings pages that already had mutations and
 * no screen.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProfileSettings } from './ProfileSettings';
import { WorkspaceSettings } from './WorkspaceSettings';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'workspace', {
      id: WORKSPACE,
      name: 'Acme',
      urlKey: 'acme',
      plan: 'free',
      projectUpdateReminderIntervalDays: 7,
      projectUpdateReminderWeekday: 3,
      projectUpdateReminderHour: 9,
      pulseEnabled: true,
      customerRequestsEnabled: true,
      customerRevenueUnit: '',
      customerTiers: [],
      pulseDigestCadence: 'off',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'user', {
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
  ]);
  return store;
}

function renderProfile() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProfileSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

function renderWorkspace() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <WorkspaceSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Profile settings', () => {
  it('has a heading', () => {
    renderProfile();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
  });

  it('saves a display name on blur', async () => {
    const { mutate, user } = renderProfile();
    const field = screen.getByLabelText('Display name');
    await user.clear(field);
    await user.type(field, 'Ada');
    await user.tab();
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as { variables: { input: { displayName?: string } } };
    expect(input.variables.input.displayName).toBe('Ada');
  });
});

describe('Workspace settings', () => {
  it('has a heading and shows the URL key as read-only', () => {
    renderWorkspace();
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeTruthy();
    const slug = screen.getByLabelText('URL key');
    expect(slug).toHaveProperty('readOnly', true);
    expect((slug as HTMLInputElement).value).toBe('acme');
  });

  it('saves the workspace name on blur', async () => {
    const { mutate, user } = renderWorkspace();
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Polaris');
    await user.tab();
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as { variables: { input: { name?: string } } };
    expect(input.variables.input.name).toBe('Polaris');
  });
});
