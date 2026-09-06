/**
 * Sentry settings as rows, seen by an admin with a connection: the row draws the label and
 * the control keeps the name, and the danger zone's own button opens the confirm dialog.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import { gql } from '~/sync/api';
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
  useViewer: () => ({ id: VIEWER, workspaceId: WORKSPACE, role: 'admin' }),
}));

const sent = vi.mocked(gql);

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

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

describe('SentrySettings rows', () => {
  it('keeps the fields named after their rows, with the hint in the row', async () => {
    renderScreen();
    expect(await screen.findByRole('combobox', { name: 'Default team' })).toBeTruthy();
    const slug = screen.getByRole<HTMLInputElement>('textbox', { name: 'Organization slug' });
    expect(slug.value).toBe('acme');
    expect(screen.getByText('Optional. The slug from sentry.io/organizations/…')).toBeTruthy();
  });

  it('shows the webhook URL beside its secret', async () => {
    renderScreen();
    expect(await screen.findByText('https://polaris.example/sentry/hook')).toBeTruthy();
    expect(screen.getByLabelText('Webhook secret')).toBeTruthy();
  });

  it('opens the confirm dialog from the danger zone row', async () => {
    const user = renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Disconnect Sentry' }));
    expect(screen.getByRole('heading', { name: 'Disconnect Sentry?' })).toBeTruthy();
  });
});
