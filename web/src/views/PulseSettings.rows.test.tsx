/**
 * Settings → Pulse on the settings frame: the row draws the label, the control keeps the
 * name, and a change still writes.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { PulseSettings } from './PulseSettings';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

function renderPage() {
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
      pulseDigestCadence: 'daily',
      customerRequestsEnabled: true,
      customerRevenueUnit: '',
      customerTiers: [],
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <PulseSettings />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('PulseSettings rows', () => {
  it('sits on the settings frame with the page title as the h1', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Pulse' })).toBeTruthy();
  });

  it('keeps the controls named after their rows', () => {
    renderPage();
    expect(screen.getByRole('checkbox', { name: 'Enable Pulse' })).toBeTruthy();
    const digest = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Inbox digest' });
    expect(digest.value).toBe('daily');
  });

  it('still writes on change', async () => {
    const { mutate, user } = renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Enable Pulse' }));
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as { variables: { input: { pulseEnabled?: boolean } } };
    expect(call.variables.input.pulseEnabled).toBe(false);
  });
});
