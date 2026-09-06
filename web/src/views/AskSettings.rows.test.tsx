/**
 * Asks settings as rows: with Slack connected the toggle is a row that keeps its name, and
 * the create-form fields carry the names their rows draw.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AskSettings } from './AskSettings';

const WORKSPACE = 'w1';
const AT = '2026-08-20T12:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewer: () => ({
    id: 'u1',
    workspaceId: WORKSPACE,
    name: 'Ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

function renderAsks() {
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
      creatorId: 'u1',
      enabled: true,
      defaultTeamId: 't1',
      channelName: 'eng',
      notifyIssues: true,
      notifyComments: true,
      asksEnabled: true,
      connectedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/asks']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AskSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('AskSettings rows', () => {
  it('draws the Slack toggle as a named row once Slack is connected', () => {
    renderAsks();
    const toggle = screen.getByRole<HTMLInputElement>('checkbox', {
      name: 'Create Asks from Slack',
    });
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(/People without a Polaris account can file an Ask/)).toBeTruthy();
  });

  it('keeps the create-form fields named after their rows', () => {
    renderAsks();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Team' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create form' })).toBeTruthy();
  });

  it('says the list is empty inside the same card as the form', () => {
    renderAsks();
    const empty = screen.getByText('No intake forms');
    const card = screen.getByRole('button', { name: 'Create form' }).closest('section');
    expect(card).not.toBeNull();
    expect(card?.contains(empty)).toBe(true);
  });
});
