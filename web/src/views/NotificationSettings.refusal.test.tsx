/**
 * What this screen says when a preference does not save.
 *
 * It said nothing. Every write was `updateNotificationPrefs(...).catch(report)`, the
 * stylesheet had no `.error` rule at all, and the control had already moved optimistically —
 * so a refusal left the page asserting a setting the server does not hold. This is the page
 * the digest email's `List-Unsubscribe` header links to, which makes that the one failure in
 * the product that must not be silent: a failed unsubscribe that says nothing reads as a
 * successful one, and the next digest is the first the reader hears of it.
 *
 * Offline is the other half and is deliberately *not* an error. The op stays in the outbox
 * and goes out on reconnect, so "not saved" would be untrue — it gets its own sentence.
 *
 * A separate file from `NotificationSettings.test.tsx` so nothing in that one had to move.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { NotificationSettings } from './NotificationSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

vi.mock('~/platform/runtime', () => ({
  requestNotificationPermission: () => Promise.resolve(true),
}));

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const user = {
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'Ana',
    displayName: 'Ana',
    role: 'member',
    status: 'active',
    kind: 'human',
    notificationPrefs: {},
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;

  store.applyChanges([
    { v: 1, type: 'user', id: VIEWER, op: 'upsert', actor: { type: 'system' }, payload: user },
  ] as Change[]);
  return store;
}

function renderScreen(rejection: unknown) {
  const store = seeded();
  const mutate = vi.fn().mockRejectedValue(rejection);
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <NotificationSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

/** An offline `ApiError`, which is what the sync layer throws when the request never left. */
function offline(): ApiError {
  const error = new ApiError('NETWORK', 'offline');
  Object.defineProperty(error, 'isOffline', { value: true });
  return error;
}

describe('NotificationSettings refusals', () => {
  it('says why a preference did not save', async () => {
    const user = renderScreen(new ApiError('FORBIDDEN', 'a guest may not change this'));

    await user.click(await screen.findByLabelText('Browser notifications'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('a guest may not change this');
    });
  });

  // Queued is not failed. Saying "not saved" about a write that is going out in a moment is
  // the same lie in the other direction.
  it('calls an offline write queued rather than refused', async () => {
    const user = renderScreen(offline());

    await user.click(await screen.findByLabelText('Browser notifications'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('offline');
    });
  });

  it('renders no alert region while nothing has failed', async () => {
    renderScreen(new ApiError('FORBIDDEN', 'nope'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
