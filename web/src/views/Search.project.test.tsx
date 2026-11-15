import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Issue,
  type Project,
  type Team,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Search } from './Search';

/**
 * A result names the project its issue is in. Two issues with the same title in different
 * projects are otherwise the same row, and the project is usually what tells them apart.
 */

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn(() => new Promise(() => {})) };
});

const WORKSPACE = 'ws-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function team(): Team {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'MI',
    name: 'Miguel',
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

function state(): WorkflowState {
  return {
    id: 's-todo',
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'Todo',
    color: '#5e6ad2',
    category: 'unstarted',
    position: 'V',
    isDefault: true,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function project(): Project {
  return {
    id: 'p-escolas',
    workspaceId: WORKSPACE,
    name: 'Escolas de Oeiras',
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-1',
    priority: 0,
    sortOrder: 'a0',
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, projectId?: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `MI-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    ...(projectId === undefined ? {} : { projectId }),
    createdAt: AT,
    updatedAt: `2026-01-0${number}T00:00:00Z`,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, { id: string }][] = [
    ['team', team()],
    ['workflowState', state()],
    ['project', project()],
    ['issue', issue(1, 'Contactar escolas', 'p-escolas')],
    ['issue', issue(2, 'Lista de leads')],
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

function renderSearch(store: Store) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/search']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/search" element={<Search />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Search result project', () => {
  it('names the project an issue belongs to, and nothing on an issue without one', () => {
    renderSearch(seeded());

    const rows = screen.getAllByRole('option');
    const withProject = rows.find((row) => row.textContent?.includes('Contactar escolas'));
    const without = rows.find((row) => row.textContent?.includes('Lista de leads'));
    expect(withProject).toBeDefined();
    expect(without).toBeDefined();

    const pill = within(withProject!).getByRole('button', { name: 'Escolas de Oeiras' });
    expect(pill.textContent).toContain('Escolas de Oeiras');
    expect(without!.textContent).not.toContain('Escolas de Oeiras');
  });
});
