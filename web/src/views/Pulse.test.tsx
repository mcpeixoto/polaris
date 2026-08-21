import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      pulseEnabled: true,
      pulseDigestCadence: 'daily',
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

  it('offers Popular, Recent, and New feed alongside For me', async () => {
    const user = userEvent.setup();
    renderPulse();
    expect(screen.getByRole('tab', { name: 'For me' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Popular' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Recent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New feed' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Popular' }));
    expect(screen.getByText('Nothing popular yet')).toBeTruthy();
  });

  it('lists a personal feed as a tab and filters to its projects', async () => {
    const user = userEvent.setup();
    renderPulse([
      upsert(4, 'project', {
        id: 'p2',
        workspaceId: 'w1',
        name: 'Other',
        description: '',
        color: '#000',
        statusId: 'st1',
        priority: 0,
        sortOrder: 'a0',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(5, 'pulseFeed', {
        id: 'f1',
        workspaceId: 'w1',
        userId: 'u1',
        name: 'Shipping',
        projectIds: ['p1'],
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(6, 'projectUpdate', {
        id: 'u-1',
        workspaceId: 'w1',
        projectId: 'p1',
        health: 'on_track',
        body: 'Launch note.',
        authorId: 'u1',
        createdAt: AT,
        updatedAt: AT,
      }),
      upsert(7, 'projectUpdate', {
        id: 'u-2',
        workspaceId: 'w1',
        projectId: 'p2',
        health: 'on_track',
        body: 'Other note.',
        authorId: 'u1',
        createdAt: AT,
        updatedAt: AT,
      }),
    ]);
    expect(screen.getByRole('tab', { name: 'Shipping' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Shipping' }));
    expect(screen.getByText('Launch note.')).toBeTruthy();
    expect(screen.queryByText('Other note.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit feed' })).toBeTruthy();
  });
});
