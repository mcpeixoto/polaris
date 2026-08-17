/**
 * The preferences screen, and the one thing about it that is easy to get wrong.
 *
 * `updateNotificationPrefs(prefs: JSON!)` *replaces* the bag rather than merging into it. So
 * every write from this screen has to carry the keys it does not render, or changing a digest
 * cadence would delete a preference some future build added — silently, and in the direction
 * nobody notices, because the deleted preference falls back to its default and defaults look
 * like choices.
 *
 * The muted set is the other half of the same care. It goes on the wire as an array, which is
 * what the server decodes; it was a map on one side and an array on the other for a while and
 * muting did nothing at all. See services/internal/domain/notification_prefs.go.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { NotificationSettings } from './NotificationSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

function seeded(prefs: unknown): Store {
  const store = new Store(WORKSPACE);
  const user = {
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'Ana',
    displayName: 'Ana',
    role: 'member',
    status: 'active',
    kind: 'human',
    ...(prefs === undefined ? null : { notificationPrefs: prefs }),
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;

  store.applyChanges([
    { v: 1, type: 'user', id: VIEWER, op: 'upsert', actor: { type: 'system' }, payload: user },
  ] as Change[]);
  return store;
}

function renderScreen(prefs?: unknown) {
  const store = seeded(prefs);
  const mutate = vi.fn().mockResolvedValue({});
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

  return { store, mutate, user: userEvent.setup() };
}

describe('the notification preferences screen', () => {
  let harness: ReturnType<typeof renderScreen>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to a daily digest with no per-notification email', () => {
    harness = renderScreen({});
    const digest = screen.getByRole('combobox', { name: /digest/i }) as HTMLSelectElement;
    expect(digest.value).toBe('daily');
    const every = screen.getByRole('checkbox', {
      name: /email me for every notification/i,
    }) as HTMLInputElement;
    expect(every.checked).toBe(false);
  });

  it('sends the muted types as an array, which is what the server decodes', async () => {
    harness = renderScreen({});
    await harness.user.click(screen.getByRole('checkbox', { name: 'Comments' }));

    expect(harness.mutate).toHaveBeenCalledTimes(1);
    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(Array.isArray(prefs['muted'])).toBe(true);
    expect(prefs['muted']).toEqual(['comment']);
  });

  it('unmutes by removing from the array rather than by writing false', async () => {
    harness = renderScreen({ muted: ['comment', 'mention'] });
    await harness.user.click(screen.getByRole('checkbox', { name: 'Comments' }));

    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(prefs['muted']).toEqual(['mention']);
  });

  it('a muted type shows as switched off, because the switch says what arrives', () => {
    harness = renderScreen({ muted: ['mention'] });
    const mention = screen.getByRole('checkbox', { name: 'Mentions' }) as HTMLInputElement;
    const comments = screen.getByRole('checkbox', { name: 'Comments' }) as HTMLInputElement;
    expect(mention.checked).toBe(false);
    expect(comments.checked).toBe(true);
  });

  it('carries keys it does not render, because the mutation replaces the bag', async () => {
    // A preference from a build newer than this one. Dropping it here would delete somebody's
    // setting as a side effect of them changing an unrelated one.
    harness = renderScreen({ muted: ['comment'], somethingNewer: 'kept' });
    await harness.user.selectOptions(screen.getByRole('combobox', { name: /digest/i }), 'weekly');

    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(prefs['emailDigest']).toBe('weekly');
    expect(prefs['muted']).toEqual(['comment']);
    expect(prefs['somethingNewer']).toBe('kept');
  });

  it('offers hourly, which the server accepts and the client used not to declare', () => {
    harness = renderScreen({});
    const options = screen
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['off', 'hourly', 'daily', 'weekly']);
  });
});
