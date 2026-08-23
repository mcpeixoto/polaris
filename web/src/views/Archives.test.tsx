import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Issue, type Team } from '~/store';
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

function renderArchives() {
  const store = seeded();
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
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
}

describe('Archives', () => {
  beforeEach(() => {
    vi.mocked(gql).mockReset();
  });

  it('has a heading, so a screen reader can find the page', async () => {
    vi.mocked(gql).mockResolvedValue({ archivedIssues: [] });
    renderArchives();
    expect(await screen.findByRole('heading', { name: 'Archives' })).toBeTruthy();
  });

  it('lists archived issues from the server, not the replica', async () => {
    vi.mocked(gql).mockResolvedValue({
      archivedIssues: [archived(9, 'Old importer')],
    });
    renderArchives();
    expect(await screen.findByText('ENG-9')).toBeTruthy();
    expect(screen.getByText('Old importer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore ENG-9' })).toBeTruthy();
  });

  it('teaches that an empty archive is empty, not still loading', async () => {
    vi.mocked(gql).mockResolvedValue({ archivedIssues: [] });
    renderArchives();
    expect(await screen.findByText('No archived issues')).toBeTruthy();
  });

  it('takes the restore confirmation away when the tab changes', async () => {
    // The confirmation is a live region. Left standing across a tab change it is announced
    // again, on a screen that no longer holds the row it is about to name.
    vi.mocked(gql).mockImplementation((query: string) =>
      Promise.resolve(
        query.includes('ArchivedIssues')
          ? { archivedIssues: [archived(9, 'Old importer')] }
          : { archivedCycles: [] },
      ),
    );
    const user = userEvent.setup();
    renderArchives();

    await user.click(await screen.findByRole('button', { name: 'Restore ENG-9' }));
    expect(await screen.findByText('Issue restored.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cycles' }));
    expect(await screen.findByText('No archived cycles')).toBeTruthy();
    expect(screen.queryByText('Issue restored.')).toBeNull();
  });
});
