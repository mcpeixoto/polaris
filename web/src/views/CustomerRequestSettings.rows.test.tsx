/**
 * Customer request settings as rows: the row draws the label and the hint, and each control
 * still carries its own name.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CustomerRequestSettings } from './CustomerRequestSettings';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({ id: 'u1', workspaceId: WORKSPACE, role: 'admin' }),
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
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
      customerRevenueUnit: 'USD',
      customerTiers: ['Enterprise', 'Pro'],
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CustomerRequestSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('CustomerRequestSettings rows', () => {
  it('keeps every control named after its row', () => {
    renderSettings();
    expect(screen.getByRole('checkbox', { name: 'Enable customer requests' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Default team' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Revenue unit' }).value).toBe(
      'USD',
    );
    expect(screen.getByRole('textbox', { name: 'Tier name' })).toBeTruthy();
  });

  it('moves the hints into the rows', () => {
    renderSettings();
    expect(
      screen.getByText('Used when creating an issue from a customer page. Public teams only.'),
    ).toBeTruthy();
    expect(
      screen.getByText("Shown next to a customer's revenue. USD, seats, or leave blank."),
    ).toBeTruthy();
  });

  it('lists the tiers with a named remove button each', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: 'Remove Enterprise' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Pro' })).toBeTruthy();
    expect(screen.queryByText('No tiers yet. The customer page accepts any label.')).toBeNull();
  });
});
