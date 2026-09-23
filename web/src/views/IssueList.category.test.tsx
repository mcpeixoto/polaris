/**
 * Category tabs on an issue list.
 *
 * They are a second control beside Active / Backlog / All. Those pills write the filter.
 * These write `tab`, and the view ANDs the two, so pressing one must not clear the other.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
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

function issue(number: number, title: string, stateId: string, sortOrder: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
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

function renderList() {
  const store = new Store(WORKSPACE);
  const entities: { type: Change['type']; entity: Team | WorkflowState | Issue }[] = [
    { type: 'team', entity: team() },
    { type: 'workflowState', entity: state('s-backlog', 'Backlog', 'backlog') },
    { type: 'workflowState', entity: state('s-todo', 'Todo', 'unstarted') },
    { type: 'issue', entity: issue(1, 'Fix the flake', 's-todo', 'V') },
    { type: 'issue', entity: issue(2, 'Ship the importer', 's-backlog', 'W') },
  ];
  store.applyChanges(
    entities.map(({ type, entity }, index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  const engine = { store, mutate: vi.fn().mockResolvedValue({}) } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Location />
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

function Location() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

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

describe('issue category tabs', () => {
  it('narrows by category without touching the scope filter', async () => {
    const user = renderList();
    const tabs = screen.getByRole('group', { name: 'Status category' });

    await user.click(within(tabs).getByRole('button', { name: 'Backlog' }));

    expect(screen.getByTestId('location').textContent).toContain('tab=backlog');
    expect(screen.getByTestId('location').textContent).not.toContain('filter=');
    expect(
      within(screen.getByRole('group', { name: 'Which issues' }))
        .getByRole('button', { name: 'All issues' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([
      'ENG-2Ship the importer',
    ]);
  });
});
