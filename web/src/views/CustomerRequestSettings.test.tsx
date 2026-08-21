/**
 * Settings → Customer requests: the toggle, default team, and tiers.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CustomerRequestSettings } from './CustomerRequestSettings';

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

function renderSettings() {
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
      pulseDigestCadence: 'off',
      customerRequestsEnabled: true,
      customerRevenueUnit: '',
      customerTiers: [],
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'team', {
      id: 't1',
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      timezone: 'UTC',
      private: false,
      estimateScale: 'none',
      estimateAllowZero: false,
      estimateExtended: false,
      cyclesEnabled: false,
      cycleDurationWeeks: 1,
      cycleCooldownWeeks: 0,
      cycleStartDay: 'monday',
      cycleUpcomingCount: 2,
      cycleAutoAddStarted: false,
      cycleAutoAddCompleted: false,
      triageEnabled: false,
      triageRequirePriority: false,
      autoCloseDays: 0,
      autoArchiveDays: 0,
      autoCloseParent: false,
      autoCloseChildren: false,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CustomerRequestSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Customer request settings', () => {
  it('has a heading', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Customer requests' })).toBeTruthy();
  });

  it('saves the toggle', async () => {
    const { mutate, user } = renderSettings();
    await user.click(screen.getByLabelText('Enable customer requests'));
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as {
      variables: { input: { customerRequestsEnabled?: boolean } };
    };
    expect(input.variables.input.customerRequestsEnabled).toBe(false);
  });

  it('adds a tier', async () => {
    const { mutate, user } = renderSettings();
    await user.type(screen.getByLabelText('Tier name'), 'Enterprise');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as {
      variables: { input: { customerTiers?: string[] } };
    };
    expect(input.variables.input.customerTiers).toEqual(['Enterprise']);
  });
});
