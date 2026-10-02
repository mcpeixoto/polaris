/**
 * Account deletion is a row on the profile, with a confirm that names what it does.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProfileSettings } from './ProfileSettings';

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

const deleteAccount = vi.fn();

vi.mock('~/features/authorisedOauth/mutations', () => ({
  leaveWorkspace: vi.fn(),
  deleteAccount: () => deleteAccount(),
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

describe('Delete account', () => {
  it('asks before it deletes the login', async () => {
    deleteAccount.mockReset();
    deleteAccount.mockResolvedValue(undefined);
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
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider
            engine={{ store, mutate: vi.fn() } as unknown as SyncEngine}
            status={{ phase: 'idle' }}
          >
            <ProfileSettings />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(deleteAccount).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect(deleteAccount).toHaveBeenCalledOnce();
  });
});
