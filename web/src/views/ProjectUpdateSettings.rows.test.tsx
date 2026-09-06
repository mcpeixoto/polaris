/**
 * Settings → Project updates on the settings frame. The row's label is drawn, not wired, so
 * the field must carry the same name itself; the hint moved to the row's description.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectUpdateSettings } from './ProjectUpdateSettings';

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
      pulseDigestCadence: 'off',
      customerRequestsEnabled: true,
      customerRevenueUnit: '',
      customerTiers: [],
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ProjectUpdateSettings />
      </EngineProvider>
    </KeymapProvider>,
  );
}

describe('ProjectUpdateSettings rows', () => {
  it('sits on the settings frame with the page title as the h1', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Project updates' })).toBeTruthy();
  });

  it('keeps each field named after its row', () => {
    renderPage();
    expect(screen.getByRole('spinbutton', { name: 'Reminder interval' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Reminder weekday' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Reminder hour' })).toBeTruthy();
  });

  it('says what each field takes, in the row', () => {
    renderPage();
    expect(screen.getByText('Days between updates, 1–365.')).toBeTruthy();
    expect(screen.getByText('Hour of that day, 0–23.')).toBeTruthy();
  });
});
