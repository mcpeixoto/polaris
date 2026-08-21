/**
 * "Create more" — `docs/01-features/02-issues.md`: the composer files the issue, stays open,
 * and keeps the properties for a rapid second one.
 *
 * The point of the feature is what it does *not* reset, so that is what this asserts:
 * `createIssue` is called with the status and priority that were set once, both times, while
 * the words are cleared between them and the dialog is never closed.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const filed = vi.mocked(createIssue);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const DOING = '01900000-0000-7000-8000-000000000004';

const AT = '2026-01-01T00:00:00.000Z';

function state(id: string, name: string, isDefault: boolean): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    category: isDefault ? 'unstarted' : 'started',
    position: 'V',
    isDefault,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

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
    ['workflowState', state(TODO, 'Todo', true)],
    ['workflowState', state(DOING, 'In Progress', false)],
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

function renderComposer() {
  const onClose = vi.fn();
  const store = seeded();
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateIssueModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onClose };
}

beforeEach(() => {
  filed.mockClear();
});

describe('CreateIssueModal', () => {
  it('files and stays open on "Create more", keeping every property but the words', async () => {
    const { user, onClose } = renderComposer();

    await user.selectOptions(screen.getByLabelText('Status'), DOING);
    await user.selectOptions(screen.getByLabelText('Priority'), '1');
    await user.type(screen.getByLabelText('Title'), 'First');
    await user.click(screen.getByRole('button', { name: 'Create more' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      title: 'First',
      stateId: DOING,
      priority: 1,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');

    // The second issue inherits the properties the first one was given.
    await user.type(screen.getByLabelText('Title'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Create more' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(2));
    expect(filed.mock.calls[1]?.[1]).toMatchObject({
      title: 'Second',
      stateId: DOING,
      priority: 1,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses an empty title without filing anything or closing', async () => {
    const { user, onClose } = renderComposer();

    await user.click(screen.getByRole('button', { name: 'Create more' }));

    expect(await screen.findByText('An issue needs a title.')).toBeTruthy();
    expect(filed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on an ordinary create, as it always did', async () => {
    const { user, onClose } = renderComposer();

    await user.type(screen.getByLabelText('Title'), 'Only one');
    await user.click(screen.getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(filed).toHaveBeenCalledTimes(1);
  });
});
