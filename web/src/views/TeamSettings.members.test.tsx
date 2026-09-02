/**
 * Team membership, which nothing in the client could edit.
 *
 * `addTeamMember` and `removeTeamMember` have existed server-side since the first release
 * and no call site anywhere in `web/src` reached either of them — a grep for
 * `teamMembership` across `web/src/features` returned reads only. Membership is what gates a
 * private team's issues, what cycle capacity is measured against, which of the two default
 * templates a new issue gets and who sees triage: all of it configured against a set nobody
 * could change.
 *
 * These tests cover the section that fixes that, and nothing else on this 1700-line screen.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { TeamSettings } from './TeamSettings';

/*
 * The plan, which this screen asks about for the private-team gate and nothing this file
 * tests. `features: null` is the shape the real hook holds while the answer is in flight, and
 * `featureBlock` reads it as "unknown is not denied" — so the gate stays out of the way.
 */
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
const AT = '2026-01-01T00:00:00Z';

function team(): Entity {
  return {
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
}

function person(id: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name: name.toLowerCase(),
    displayName: name,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function membership(id: string, userId: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    userId,
    role: 'member',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

let mutate: ReturnType<typeof vi.fn>;

function renderScreen(rows: readonly [string, Entity][]) {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    [['team', team()] as [string, Entity], ...rows].map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );

  mutate = vi.fn().mockResolvedValue({});
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
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** The section, found by its heading rather than by a class name. */
function roster(): HTMLElement {
  return screen.getByRole('region', { name: 'Members' });
}

describe('team membership', () => {
  it('says nobody is on the team rather than rendering an empty list', async () => {
    renderScreen([['user', person('user-ada', 'Ada Lovelace')]]);
    expect(await screen.findByText('Nobody is on this team')).toBeTruthy();
  });

  it('adds somebody chosen from the workspace', async () => {
    const user = renderScreen([['user', person('user-ada', 'Ada Lovelace')]]);

    await user.selectOptions(await screen.findByLabelText('Add somebody'), 'user-ada');
    await user.click(screen.getByRole('button', { name: 'Add to team' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutate.mock.calls[0]?.[0]?.variables).toMatchObject({
      teamId: TEAM,
      userId: 'user-ada',
      role: 'MEMBER',
    });
  });

  // Somebody already on the team is not offered again: sending it twice is answered with the
  // same membership.
  it('does not offer somebody who is already on the team', async () => {
    renderScreen([
      ['user', person('user-ada', 'Ada Lovelace')],
      ['teamMembership', membership('m1', 'user-ada')],
    ]);

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Everybody in this workspace is already on this team.')).toBeTruthy();
  });

  it('names the person each Remove acts on, and asks before removing them', async () => {
    const user = renderScreen([
      ['user', person('user-ada', 'Ada Lovelace')],
      ['teamMembership', membership('m1', 'user-ada')],
    ]);

    const remove = await within(roster()).findByRole('button', {
      name: 'Remove Ada Lovelace from Engineering',
    });
    await user.click(remove);
    expect(mutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: 'Remove Ada Lovelace' }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
  });

  // The refusal that matters is "a team keeps at least one owner", and it belongs inside the
  // dialog that asked rather than in a page banner the open modal covers.
  it('holds the dialog open and shows why a removal was refused', async () => {
    const user = renderScreen([
      ['user', person('user-ada', 'Ada Lovelace')],
      ['teamMembership', membership('m1', 'user-ada')],
    ]);
    mutate.mockRejectedValueOnce(new Error('a team keeps at least one owner'));

    await user.click(
      await within(roster()).findByRole('button', {
        name: 'Remove Ada Lovelace from Engineering',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove Ada Lovelace' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent).toContain('could not be removed');
    });
  });
});
