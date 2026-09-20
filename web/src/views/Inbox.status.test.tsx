/**
 * The status circle on an inbox row is the way to change the status, and it is not the way
 * to open the notification.
 *
 * The inbox row is a harder case than the project row this pattern came from: clicking it
 * navigates *and* marks the notification read, so a click that leaked through the glyph
 * would take the reader off the screen and quietly clear a row they had not dealt with.
 * Those are the two halves worth pinning — the click reaches the picker and nothing else,
 * and the choice lands on the issue behind the glyph rather than on the cursor's row.
 *
 * The third test is about the rows that have no issue at all. A digest is a notification
 * about no issue in particular, so there is nothing for a picker to write to, and the row
 * draws no control rather than one that cannot work.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
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
const SHIPPED = '01900000-0000-7000-8000-000000000005';
const CRASH = '01900000-0000-7000-8000-000000000006';
const IMPORT = '01900000-0000-7000-8000-000000000007';
const ABOUT_CRASH = '01900000-0000-7000-8000-000000000008';
const ABOUT_IMPORT = '01900000-0000-7000-8000-000000000009';
const DIGEST = '01900000-0000-7000-8000-00000000000a';
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

describe('Inbox row status', () => {
  it('opens the status picker without opening or reading the notification', async () => {
    const user = userEvent.setup();
    renderInbox();

    const row = await screen.findByRole('option', { name: /ENG-1/ });
    await user.click(within(row).getByRole('button', { name: 'Todo' }));

    expect(await screen.findByRole('menu', { name: 'Status' })).toBeTruthy();
    // The row's own click would have navigated to the issue and marked the row read.
    expect(screen.queryByText('opened')).toBeNull();
    expect(store.get('notification', ABOUT_CRASH)?.readAt).toBeUndefined();
    expect(screen.getByRole('option', { name: /ENG-1/ }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('writes the chosen status to the issue the glyph belongs to', async () => {
    const user = userEvent.setup();
    renderInbox();

    // The older of the two rows, so a picker that acted on the cursor instead of on the
    // button would write to the wrong issue rather than to none.
    const row = await screen.findByRole('option', { name: /ENG-2/ });
    await user.click(within(row).getByRole('button', { name: 'Todo' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Status' })).getByRole('menuitem', {
        name: 'Shipped',
      }),
    );

    await waitFor(() => expect(store.get('issue', IMPORT)?.stateId).toBe(SHIPPED));
    expect(store.get('issue', CRASH)?.stateId).toBe(TODO);
    expect(store.get('notification', ABOUT_IMPORT)?.readAt).toBeUndefined();
  });

  it('redraws the row against the status that was chosen', async () => {
    const user = userEvent.setup();
    renderInbox();

    const row = await screen.findByRole('option', { name: /ENG-1/ });
    await user.click(within(row).getByRole('button', { name: 'Todo' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Status' })).getByRole('menuitem', {
        name: 'Shipped',
      }),
    );

    const trigger = await within(await screen.findByRole('option', { name: /ENG-1/ })).findByRole(
      'button',
      { name: 'Shipped' },
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  /**
   * The rows stopped being buttons so that the circle could be one, and a button was what
   * used to put the inbox in the tab order. The listbox took that over; if it ever loses it
   * the keyboard cannot reach this screen at all, which is not a failure any of the tests
   * above would notice.
   */
  it('keeps the list itself in the tab order now the rows are not', async () => {
    renderInbox();

    const list = await screen.findByRole('listbox', { name: 'Notifications' });
    expect(list.tabIndex).toBe(0);
    for (const row of screen.getAllByRole('option')) {
      expect(row.tagName).not.toBe('BUTTON');
      expect(row.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('leaves a row with no issue behind it without a status control', async () => {
    renderInbox();

    const row = await screen.findByRole('option', { name: /Polaris/ });
    expect(row.textContent).toContain('Polaris');
    expect(within(row).queryByRole('button')).toBeNull();
  });
});

function renderInbox() {
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/issue/:identifier" element={<p>opened</p>} />
            <Route path="/pulse" element={<p>opened</p>} />
          </Routes>
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
    change(3, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted', 'V')),
    change(4, 'workflowState', SHIPPED, state(SHIPPED, 'Shipped', 'completed', 'a')),
    change(5, 'issue', CRASH, issue(CRASH, 1, 'ENG-1', 'Crash on import')),
    change(6, 'issue', IMPORT, issue(IMPORT, 2, 'ENG-2', 'Importer drops rows')),
    change(
      7,
      'notification',
      ABOUT_CRASH,
      notification(ABOUT_CRASH, CRASH, 'issue_assigned', '2026-02-02T10:00:00.000Z'),
    ),
    change(
      8,
      'notification',
      ABOUT_IMPORT,
      notification(ABOUT_IMPORT, IMPORT, 'comment', '2026-02-02T09:00:00.000Z'),
    ),
    change(
      9,
      'notification',
      DIGEST,
      notification(DIGEST, undefined, 'pulse_digest', '2026-02-02T08:00:00.000Z'),
    ),
  ]);
  return store;
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}

function notification(
  id: string,
  issueId: string | undefined,
  type: Notification['type'],
  createdAt: string,
): Notification {
  return {
    id,
    workspaceId: WORKSPACE,
    userId: VIEWER,
    type,
    ...(issueId === undefined ? {} : { issueId }),
    actor: type === 'pulse_digest' ? { type: 'system' } : { type: 'user', id: VIEWER },
    changeVersion: 1,
    groupKey: `row-${id}`,
    count: 1,
    createdAt,
    updatedAt: createdAt,
  } as Notification;
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

function issue(id: string, number: number, identifier: string, title: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier,
    title,
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: `a${number}`,
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, name: string, category: string, position: string): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: id === TODO,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  } as WorkflowState;
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
