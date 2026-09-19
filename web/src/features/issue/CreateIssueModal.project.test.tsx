/**
 * Filing from a project page puts the issue in that project.
 *
 * The composer is mounted by the shell, above the route, so the project has to be read
 * from the path rather than passed in. A sitting that ignored the path filed into the
 * team with no project — the issue existed, just not where the filer was standing.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateIssueModal } from './CreateIssueModal';
import { createIssue } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createIssue: vi.fn(() => Promise.resolve('issue-1')) };
});

vi.mock('~/features/drafts/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/drafts/local')>();
  return {
    ...actual,
    readIssueComposerDraft: vi.fn(() => null),
    writeIssueComposerDraft: vi.fn(),
  };
});

const filed = vi.mocked(createIssue);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const PROJECT = '01900000-0000-7000-8000-00000000000a';
const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
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
      } as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'V',
        isDefault: true,
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'project',
      {
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
      } as Entity,
    ],
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
      } as Entity,
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

afterEach(cleanup);

beforeEach(() => {
  filed.mockClear();
});

describe('CreateIssueModal on a project page', () => {
  it('files the issue into the project the path already names', async () => {
    const store = seeded();
    const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
    render(
      <MemoryRouter initialEntries={[`/project/${PROJECT}`]}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <CreateIssueModal onClose={() => undefined} />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();

    await user.type(screen.getByLabelText('Title'), 'Ship the importer');
    await user.click(screen.getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(filed).toHaveBeenCalled());
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      title: 'Ship the importer',
      projectId: PROJECT,
    });
  });
});
