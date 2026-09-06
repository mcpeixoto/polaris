/**
 * Slack settings as rows, seen by an admin with a connection and a saved webhook: the row
 * draws the label, the control keeps the name, the saved webhook is a row with its one
 * action, and the danger zone's own button opens the confirm dialog.
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

import { SlackSettings } from './SlackSettings';

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
    upsert(2, 'slackConnection', {
      id: 's1',
      workspaceId: WORKSPACE,
      creatorId: VIEWER,
      enabled: true,
      defaultTeamId: 't1',
      channelName: 'eng',
      notifyIssues: true,
      notifyComments: false,
      asksEnabled: false,
      connectedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

const INBOUND = {
  slackInbound: {
    commandUrl: 'https://polaris.example/slack/command',
    eventsUrl: 'https://polaris.example/slack/events',
    webhookConfigured: true,
    signingSecretConfigured: true,
    botTokenConfigured: false,
  },
};

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(
    async (query: string) => (query.includes('query SlackInbound') ? INBOUND : {}) as never,
  );
});

function renderScreen() {
  const engine = { store: seed() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/slack']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SlackSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('SlackSettings rows', () => {
  it('keeps the fields and toggles named after their rows', async () => {
    renderScreen();
    expect(await screen.findByRole('combobox', { name: 'Default team' })).toBeTruthy();
    const channel = screen.getByRole<HTMLInputElement>('textbox', { name: 'Channel name' });
    expect(channel.value).toBe('eng');
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Notify on issue create and update' })
        .checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Notify on comments' }).checked,
    ).toBe(false);
  });

  it('shows a saved webhook as a row with Replace as its only action', async () => {
    const user = renderScreen();
    expect(
      await screen.findByText('Incoming webhook saved. Channel notifications post to it.'),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Incoming webhook URL' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Replace webhook' }));
    expect(screen.getByRole('textbox', { name: 'Incoming webhook URL' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Keep the saved webhook' }));
    expect(screen.queryByRole('textbox', { name: 'Incoming webhook URL' })).toBeNull();
  });

  it('shows the Slack app URLs as labelled rows', async () => {
    renderScreen();
    expect(await screen.findByText('https://polaris.example/slack/command')).toBeTruthy();
    expect(screen.getByText('Command URL')).toBeTruthy();
    expect(screen.getByText('https://polaris.example/slack/events')).toBeTruthy();
    expect(screen.getByText('Events URL')).toBeTruthy();
  });

  it('opens the confirm dialog from the danger zone row', async () => {
    const user = renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Disconnect Slack' }));
    expect(screen.getByRole('heading', { name: 'Disconnect Slack?' })).toBeTruthy();
  });
});
