/**
 * The three things about this screen that are only true in a browser.
 *
 * The cursor is `aria-activedescendant` rather than focus, so nothing scrolls unless the
 * screen scrolls it; a menu opened from a row has to hand the keyboard back to a list whose
 * row may no longer exist; and the contextual menu the spec asks for has to reach the issue
 * behind the notification, not just the notification. None of the three is visible from the
 * pure functions in `features/inbox`, and all three were broken.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Entity,
  type EntityType,
  type Issue,
  type Notification,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Inbox } from './Inbox';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000003';
const TODO = '01900000-0000-7000-8000-000000000004';
const ISSUE = '01900000-0000-7000-8000-000000000005';
const FIRST = '01900000-0000-7000-8000-000000000006';
const SECOND = '01900000-0000-7000-8000-000000000007';
const AT = '2026-01-01T00:00:00.000Z';

let store: Store;
let engine: SyncEngine;

beforeEach(() => {
  vi.mocked(gql).mockResolvedValue({ notifications: [] });
  store = seeded();
  const mutate = vi.fn(async (input: { optimistic?: Parameters<Store['applyOptimistic']>[0] }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  engine = { store, mutate } as unknown as SyncEngine;
});

describe('Inbox', () => {
  it('scrolls the cursor into view as J moves it', async () => {
    const user = userEvent.setup();
    renderInbox();

    const second = await screen.findByRole('option', { name: /commented/ });
    const scrollIntoView = vi.fn();
    second.scrollIntoView = scrollIntoView;

    await user.keyboard('j');

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('leaves the keyboard in the list when the snooze menu closes', async () => {
    const user = userEvent.setup();
    renderInbox();

    await screen.findByRole('listbox', { name: 'Notifications' });
    await user.keyboard('h');
    const menu = await screen.findByRole('menu', { name: 'Snooze until' });
    await user.click(within(menu).getByText('Tomorrow morning'));

    // The row it was about is snoozed and gone; focus must not have fallen to the body.
    expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Notifications' }));
  });

  it('opens a contextual menu on the row, with the issue’s own properties in it', async () => {
    const user = userEvent.setup();
    renderInbox();

    const row = await screen.findByRole('option', { name: /assigned/ });
    await user.pointer({ keys: '[MouseRight]', target: row });

    const menu = await screen.findByRole('menu', { name: 'Notification' });
    expect(within(menu).getByText('Mark read')).toBeTruthy();
    expect(within(menu).getByText('Snooze')).toBeTruthy();
    expect(within(menu).getByText('Change status')).toBeTruthy();

    await user.click(within(menu).getByText('Change status'));
    expect(await screen.findByRole('menu', { name: 'Status' })).toBeTruthy();
  });

  it('writes the issue property the contextual menu chose', async () => {
    const user = userEvent.setup();
    renderInbox();

    const row = await screen.findByRole('option', { name: /assigned/ });
    await user.pointer({ keys: '[MouseRight]', target: row });
    await user.click(
      within(await screen.findByRole('menu', { name: 'Notification' })).getByText('Set priority'),
    );
    await user.click(
      within(await screen.findByRole('menu', { name: 'Priority' })).getByText('Urgent'),
    );

    expect(store.get('issue', ISSUE)?.priority).toBe(1);
  });

  it('gives the row’s date the same tooltip every other date in the product has', async () => {
    renderInbox();
    await screen.findByRole('listbox', { name: 'Notifications' });
    const when = document.querySelector('time');
    expect(when).not.toBeNull();
    // Not the raw ISO string the row used to print into `title`.
    expect(when?.getAttribute('title')).not.toBe('2026-02-02T10:00:00.000Z');
    expect(when?.getAttribute('datetime')).toBe('2026-02-02T10:00:00.000Z');
  });
});

function renderInbox() {
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Inbox />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    change(1, 'team', TEAM, team()),
    change(2, 'user', VIEWER, user()),
    change(3, 'workflowState', TODO, state()),
    change(4, 'issue', ISSUE, issue()),
    change(5, 'notification', FIRST, notification(FIRST, '2026-02-02T10:00:00.000Z')),
    change(6, 'notification', SECOND, notification(SECOND, '2026-02-02T09:00:00.000Z')),
  ]);
  return store;
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}

function notification(id: string, createdAt: string): Notification {
  return {
    id,
    workspaceId: WORKSPACE,
    userId: VIEWER,
    type: id === FIRST ? 'issue_assigned' : 'comment',
    issueId: ISSUE,
    actor: { type: 'user', id: VIEWER },
    changeVersion: 1,
    groupKey: `row-${id}`,
    count: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function user(): User {
  return {
    id: VIEWER,
    workspaceId: WORKSPACE,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    displayName: 'Ada',
    timezone: 'Europe/Lisbon',
    kind: 'human',
    role: 'member',
    status: 'active',
    notificationPrefs: {},
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(): Issue {
  return {
    id: ISSUE,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'Crash on import',
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: 'a1',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(): WorkflowState {
  return {
    id: TODO,
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
