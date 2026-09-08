/**
 * The milestone row, which until now was a value nobody could change.
 *
 * `projectMilestoneId` and `clearMilestone` have been on `UpdateIssueInput` from the start
 * and the rail drew the milestone as plain text, so an issue's checkpoint could be set by
 * the importer and by the agent tools and by no person using the product. What is asserted
 * here is the whole path: the row is a control where a control makes sense, the chord the
 * shortcut reference has always promised reaches it, and the two ways off a milestone are
 * spelled the way a partial update needs them to be.
 *
 * The last test is a regression for a bug this feature made reachable rather than one it
 * introduced. A milestone belongs to one project — `issue_milestone_matches_project` in
 * 000024_projects.up.sql raises otherwise — and `UpdateIssue` keeps the milestone it is not
 * given, so moving a milestoned issue to another project used to send `{projectId}` alone
 * and be refused with "a milestone has to belong to the issue's project". Nobody had hit it
 * because nothing in the client could put a milestone on an issue.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueDetail } from './IssueDetail';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const ISSUE = '01900000-0000-7000-8000-000000000004' as UUID;
const VIEWER = '01900000-0000-7000-8000-000000000005' as UUID;
const PROJECT = '01900000-0000-7000-8000-000000000006' as UUID;
const OTHER_PROJECT = '01900000-0000-7000-8000-000000000007' as UUID;
const ALPHA = '01900000-0000-7000-8000-000000000008' as UUID;
const BETA = '01900000-0000-7000-8000-000000000009' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, displayName: 'Ada', role: 'member' }),
  useViewerRole: () => 'member',
}));

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn(async () => ({ comments: [], issueHistory: [] })) };
});

afterEach(cleanup);

function project(id: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: '01900000-0000-7000-8000-0000000000aa',
    priority: 0,
    creatorId: VIEWER,
    sortOrder: name,
    updateSchedule: 'workspace',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function milestone(id: string, name: string, sortOrder: string, projectId = PROJECT): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    projectId,
    name,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function seeded(issueOver: Record<string, unknown>): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'UTC',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'a',
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'user',
      {
        id: VIEWER,
        workspaceId: WORKSPACE,
        displayName: 'Ada',
        email: 'ada@example.com',
        role: 'member',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    ['project', project(PROJECT, 'Importer')],
    ['project', project(OTHER_PROJECT, 'Exporter')],
    ['projectMilestone', milestone(ALPHA, 'Alpha', 'a')],
    ['projectMilestone', milestone(BETA, 'Beta', 'b')],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        title: 'Ship the importer',
        description: '',
        priority: 0,
        stateId: TODO,
        creatorId: VIEWER,
        dueDateSource: 'manual',
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
        ...issueOver,
      } as unknown as Entity,
    ],
  ];
  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function mount(issueOver: Record<string, unknown> = { projectId: PROJECT }) {
  const store = seeded(issueOver);
  const mutate = vi.fn(async (input: { optimistic?: OptimisticPatch }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/issue/ENG-7']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/issue/:identifier" element={<IssueDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate, store };
}

/** The last `updateIssue` input, which is what the server would actually receive. */
function lastInput(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mutate.mock.calls.at(-1)?.[0] as { variables: { input: Record<string, unknown> } };
  return call.variables.input;
}

describe('the milestone row', () => {
  it('is a control when the issue is in a project', () => {
    mount();

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    const trigger = within(rail).getByRole('button', { name: 'No milestone' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('is absent for an issue in no project, because there is nothing to choose from', () => {
    mount({});

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(rail).queryByRole('button', { name: 'No milestone' })).toBeNull();
  });

  it('sets the milestone by id', async () => {
    const { user, mutate, store } = mount();

    await user.click(screen.getByRole('button', { name: 'No milestone' }));
    await user.click(screen.getByRole('menuitem', { name: 'Beta' }));

    expect(lastInput(mutate)).toEqual({ id: ISSUE, projectMilestoneId: BETA });
    expect(store.get('issue', ISSUE)?.projectMilestoneId).toBe(BETA);
  });

  it('takes it off with the flag rather than with a null id', async () => {
    const { user, mutate, store } = mount({ projectId: PROJECT, projectMilestoneId: BETA });

    await user.click(screen.getByRole('button', { name: 'Beta' }));
    await user.click(screen.getByRole('menuitem', { name: 'No milestone' }));

    // A null in a partial update is indistinguishable from "leave it alone", which is the
    // whole reason `clearMilestone` exists.
    expect(lastInput(mutate)).toEqual({ id: ISSUE, clearMilestone: true });
    expect(store.get('issue', ISSUE)?.projectMilestoneId).toBeUndefined();
  });

  it('opens on Shift+M, the chord the shortcut reference has always named', async () => {
    const { user } = mount();

    await user.keyboard('{Shift>}M{/Shift}');

    expect(screen.getByRole('menu', { name: 'Milestone' })).toBeTruthy();
  });

  it('does nothing on Shift+M when the issue is in no project', async () => {
    const { user } = mount({});

    await user.keyboard('{Shift>}M{/Shift}');

    expect(screen.queryByRole('menu', { name: 'Milestone' })).toBeNull();
  });
});

describe('moving a milestoned issue to another project', () => {
  it('clears the milestone on the way, rather than being refused for it', async () => {
    const { user, mutate, store } = mount({ projectId: PROJECT, projectMilestoneId: BETA });

    await user.click(screen.getByRole('button', { name: 'Importer' }));
    await user.click(screen.getByRole('menuitem', { name: /^Exporter/ }));

    expect(lastInput(mutate)).toEqual({
      id: ISSUE,
      projectId: OTHER_PROJECT,
      clearMilestone: true,
    });
    // And locally too: leaving the old checkpoint on the row would draw a milestone of a
    // project the issue has left until the next delta.
    const moved = store.get('issue', ISSUE);
    expect(moved?.projectId).toBe(OTHER_PROJECT);
    expect(moved?.projectMilestoneId).toBeUndefined();
  });
});
