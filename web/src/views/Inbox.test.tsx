import { render, screen } from '@testing-library/react';
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
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'system' },
    payload: entity,
  };
}

function viewer(): User {
  return {
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
}

function team(): Team {
  return {
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
}

function issue(): Issue {
  return {
    id: 'i1',
    workspaceId: WORKSPACE,
    teamId: 't1',
    number: 4,
    identifier: 'ENG-4',
    title: 'Fix the flake',
    dueDateSource: 'manual',
    description: '',
    stateId: 's1',
    priority: 2,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function notification(id: string, over: Partial<Notification> = {}): Notification {
  return {
    id,
    workspaceId: WORKSPACE,
    userId: 'u1',
    type: 'issue_assigned',
    issueId: 'i1',
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
    upsert(1, 'user', viewer()),
    upsert(2, 'team', team()),
    upsert(3, 'issue', issue()),
    ...rows.map((row, index) => upsert(4 + index, 'notification', row)),
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

describe('Inbox leftovers', () => {
  it('hides a read row when Show read is off', async () => {
    const { user } = renderInbox([
      notification('n-unread'),
      notification('n-read', { readAt: AT, type: 'comment' }),
    ]);

    expect(screen.getByText(/assigned ENG-4 to you/)).toBeTruthy();
    expect(screen.getByText(/commented on ENG-4/)).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Show read' }));
    expect(screen.queryByText(/commented on ENG-4/)).toBeNull();
    expect(screen.getByText(/assigned ENG-4 to you/)).toBeTruthy();
  });

  it('filters the list from the find box', async () => {
    const { user } = renderInbox([
      notification('n-assign'),
      notification('n-comment', { type: 'comment', createdAt: '2026-08-16T10:00:00.000Z' }),
    ]);

    await user.type(screen.getByRole('textbox', { name: 'Find in inbox' }), 'commented');
    expect(screen.getByText(/commented on ENG-4/)).toBeTruthy();
    expect(screen.queryByText(/assigned ENG-4 to you/)).toBeNull();
  });

  it('marks the cursor row read with u', async () => {
    const { user, mutate } = renderInbox([notification('n-unread')]);

    await user.keyboard('u');
    expect(mutate).toHaveBeenCalled();
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: 'n-unread', read: true });
  });
});
