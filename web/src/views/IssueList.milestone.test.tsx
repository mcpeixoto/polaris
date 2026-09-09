/**
 * `Milestone…` in the row menu, and the one thing it must refuse to offer.
 *
 * The item has existed in `issueRowMenuItems` since that builder was written, gated on a
 * `milestone` flag no caller ever passed — and `IssueList` explicitly bailed out of the
 * hand-off with `if (kind === 'milestone') return;`. So a picker that exists
 * (`features/project-milestones/MilestonePicker`) and a menu row that exists were never
 * introduced to each other.
 *
 * The gate is the interesting part. A milestone belongs to a project, so the row is only
 * correct when every targeted issue is in the *same* project. Two projects have two sets of
 * milestones and no right list to draw; an issue in no project has none at all. Both would
 * open an empty menu, which reads as a broken feature rather than an inapplicable one.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Issue,
  type Project,
  type ProjectMilestone,
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
const TEAM = 'team-eng';
const AT = '2026-01-01T00:00:00.000Z';

function change(v: number, type: string, payload: { id: string }): Change {
  return { v, type, id: payload.id, op: 'upsert', actor: { type: 'system' }, payload } as Change;
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
  } as Issue;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    change(1, 'team', {
      id: TEAM,
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      timezone: 'UTC',
      // Present because opening any picker computes the shared properties for all of them,
      // and the estimate picker reads the scale off the team.
      estimateScale: 'none',
      estimateAllowZero: false,
      estimateExtended: false,
    } as unknown as Team),
    change(2, 'workflowState', {
      id: 's-todo',
      workspaceId: WORKSPACE,
      teamId: TEAM,
      name: 'Todo',
      category: 'unstarted',
      position: 'a',
    } as unknown as WorkflowState),
    change(3, 'project', {
      id: 'p-apollo',
      workspaceId: WORKSPACE,
      name: 'Apollo',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Project),
    change(4, 'project', {
      id: 'p-gemini',
      workspaceId: WORKSPACE,
      name: 'Gemini',
      sortOrder: 'b',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Project),
    change(5, 'projectMilestone', {
      id: 'm-beta',
      workspaceId: WORKSPACE,
      projectId: 'p-apollo',
      name: 'Beta',
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as ProjectMilestone),
    change(6, 'issue', issue(1, 'In Apollo', 'V', 'p-apollo')),
    change(7, 'issue', issue(2, 'Also Apollo', 'W', 'p-apollo')),
    change(8, 'issue', issue(3, 'In Gemini', 'X', 'p-gemini')),
    change(9, 'issue', issue(4, 'In no project', 'Y')),
  ]);
  return store;
}

function renderList() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/team/ENG']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
            <Route path="*" element={null} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

async function openMenuOn(title: string): Promise<HTMLElement> {
  fireEvent.contextMenu(screen.getByRole('option', { name: new RegExp(title) }), {
    button: 2,
    buttons: 2,
    clientX: 120,
    clientY: 240,
  });
  return screen.findByRole('menu', { name: /actions/i });
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

describe('the milestone row', () => {
  it('is offered on an issue that is in a project', async () => {
    const { user } = renderList();

    const menu = await openMenuOn('In Apollo');
    expect(within(menu).getByRole('menuitem', { name: /^Milestone…/ })).toBeTruthy();
    await user.keyboard('{Escape}');
  });

  it('is absent on an issue that is in no project, rather than opening an empty picker', async () => {
    const { user } = renderList();

    const menu = await openMenuOn('In no project');
    expect(within(menu).queryByRole('menuitem', { name: /^Milestone…/ })).toBeNull();
    await user.keyboard('{Escape}');
  });

  it('opens the project’s milestones and writes the one chosen', async () => {
    const { user, mutate } = renderList();

    const menu = await openMenuOn('In Apollo');
    await user.click(within(menu).getByRole('menuitem', { name: /^Milestone…/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Beta' }));

    expect(mutate).toHaveBeenCalled();
    const variables = mutate.mock.calls[0]?.[0].variables as { input: Record<string, unknown> };
    expect(variables.input).toMatchObject({ id: 'issue-1', projectMilestoneId: 'm-beta' });
  });
});
