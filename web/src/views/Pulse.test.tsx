import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Pulse } from './Pulse';

const AT = '2026-08-20T12:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
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

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function renderPulse(extra: readonly Change[] = []) {
  const store = new Store('w1');
  store.applyChanges([
    upsert(1, 'workspace', {
      id: 'w1',
      name: 'Acme',
      urlKey: 'acme',
      plan: 'free',
      projectUpdateReminderIntervalDays: 7,
      projectUpdateReminderWeekday: 3,
      projectUpdateReminderHour: 9,
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'user', {
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
    upsert(3, 'project', {
      id: 'p1',
      workspaceId: 'w1',
      name: 'Launch',
      description: '',
      color: '#000',
      statusId: 'st1',
      priority: 0,
      sortOrder: 'a0',
      updateSchedule: 'default',
      leadId: 'u1',
      createdAt: AT,
      updatedAt: AT,
    }),
    ...extra,
  ]);
  const engine = { store } as unknown as SyncEngine;
  return render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Pulse />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Pulse', () => {
  it('renders a heading and empty copy when nothing has been posted', () => {
    renderPulse();
    expect(screen.getByRole('heading', { name: 'Pulse' })).toBeTruthy();
    expect(screen.getByText('Nothing for you yet')).toBeTruthy();
  });

  it('lists a project update on For me when the viewer leads the project', () => {
    renderPulse([
      upsert(4, 'projectUpdate', {
        id: 'u-1',
        workspaceId: 'w1',
        projectId: 'p1',
        health: 'at_risk',
        body: 'Slip this week.',
        authorId: 'u1',
        createdAt: AT,
        updatedAt: AT,
      }),
    ]);
    expect(screen.getByText('Launch')).toBeTruthy();
    expect(screen.getByText('Slip this week.')).toBeTruthy();
    expect(screen.getByText('At risk')).toBeTruthy();
  });
});
