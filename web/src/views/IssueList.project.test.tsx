/**
 * The project on a list row, which is how a team list is organised.
 *
 * The pill has been on the row since the display properties reached the list; it was off
 * by default, so a team's All issues view named every other fact about the work and not
 * the project it belonged to. Linear shows it without asking. These pin that default, and
 * that turning it off still hides it.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
    id: 'project-1',
    workspaceId: WORKSPACE,
    name: 'Onboarding',
    icon: '🚀',
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-1',
    priority: 0,
    sortOrder: 'V',
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, sortOrder: string, projectId?: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder,
    ...(projectId === undefined ? {} : { projectId }),
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Project | Issue][] = [
    ['team', team()],
    ['workflowState', state()],
    ['project', project()],
    ['issue', issue(1, 'Fix the flake', 'V', 'project-1')],
    ['issue', issue(2, 'Ship the importer', 'W')],
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

function renderList(search = '') {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={[`/team/ENG${search}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate };
}

function rowNamed(title: string): HTMLElement {
  const titleNode = screen.getByText(title);
  const row = titleNode.closest('[role="option"]');
  if (row === null) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

/** jsdom lays nothing out, so the virtualiser has to be told its viewport is not zero. */
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

describe('the project on a list row', () => {
  it('names the project on a row that has one, without asking Display', () => {
    renderList();

    expect(
      within(rowNamed('Fix the flake')).getByRole('button', { name: 'Onboarding' }),
    ).toBeTruthy();
    expect(within(rowNamed('Fix the flake')).getByText('🚀')).toBeTruthy();
  });

  it('leaves the pill off a row that is in no project, rather than drawing an empty one', () => {
    renderList();

    expect(
      within(rowNamed('Ship the importer')).queryByRole('button', { name: 'Onboarding' }),
    ).toBeNull();
  });

  it('drops the project when the display options leave it out', () => {
    renderList('?show=priority');

    expect(screen.queryByRole('button', { name: 'Onboarding' })).toBeNull();
    expect(screen.getByText('Fix the flake')).toBeTruthy();
  });
});
