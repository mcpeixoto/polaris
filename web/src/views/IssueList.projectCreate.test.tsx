/**
 * Creating from a project's issue list keeps the issue in that project.
 *
 * The heading "+" used to open `/new` with only a status, so the composer filed into the
 * team with no project and closing `/new` dumped the filer on All issues. The URL is still
 * the seed grammar; it just carries the project the list is already scoped to.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
}));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const PROJECT = 'project-1';
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

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function project(): Project {
  return {
    id: PROJECT,
    workspaceId: WORKSPACE,
    name: 'Launch',
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-started',
    priority: 0,
    sortOrder: 'a',
    updateSchedule: 'never',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, stateId: string, sortOrder: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    projectId: PROJECT,
    number,
    identifier: `ENG-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId,
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Project | Issue][] = [
    ['team', team()],
    ['workflowState', state('s-backlog', 'Backlog', 'backlog')],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    [
      'projectStatus',
      {
        id: 'ps-started',
        workspaceId: WORKSPACE,
        name: 'In progress',
        color: '#5e6ad2',
        category: 'started',
        position: 'a',
        isDefault: false,
        createdAt: AT,
        updatedAt: AT,
      } as WorkflowState,
    ],
    ['project', project()],
    ['issue', issue(1, 'Ship the importer', 's-backlog', 'W')],
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

function Location() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

/** See `IssueList.test.tsx`: a virtualiser told its viewport is zero pixels tall draws nothing. */
const VIEWPORT = { offsetWidth: 900, offsetHeight: 600 };

beforeAll(() => {
  for (const [property, value] of Object.entries(VIEWPORT)) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => value,
    });
  }
});

afterAll(() => {
  for (const property of Object.keys(VIEWPORT)) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
  }
});

afterEach(cleanup);

describe('creating from a project issue list', () => {
  it('puts the project on the create URL so the composer files into it', async () => {
    const store = seeded();
    const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;

    render(
      <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Location />
            <Routes>
              <Route
                path="/project/:projectId"
                element={<IssueList source={{ kind: 'project', projectId: PROJECT }} />}
              />
              <Route path="*" element={null} />
            </Routes>
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Create issue in Backlog' }));

    const url = new URL(screen.getByTestId('location').textContent ?? '', 'http://polaris.test');
    expect(url.searchParams.get('project')).toBe(PROJECT);
    expect(url.searchParams.get('status')).toBe('Backlog');
  });
});
