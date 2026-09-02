/**
 * The team index, and the create dialog it hosts.
 *
 * `CREATE_TEAM` was defined, code-generated, and called by nothing anywhere in `web/src`.
 * The client could retire a team, delete one and restore one, so a workspace's team list was
 * whatever the first-run flow produced, for ever. These tests are what stops that regressing
 * to a page nobody can create a team from.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type Team } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { TeamsSettings } from './TeamsSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const AT = '2026-01-01T00:00:00.000Z';

function team(id: string, key: string, name: string, over: Partial<Team> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
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
    ...over,
  } as unknown as Entity;
}

let mutate: ReturnType<typeof vi.fn>;

function renderScreen(teams: readonly Entity[], at = '/settings/teams') {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    teams.map((payload, index): Change => ({
      v: index + 1,
      type: 'team',
      id: (payload as { id: string }).id,
      op: 'upsert',
      actor: { type: 'system' },
      payload,
    })),
  );

  mutate = vi.fn().mockResolvedValue({
    createTeam: { team: { id: 'team-new', key: 'PLAT', name: 'Platform' } },
  });
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={[at]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <TeamsSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeamsSettings', () => {
  it('lists every live team by key', async () => {
    renderScreen([team('t-eng', 'ENG', 'Engineering'), team('t-des', 'DES', 'Design')]);

    expect(await screen.findByRole('heading', { level: 1, name: 'Teams' })).toBeTruthy();
    expect(screen.getByText('ENG')).toBeTruthy();
    expect(screen.getByText('DES')).toBeTruthy();
  });

  // Retired is listed rather than hidden: an index that omits a row cannot explain why the
  // key it held is still taken.
  it('keeps a retired team on the list and says that it is retired', async () => {
    renderScreen([team('t-old', 'OLD', 'Old team', { retiredAt: AT })]);
    expect(await screen.findByText('Retired')).toBeTruthy();
  });

  it('offers a way to create one when there are none', async () => {
    renderScreen([]);
    expect(await screen.findByText('No teams yet')).toBeTruthy();
  });

  // `/settings/teams/new` is an address rather than component state, because the
  // empty-workspace screen navigates straight to it.
  it('opens the create dialog straight from its own address', async () => {
    renderScreen([], '/settings/teams/new');
    expect(await screen.findByRole('dialog', { name: 'New team' })).toBeTruthy();
  });

  it('suggests a key from the name and creates the team with it', async () => {
    const user = renderScreen([], '/settings/teams/new');

    await user.type(await screen.findByLabelText('Name'), 'Design Systems');
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('DS');

    await user.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutate.mock.calls[0]?.[0]?.variables?.input).toMatchObject({
      key: 'DS',
      name: 'Design Systems',
    });
  });

  // The suggestion is a suggestion: once the field is typed into it stops tracking the name.
  it('stops suggesting once the key has been edited', async () => {
    const user = renderScreen([], '/settings/teams/new');

    await user.type(await screen.findByLabelText('Name'), 'Design');
    const key = screen.getByLabelText('Key');
    await user.clear(key);
    await user.type(key, 'DSX');
    await user.type(screen.getByLabelText('Name'), ' Systems');

    expect((key as HTMLInputElement).value).toBe('DSX');
  });

  it('refuses a key another team already holds, on the field', async () => {
    const user = renderScreen([team('t-eng', 'ENG', 'Engineering')], '/settings/teams/new');

    await user.type(await screen.findByLabelText('Name'), 'Engineering Two');
    const key = screen.getByLabelText('Key');
    await user.clear(key);
    await user.type(key, 'ENG');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/ENG already belongs to another team/u)).toBeTruthy();
  });

  // The case that used to post an empty key: no word in the name starts with a letter, so
  // there is no suggestion, and the submit ladder has to say so rather than send it.
  it('refuses a name that suggests no key rather than posting an empty one', async () => {
    const user = renderScreen([], '/settings/teams/new');

    await user.type(await screen.findByLabelText('Name'), '123');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/A team needs a key/u)).toBeTruthy();
  });
});
