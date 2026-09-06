/**
 * SLA settings as rows: the three selects carry the names their rows draw, and the duration
 * row is absent — not disabled — when the action has no duration.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { SlaSettings } from './SlaSettings';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({ id: 'u1', workspaceId: 'w1', role: 'admin' }),
}));

/** The screen is gated on the plan; these cases are about the rows, not the gate. */
vi.mock('~/features/admin/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/admin/entitlements')>();
  return { ...actual, useEntitlements: () => null, featureBlock: () => null };
});

function renderSettings() {
  const store = new Store('w1');
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SlaSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('SlaSettings rows', () => {
  it('keeps the selects named after their rows', () => {
    renderSettings();
    expect(screen.getByRole('combobox', { name: 'When' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Do' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Duration' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();
  });

  it('drops the duration row when the action removes the SLA', async () => {
    const user = renderSettings();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Do' }), 'remove');
    expect(screen.queryByRole('combobox', { name: 'Duration' })).toBeNull();
    expect(screen.queryByText('Duration')).toBeNull();
  });

  it('offers the defaults from the empty state on the same card', () => {
    renderSettings();
    expect(screen.getByText('No SLA rules')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load defaults' })).toBeTruthy();
  });
});
