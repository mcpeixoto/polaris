/**
 * The projects table: what each column says, and the two things it refuses to fake.
 *
 * The health cell carries the age of the update it is quoting, because "At risk" from this
 * morning and "At risk" from two months ago are different facts. The status cell is a ring
 * named with the ratio it draws. And the sparkline column exists only when some row has a
 * line to draw — a column of empty cells is a promise the data is not keeping.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Projects } from './Projects';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';
const WEEK = 7 * 24 * 60 * 60 * 1000;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', {
      id: 'ps-started',
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'project', {
      id: 'p1',
      workspaceId: WORKSPACE,
      name: 'Launch',
      icon: '🚀',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps-started',
      priority: 0,
      sortOrder: 'a',
      targetDate: '2026-08-15',
      targetDateGranularity: 'quarter',
      updateSchedule: 'never',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(3, 'projectUpdate', {
      id: 'pu1',
      workspaceId: WORKSPACE,
      projectId: 'p1',
      health: 'at_risk',
      body: 'Slipping',
      authorId: 'u1',
      createdAt: new Date(Date.now() - 3 * WEEK).toISOString(),
      updatedAt: AT,
    } as Entity),
    upsert(4, 'projectMilestone', {
      id: 'm1',
      workspaceId: WORKSPACE,
      projectId: 'p1',
      name: 'Beta',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    ...['is1', 'is2'].map((id, index) =>
      upsert(5 + index, 'issue', {
        id,
        workspaceId: WORKSPACE,
        teamId: 't1',
        number: index,
        identifier: `ENG-${index}`,
        title: id,
        description: '',
        stateId: 's1',
        priority: 3,
        sortOrder: id,
        dueDateSource: 'manual',
        projectId: 'p1',
        createdAt: AT,
        updatedAt: AT,
        ...(index === 0 ? { completedAt: '2026-01-05T00:00:00.000Z' } : null),
      } as Entity),
    ),
  ]);
  return store;
}

function renderList(store: Store, url = '/projects') {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[url]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Projects />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Projects table', () => {
  it('names each column once, above the rows', () => {
    renderList(seeded());
    for (const label of ['Name', 'Health', 'Priority', 'Lead', 'Target date', 'Issues', 'Status']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('puts the emoji, the current milestone and the target quarter on the row', () => {
    renderList(seeded());
    const row = screen.getByRole('link', { name: /Launch/ });
    expect(row.textContent).toContain('🚀');
    expect(within(row).getByText('Beta')).toBeTruthy();
    expect(within(row).getByText('Q3 2026')).toBeTruthy();
  });

  it('quotes the health with the age of the update it came from', () => {
    renderList(seeded());
    const row = screen.getByRole('link', { name: /Launch/ });
    expect(within(row).getByText('At risk')).toBeTruthy();
    expect(within(row).getByText('· 3w')).toBeTruthy();
  });

  it('draws status as a ring named with the ratio it shows', () => {
    renderList(seeded());
    expect(screen.getByRole('img', { name: 'In progress: 1 of 2 issues completed' })).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('offers a ghost "New project" in the header and status pills in the toolbar', async () => {
    const user = userEvent.setup();
    renderList(seeded());
    expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();

    const pills = screen.getByRole('group', { name: 'Status' });
    expect(within(pills).getByRole('button', { name: 'All projects', pressed: true })).toBeTruthy();
    await user.click(within(pills).getByRole('button', { name: 'Completed' }));
    expect(within(pills).getByRole('button', { name: 'Completed', pressed: true })).toBeTruthy();
    expect(screen.getByText('Nothing matches these filters')).toBeTruthy();
  });
});
