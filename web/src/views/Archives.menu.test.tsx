/**
 * The archives' row menu, whichever way it was opened.
 *
 * The ⋯ button and a right-click on the row render the same array, so the two cannot drift.
 * Restore is the only row, and it names what the tab holds — an archived cycle is restored
 * as a cycle, not as a generic "row" — because the same grid serves four different things.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Cycle, type Issue, type Team } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Archives } from './Archives';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
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
    cyclesEnabled: true,
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

function archived(number: number, title: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId: 's-done',
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    archivedAt: AT,
    createdAt: AT,
    updatedAt: AT,
  };
}

function archivedCycle(number: number, name: string): Cycle {
  return {
    id: `cycle-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    name,
    startsAt: AT,
    endsAt: AT,
    archivedAt: AT,
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entity = team();
  store.applyChanges([
    {
      v: 1,
      type: 'team',
      id: entity.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload: entity,
    } as Change,
  ]);
  return store;
}

function mount() {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG/archives']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey/archives" element={<Archives />} />
          </Routes>
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
  vi.mocked(gql).mockResolvedValue({ archivedIssues: [archived(9, 'Old importer')] });
});

afterEach(cleanup);

describe('Archives row menu', () => {
  it('opens on a right-click of the row, not only from the ⋯ button', async () => {
    const { user } = mount();
    const restore = await screen.findByRole('button', { name: 'Restore ENG-9' });

    await user.pointer({ target: restore.closest('tr') as HTMLElement, keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    expect(labels(menu)).toEqual(['Restore issue#']);
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

  it('unarchives the row the menu was opened on, with that row’s id', async () => {
    const { mutate, user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Options for ENG-9' }));

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    await user.click(within(menu).getByRole('menuitem', { name: /Restore issue/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: 'issue-9', archived: false });
    await screen.findByText('Issue restored.');
  });

  it('opens from the keyboard once a row is selected', async () => {
    const { user } = mount();
    await screen.findByRole('button', { name: 'Restore ENG-9' });

    // Nothing is selected until j moves the grid's selection, and the chord is guarded on it.
    await user.keyboard('j');
    await user.keyboard('.');

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-9' });
    expect(labels(menu)).toEqual(['Restore issue#']);
  });

  it('names what the tab actually holds', async () => {
    const { mutate, user } = mount();
    await screen.findByRole('button', { name: 'Restore ENG-9' });

    vi.mocked(gql).mockResolvedValue({ archivedCycles: [archivedCycle(3, 'Sprint 3')] });
    await user.click(screen.getByRole('button', { name: 'Cycles' }));
    await user.click(await screen.findByRole('button', { name: 'Options for Cycle 3' }));

    const menu = await screen.findByRole('menu', { name: 'Options for Cycle 3' });
    // "Restore issue" on the cycles tab would be the menu describing the wrong entity.
    expect(labels(menu)).toEqual(['Restore cycle#']);

    await user.click(within(menu).getByRole('menuitem', { name: /Restore cycle/ }));
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: 'cycle-3', archived: false });
  });
});
