/**
 * The trash's row menu, whichever way it was opened.
 *
 * The ⋯ button and a right-click on the row render the same array, so the two cannot drift.
 * Restore is the only row in it, and that is deliberate rather than unfinished: a deleted
 * issue has no page to open and no link that resolves, and `purgeDeletedIssues` takes a
 * `before` instant and empties the trash — so a per-row "Delete permanently" would be a
 * button that takes the neighbouring rows with it.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { DeletedIssue } from '~/features/trash/mutations';
import { Store, type Change, type Team, type User } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Trash } from './Trash';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const ADA = 'user-ada';
const GRACE = 'user-grace';
const AT = '2026-01-01T00:00:00Z';
const DELETED_AT = '2026-02-01T00:00:00Z';

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
  };
}

function member(id: string, name: string, displayName: string): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    displayName,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function deleted(number: number, title: string): DeletedIssue {
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
    deletedAt: DELETED_AT,
    deletedBy: GRACE,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | User][] = [
    ['team', team()],
    ['user', member(ADA, 'ada', 'Ada Lovelace')],
    ['user', member(GRACE, 'grace', 'Grace Hopper')],
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

function mount() {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/settings/trash']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Trash />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** What a menu offers, in the order it offers it. */
function labels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

beforeEach(() => {
  vi.mocked(gql).mockReset();
  vi.mocked(gql).mockResolvedValue({ deletedIssues: [deleted(9, 'Ship the importer')] });
});

afterEach(cleanup);

describe('Trash row menu', () => {
  it('opens on a right-click of the row, not only from the ⋯ button', async () => {
    const { user } = mount();
    const restore = await screen.findByRole('button', { name: 'Restore ENG-9' });

    await user.pointer({ target: restore.closest('tr') as HTMLElement, keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    expect(labels(menu)).toEqual(['Restore issue']);
  });

  it('offers the same items in the same order whichever way it was opened', async () => {
    const kebab = mount();
    await kebab.user.click(await screen.findByRole('button', { name: 'Options for ENG-9' }));
    const fromKebab = labels(await screen.findByRole('menu', { name: 'Options for ENG-9' }));
    cleanup();

    const right = mount();
    const restore = await screen.findByRole('button', { name: 'Restore ENG-9' });
    await right.user.pointer({
      target: restore.closest('tr') as HTMLElement,
      keys: '[MouseRight]',
    });
    const fromRightClick = labels(await screen.findByRole('menu', { name: 'Options for ENG-9' }));

    expect(fromRightClick).toEqual(fromKebab);
    expect(fromKebab.length).toBeGreaterThan(0);
  });

  it('restores the row the menu was opened on, with that row’s id', async () => {
    const { mutate, user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Options for ENG-9' }));

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Restore issue' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: 'issue-9' });
    await screen.findByText('ENG-9 is back in Engineering.');
  });

  it('opens from the keyboard, which is the only way in on a Mac', async () => {
    const { user } = mount();
    await screen.findByRole('button', { name: 'Restore ENG-9' });

    // The cursor starts on the first row; `.` is the chord every other list uses.
    await user.keyboard('.');

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    expect(labels(menu)).toEqual(['Restore issue']);
  });

  it('offers no per-row purge, because the mutation behind one empties the whole trash', async () => {
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Options for ENG-9' }));

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    // `purgeDeletedIssues(before:)` has no per-row form, so a row offering to delete one
    // issue for good would be offering something no call can do.
    expect(labels(menu)).not.toContain('Delete permanently');
  });
});
