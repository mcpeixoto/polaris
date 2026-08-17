import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Issue, type Team, type User } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Trash } from './Trash';

/**
 * The trash is the one screen whose listing is a network read, so the network is the thing
 * stubbed. `gql` is mocked rather than the feature's own wrapper, which keeps the document the
 * screen actually sends inside the test's reach — an empty trash and a trash nobody asked for
 * look identical from the outside otherwise.
 */
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const ADA = 'user-ada';
const AT = '2026-01-01T00:00:00Z';

function team(): Team {
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
    createdAt: AT,
    updatedAt: AT,
  };
}

function member(): User {
  return {
    id: ADA,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

/** A row as the server hands it back: an ordinary issue, minus the fact that it is deleted. */
function deleted(number: number, title: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId: 's-todo',
    creatorId: ADA,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

/**
 * The replica holds the team and the person, and never the deleted issue.
 *
 * That split is the whole shape of this screen: the ids come over the wire, the names they
 * resolve to come from the store, and no amount of local data can produce the listing itself.
 */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | User][] = [
    ['team', team()],
    ['user', member()],
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

function renderTrash() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/settings/trash']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Trash />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, user: userEvent.setup() };
}

/** The identifier and title of every row, in the order the table renders them. */
function rowTexts(): string[] {
  return screen.getAllByRole('rowheader').map((cell) => cell.textContent ?? '');
}

beforeEach(() => {
  vi.mocked(gql).mockReset();
});

describe('Trash', () => {
  it('lists what can still be restored, in the order the server sent it', async () => {
    vi.mocked(gql).mockResolvedValue({
      deletedIssues: [deleted(9, 'Ship the importer'), deleted(4, 'Fix the flake')],
    });
    renderTrash();

    expect(await screen.findByRole('button', { name: 'Restore ENG-9' })).toBeTruthy();
    // Not re-sorted here, and it must not be: the client has no deletedAt to sort by, so any
    // ordering this screen invented would be an ordering by something else entirely.
    expect(rowTexts()).toEqual(['ENG-9Ship the importer', 'ENG-4Fix the flake']);

    // The ids the server sent, resolved against the replica.
    expect(screen.getAllByText('Engineering')).toHaveLength(2);
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(2);
  });

  it('says how long the window is, because that is the question it answers', async () => {
    vi.mocked(gql).mockResolvedValue({ deletedIssues: [deleted(9, 'Ship the importer')] });
    renderTrash();
    await screen.findByRole('button', { name: 'Restore ENG-9' });

    expect(screen.getByText(/kept for 30 days/)).toBeTruthy();
  });

  it('restores an issue, takes the row away and says so', async () => {
    vi.mocked(gql).mockResolvedValue({
      deletedIssues: [deleted(9, 'Ship the importer'), deleted(4, 'Fix the flake')],
    });
    const { mutate, user } = renderTrash();

    await user.click(await screen.findByRole('button', { name: 'Restore ENG-9' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: 'issue-9' });
    // No optimistic patch, and there cannot be one: the replica threw the issue away when the
    // delete arrived, so there is no `before` to hold and nothing local to put back.
    expect(mutate.mock.calls[0]?.[0].optimistic).toBeUndefined();

    // The confirmation is a live region, because the proof of success is a row disappearing —
    // which is proof of nothing to somebody who was not watching that row.
    await screen.findByText('ENG-9 is back in Engineering.');
    expect(screen.queryByRole('button', { name: 'Restore ENG-9' })).toBeNull();
    expect(rowTexts()).toEqual(['ENG-4Fix the flake']);
  });

  it('reads an empty trash as good news rather than as an absence', async () => {
    vi.mocked(gql).mockResolvedValue({ deletedIssues: [] });
    renderTrash();

    expect(await screen.findByText('Nothing has been deleted')).toBeTruthy();
    expect(screen.getByText(/good kind of empty/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

/**
 * The failure path.
 *
 * Only this level can prove it exists at all. Every other screen in the client renders from the
 * replica and therefore cannot fail to load; this one asks the server, so "the trash is empty"
 * and "the request did not arrive" are two different answers that would otherwise look
 * identical — and the second one has to offer a way to ask again.
 */
describe('Trash when the listing cannot be loaded', () => {
  it('says what went wrong and asks again when told to', async () => {
    vi.mocked(gql)
      .mockRejectedValueOnce(new ApiError('NETWORK', 'network unavailable'))
      .mockResolvedValueOnce({ deletedIssues: [deleted(9, 'Ship the importer')] });
    const { user } = renderTrash();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('network unavailable');
    // Not an empty state pretending nothing was deleted, which is the one thing this screen
    // must never say when it does not know.
    expect(screen.queryByText('Nothing has been deleted')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Restore ENG-9' })).toBeTruthy();
    expect(vi.mocked(gql)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
