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

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { NotificationSettings } from './NotificationSettings';

// The phone controls reuse the mute list's labels, so an unscoped `getByRole('checkbox',
// { name: 'Comments' })` matches two and throws. Each test asks inside the section it means.
vi.mock('~/features/inbox/push', async () => {
  const actual =
    await vi.importActual<typeof import('~/features/inbox/push')>('~/features/inbox/push');
  return {
    ...actual,
    enableThisDevice: vi.fn().mockResolvedValue('https://push.example/device'),
    disableThisDevice: vi.fn().mockResolvedValue(undefined),
    thisDeviceEndpoint: vi.fn().mockResolvedValue(null),
    pushAvailability: () => ({ supported: true, needsHomeScreen: false }),
  };
});

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

async function renderScreen(prefs?: unknown) {
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

  // The device lookup resolves on the next turn. Leaving it pending prints an act()
  // warning after the assertion, which is that update landing outside the test.
  await act(async () => {
    await Promise.resolve();
  });

  return { store, mutate, user: userEvent.setup() };
}

function region(name: string) {
  return within(screen.getByRole('region', { name }));
}

describe('the notification preferences screen', () => {
  let harness: Awaited<ReturnType<typeof renderScreen>>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to a daily digest with no per-notification email', async () => {
    harness = await renderScreen({});
    const digest = screen.getByRole('combobox', { name: /digest/i }) as HTMLSelectElement;
    expect(digest.value).toBe('daily');
    const every = screen.getByRole('checkbox', {
      name: /email me for every notification/i,
    }) as HTMLInputElement;
    expect(every.checked).toBe(false);
  });

  it('sends the muted types as an array, which is what the server decodes', async () => {
    harness = await renderScreen({});
    await harness.user.click(
      region('What to notify me about').getByRole('checkbox', { name: 'Comments' }),
    );

    expect(harness.mutate).toHaveBeenCalledTimes(1);
    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(Array.isArray(prefs['muted'])).toBe(true);
    expect(prefs['muted']).toEqual(['comment']);
  });

  it('unmutes by removing from the array rather than by writing false', async () => {
    harness = await renderScreen({ muted: ['comment', 'mention'] });
    await harness.user.click(
      region('What to notify me about').getByRole('checkbox', { name: 'Comments' }),
    );

    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(prefs['muted']).toEqual(['mention']);
  });

  it('a muted type shows as switched off, because the switch says what arrives', async () => {
    harness = await renderScreen({ muted: ['mention'] });
    const about = region('What to notify me about');
    const mention = about.getByRole('checkbox', { name: 'Mentions' }) as HTMLInputElement;
    const comments = about.getByRole('checkbox', { name: 'Comments' }) as HTMLInputElement;
    expect(mention.checked).toBe(false);
    expect(comments.checked).toBe(true);
  });

  it('carries keys it does not render, because the mutation replaces the bag', async () => {
    // A preference from a build newer than this one. Dropping it here would delete somebody's
    // setting as a side effect of them changing an unrelated one.
    harness = await renderScreen({ muted: ['comment'], somethingNewer: 'kept' });
    await harness.user.selectOptions(screen.getByRole('combobox', { name: /digest/i }), 'weekly');

    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(prefs['emailDigest']).toBe('weekly');
    expect(prefs['muted']).toEqual(['comment']);
    expect(prefs['somethingNewer']).toBe('kept');
  });

  it('offers hourly, which the server accepts and the client used not to declare', async () => {
    harness = await renderScreen({});
    const options = screen
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['off', 'hourly', 'daily', 'weekly']);
  });

  it('leaves the phone on the quiet default until somebody changes it', async () => {
    harness = await renderScreen({});
    const phone = region('iPhone and browser');
    for (const name of [
      'Issues assigned to me',
      'Mentions',
      'Priority raised',
      'Blocked',
      'Due dates',
    ]) {
      expect((phone.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(true);
    }
    for (const name of ['Status changes', 'Comments', 'Sub-issues completed']) {
      expect((phone.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(false);
    }
  });

  it('writes an explicit push list, so turning the last type off is not the default coming back', async () => {
    harness = await renderScreen({});
    await harness.user.click(
      region('iPhone and browser').getByRole('checkbox', { name: 'Comments' }),
    );

    const prefs = harness.mutate.mock.calls[0]?.[0].variables.prefs as Record<string, unknown>;
    expect(prefs['push']).toEqual([
      'issue_assigned',
      'mention',
      'issue_priority_raised',
      'issue_blocked',
      'issue_due',
      'comment',
    ]);
  });

  it('keeps an empty push list empty, which is the phone staying silent', async () => {
    harness = await renderScreen({ push: [] });
    const boxes = region('iPhone and browser').getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((box) => box.checked === false)).toBe(true);
  });

  it('does not offer the phone for a type that is muted', async () => {
    harness = await renderScreen({ muted: ['mention'] });
    const mention = region('iPhone and browser').getByRole('checkbox', {
      name: 'Mentions',
    }) as HTMLInputElement;
    expect(mention.disabled).toBe(true);
    expect(mention.checked).toBe(false);
  });

  it('asks this device only when the button is pressed', async () => {
    const push = await import('~/features/inbox/push');
    harness = await renderScreen({});
    expect(push.enableThisDevice).not.toHaveBeenCalled();

    const button = screen.getByRole('button', { name: 'Turn on this device' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await harness.user.click(button);
    expect(push.enableThisDevice).toHaveBeenCalledTimes(1);
  });

  it('explains that an iPhone only hears these from the Home Screen', async () => {
    harness = await renderScreen({});
    expect(screen.getByRole('region', { name: 'iPhone and browser' }).textContent).toMatch(
      /Home Screen/,
    );
  });
});
