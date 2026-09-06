/**
 * The inbox's second pane.
 *
 * Three things about it are decisions: it is empty until the cursor is placed, because a
 * cursor nobody moved is not a selection; it follows `J` and `K`, because that is how the
 * keyboard reads an inbox; and it says how much is unread while it is empty, because that
 * is the one number the screen is opened for.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Entity,
  type Issue,
  type Notification,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Inbox } from './Inbox';

vi.mock('~/features/inbox/mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/inbox/mutations')>();
  return { ...actual, hydrateInbox: vi.fn().mockResolvedValue(undefined) };
});

const WORKSPACE = 'w1';
const AT = '2026-08-16T11:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

const viewer: User = {
  id: 'u1',
  workspaceId: WORKSPACE,
  name: 'ada',
  displayName: 'Ada',
  timezone: 'UTC',
  role: 'member',
  status: 'active',
  kind: 'human',
  createdAt: AT,
  updatedAt: AT,
};

const team: Team = {
  id: 't1',
  workspaceId: WORKSPACE,
  key: 'ENG',
  name: 'Engineering',
  timezone: 'UTC',
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

const started: WorkflowState = {
  id: 's1',
  workspaceId: WORKSPACE,
  teamId: 't1',
  name: 'In Progress',
  color: '#3366ff',
  category: 'started',
  position: 'V',
  isDefault: false,
  isSystem: false,
  createdAt: AT,
  updatedAt: AT,
};

function issue(id: string, number: number, title: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: 't1',
    number,
    identifier: `ENG-${number}`,
    title,
    dueDateSource: 'manual',
    description: 'A paragraph about it.',
    stateId: 's1',
    priority: 2,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function notification(id: string, issueId: string, over: Partial<Notification> = {}): Notification {
  return {
    id,
    workspaceId: WORKSPACE,
    userId: 'u1',
    type: 'issue_assigned',
    issueId,
    actor: { type: 'user', id: 'u1' },
    changeVersion: 1,
    groupKey: `g:${id}`,
    count: 1,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function renderInbox(rows: Notification[]) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', viewer),
    upsert(2, 'team', team),
    upsert(3, 'workflowState', started),
    upsert(4, 'issue', issue('i1', 4, 'Fix the flake')),
    upsert(5, 'issue', issue('i2', 5, 'Ship the thing')),
    ...rows.map((row, index) => upsert(6 + index, 'notification', row)),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Inbox />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('the inbox pane', () => {
  it('says how much is unread until the cursor is placed', () => {
    renderInbox([
      notification('n1', 'i1'),
      notification('n2', 'i2', { type: 'comment', createdAt: '2026-08-16T10:00:00.000Z' }),
      notification('n3', 'i2', {
        type: 'mention',
        readAt: AT,
        createdAt: '2026-08-16T09:00:00.000Z',
      }),
    ]);

    expect(screen.getByText('2 unread notifications')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('follows the cursor down the list', async () => {
    const { user } = renderInbox([
      notification('n1', 'i1'),
      notification('n2', 'i2', { type: 'comment', createdAt: '2026-08-16T10:00:00.000Z' }),
    ]);

    await user.keyboard('j');
    const pane = await screen.findByRole('article', { name: 'ENG-5' });
    expect(within(pane).getByRole('heading', { level: 2, name: 'Ship the thing' })).toBeTruthy();
    expect(within(pane).getByText('In Progress')).toBeTruthy();
    expect(screen.queryByText(/unread notifications/)).toBeNull();

    await user.keyboard('k');
    expect(await screen.findByRole('article', { name: 'ENG-4' })).toBeTruthy();
  });

  it('draws the row as identifier and title, with what happened beneath', () => {
    renderInbox([notification('n1', 'i1')]);
    const row = screen.getByRole('option', { name: /assigned ENG-4 to you/ });
    expect(within(row).getByText('ENG-4')).toBeTruthy();
    expect(within(row).getByText('Fix the flake')).toBeTruthy();
    // An age, not a sentence: the tooltip carries the full instant.
    const when = within(row).getByText(/^\d+(m|h|d|w|mo|y)$|^now$/);
    expect(when.tagName).toBe('TIME');
  });

  it('offers mark-all-read as an icon button, and dismiss-all-read behind the dots', async () => {
    const { user, mutate } = renderInbox([
      notification('n1', 'i1'),
      notification('n2', 'i2', { type: 'comment', readAt: AT }),
    ]);

    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('menu', { name: 'Inbox' });
    await user.click(within(menu).getByText('Dismiss all read'));
    expect(mutate).toHaveBeenCalled();

    const before = mutate.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(mutate.mock.calls.length).toBe(before + 1);
  });
});
