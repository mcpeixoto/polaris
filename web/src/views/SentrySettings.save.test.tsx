/**
 * Settings → Sentry: what the screen says after a save, and where it says it.
 *
 * Same two defects as the Slack screen: a refusal landed in the page-top fetch banner, whose
 * "Try again" re-runs the query rather than the write, and a save that worked was silent.
 * The webhook secret's warning is asserted too, because it used to claim a one-time display
 * for a value this screen re-fetches on every visit.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { SentrySettings } from './SentrySettings';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

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

const sent = vi.mocked(gql);

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

/** A connected workspace with one public team, which is the state the save form needs. */
function seed(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', {
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
    upsert(2, 'sentryConnection', {
      id: 'c1',
      workspaceId: WORKSPACE,
      creatorId: VIEWER,
      enabled: true,
      defaultTeamId: 't1',
      organizationSlug: 'acme',
      connectedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

const SETTINGS = {
  sentryWebhook: { url: 'https://polaris.example/sentry/hook', secret: 'sentry-secret' },
};

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(
    async (query: string) => (query.includes('query SentrySettings') ? SETTINGS : {}) as never,
  );
});

function renderScreen() {
  const engine = { store: seed() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/sentry']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SentrySettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

/** The section the workspace form lives in, found by its own heading. */
function workspaceSection(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Workspace' });
  const section = heading.closest('section');
  if (section === null) throw new Error('the workspace heading is not inside a section');
  return section;
}

describe('SentrySettings saves', () => {
  it('puts a refused save in the section that produced it, not in the fetch banner', async () => {
    const user = renderScreen();
    await screen.findByRole('button', { name: 'Save' });

    sent.mockImplementation(async (query: string) => {
      if (query.includes('query SentrySettings')) return SETTINGS as never;
      throw new ApiError('VALIDATION', 'That organization slug does not exist.');
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const refusal = await screen.findByText('That organization slug does not exist.');
    expect(workspaceSection().contains(refusal)).toBe(true);
    // The fetch banner's remedy re-runs the query, so it must not be what a refused write
    // offers: the only way back from this one is to change the field and submit again.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('announces a save that landed', async () => {
    const user = renderScreen();
    await screen.findByRole('button', { name: 'Save' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(within(workspaceSection()).getByRole('status').textContent).toBe('Saved');
    });
  });

  it('warns about rotating the webhook secret rather than about a one-time display', async () => {
    renderScreen();
    await screen.findByLabelText('Webhook secret');

    expect(screen.getByText(/Rotating it takes effect at once/i)).toBeTruthy();
    expect(screen.queryByText(/not shown again/i)).toBeNull();
  });
});
