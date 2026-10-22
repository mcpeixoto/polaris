/**
 * The two things team settings archives — a workflow status and a recurring schedule — and
 * the offer that takes each back.
 *
 * Both rows leave the screen the moment the write lands, which is what the assertions are
 * really about: the label has to have been read before the row went, and the closure has to
 * still name the right id afterwards.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { snapshot } from '~/features/undo/offers';
import { clearUndoOffers } from '~/features/undo/UndoToast';
import { latest } from '~/features/undo/undo';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { TeamSettings } from './TeamSettings';

vi.mock('~/features/admin/entitlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/admin/entitlements')>();
  return {
    ...actual,
    useEntitlements: () => ({
      facts: { plan: 'free', seatLimit: null, seatsUsed: 1, teamLimit: null, lapsed: false },
      features: null,
      confirmed: false,
      reload: () => {},
    }),
  };
});

const WORKSPACE = 'workspace-1';
const TEAM = 'team-eng';
const STATUS = 'state-todo';
const SCHEDULE = 'recurring-1';
const AT = '2026-01-01T00:00:00Z';

const team: Entity = {
  id: TEAM,
  workspaceId: WORKSPACE,
  key: 'ENG',
  name: 'Engineering',
  timezone: 'Europe/Lisbon',
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
} as unknown as Entity;

const status: Entity = {
  id: STATUS,
  workspaceId: WORKSPACE,
  teamId: TEAM,
  name: 'Todo',
  color: '#5e6ad2',
  category: 'unstarted',
  position: 'V',
  isDefault: false,
  isSystem: false,
  createdAt: AT,
  updatedAt: AT,
} as unknown as Entity;

const schedule: Entity = {
  id: SCHEDULE,
  workspaceId: WORKSPACE,
  teamId: TEAM,
  title: 'Weekly review',
  body: '',
  properties: {},
  cadence: 'weekly',
  nextDueDate: '2026-01-08',
  createdAt: AT,
  updatedAt: AT,
} as unknown as Entity;

function renderScreen() {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    (
      [
        ['team', team],
        ['workflowState', status],
        ['recurringIssue', schedule],
      ] as const
    ).map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );

  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG/settings']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey/settings" element={<TeamSettings />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** The last mutation the engine was handed, as the variables it carried. */
function lastVariables(mutate: ReturnType<typeof vi.fn>) {
  const calls = mutate.mock.calls;
  return (calls[calls.length - 1]![0] as { variables: Record<string, unknown> }).variables;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => clearUndoOffers());

describe('retiring a workflow status', () => {
  it('offers an undo that names the status', async () => {
    const { user } = renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Retire Todo' }));

    expect(latest(snapshot())?.label).toBe('Archived Todo');
  });

  it('un-archives that status when the undo is run', async () => {
    const { mutate, user } = renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Retire Todo' }));

    mutate.mockClear();
    await latest(snapshot())!.undo();

    expect(lastVariables(mutate)).toMatchObject({ id: STATUS, archived: false });
  });
});

describe('archiving a recurring schedule', () => {
  it('offers an undo that names the schedule', async () => {
    const { user } = renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Archive Weekly review' }));

    expect(latest(snapshot())?.label).toBe('Archived Weekly review');
  });

  it('un-archives that schedule when the undo is run', async () => {
    const { mutate, user } = renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Archive Weekly review' }));

    mutate.mockClear();
    await latest(snapshot())!.undo();

    expect(lastVariables(mutate)).toMatchObject({ id: SCHEDULE, archived: false });
  });
});
