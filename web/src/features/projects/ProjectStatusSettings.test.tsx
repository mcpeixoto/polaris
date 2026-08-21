/**
 * Workspace project statuses: create, default, archive. The mutations already existed
 * on the API; this is the settings page.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectStatusSettings } from './ProjectStatusSettings';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
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
    upsert(2, 'projectStatus', {
      id: 'ps-backlog',
      workspaceId: WORKSPACE,
      name: 'Backlog',
      color: '#6b7280',
      category: 'backlog',
      position: 'a',
      isDefault: true,
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(3, 'projectStatus', {
      id: 'ps-started',
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'b',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderPage() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({
    createProjectStatus: {
      status: {
        id: 'ps-new',
        workspaceId: WORKSPACE,
        name: 'Shipped',
        color: '#6b7280',
        category: 'COMPLETED',
        position: 'c',
        isDefault: false,
        createdAt: AT,
        updatedAt: AT,
      },
    },
  });
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectStatusSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Project status settings', () => {
  it('has a heading and groups live statuses by category', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Project statuses' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Started' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Planned' })).toBeNull();
  });

  it('creates a status in the chosen category', async () => {
    const { mutate, user } = renderPage();
    await user.type(screen.getByLabelText('New status'), 'Shipped');
    await user.selectOptions(screen.getByLabelText('Category'), 'completed');
    await user.click(screen.getByRole('button', { name: 'Add status' }));
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as {
      variables: { input: { name?: string; category?: string } };
    };
    expect(input.variables.input.name).toBe('Shipped');
    expect(input.variables.input.category).toBe('COMPLETED');
  });

  it('promotes a status to the workspace default', async () => {
    const { mutate, user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Make default' }));
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as {
      variables: { input: { id?: string; isDefault?: boolean } };
    };
    expect(input.variables.input.id).toBe('ps-started');
    expect(input.variables.input.isDefault).toBe(true);
  });
});
