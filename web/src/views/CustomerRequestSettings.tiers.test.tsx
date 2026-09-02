/**
 * The two writes on this screen that used to happen without asking and without saying so:
 * removing a tier, and the save-on-blur revenue unit.
 *
 * A sibling file rather than a case added to `CustomerRequestSettings.test.tsx`, whose
 * fixture starts with no tiers and an empty revenue unit — the states these cases need are
 * the ones that fixture does not have.
 */

import { render, screen, waitFor } from '@testing-library/react';
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

function renderSettings(mutate = vi.fn().mockResolvedValue({})) {
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
      customerTiers: ['Enterprise'],
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
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

describe('Customer request settings — tiers and the revenue unit', () => {
  it('asks before removing a tier, and does not remove it until told to', async () => {
    const { mutate, user } = renderSettings();

    await user.click(screen.getByRole('button', { name: 'Remove Enterprise' }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove this tier' }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0]![0] as {
      variables: { input: { customerTiers?: string[] } };
    };
    expect(call.variables.input.customerTiers).toEqual([]);
  });

  /** The refusal belongs inside the dialog the user is looking at, not on the page behind it. */
  it('keeps the dialog open and shows the refusal inside it', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('nope'));
    const { user } = renderSettings(mutate);

    await user.click(screen.getByRole('button', { name: 'Remove Enterprise' }));
    await user.click(screen.getByRole('button', { name: 'Remove this tier' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('That tier could not be removed.'));
  });

  /**
   * The save used to be silent, on a screen with no other feedback — indistinguishable from
   * the field having done nothing at all.
   */
  it('confirms the revenue unit saved', async () => {
    const { mutate, user } = renderSettings();

    await user.type(screen.getByLabelText('Revenue unit'), 'USD');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((node) => node.textContent === 'Saved')).toBe(true),
    );
  });

  /** A blur that changed nothing is not a save, and must not claim to be one. */
  it('does not write when the field was left exactly as it was found', async () => {
    const { mutate, user } = renderSettings();

    await user.click(screen.getByLabelText('Revenue unit'));
    await user.tab();

    expect(mutate).not.toHaveBeenCalled();
  });
});
