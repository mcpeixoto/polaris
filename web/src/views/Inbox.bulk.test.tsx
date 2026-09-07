/**
 * The four things the inbox gained when it stopped being a flat run of rows: tabs, a kind
 * filter, a selection, and an undo.
 *
 * All four are only true once the screen is mounted. The arithmetic under them is tested
 * beside `features/inbox`, and none of these assertions repeat it: what is checked here is
 * that the tab row draws the counts that arithmetic produced, that a bulk command writes
 * once per selected row and not once per screen, and that the undo the toast offers actually
 * puts a dismissed row back — which is the one promise on this screen the server cannot keep
 * on its own, and so the one worth a browser-shaped test.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { clearUndoOffers, UndoToast } from '~/features/undo/UndoToast';
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
/** Far enough out that the row is asleep for the length of any test run. */
const LATER = '2099-01-01T00:00:00.000Z';

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

const issue: Issue = {
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

/** An engine whose optimistic patches reach the replica, so the list moves as it would. */
function renderInbox(rows: Notification[]) {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', viewer),
    upsert(2, 'team', team),
    upsert(3, 'issue', issue),
    ...rows.map((row, index) => upsert(4 + index, 'notification', row)),
  ]);
  const mutate = vi.fn(
    async (input: {
      variables?: Record<string, unknown>;
      optimistic?: Parameters<Store['applyOptimistic']>[0];
    }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      return {};
    },
  );
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Inbox />
          <UndoToast />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, mutate, user: userEvent.setup() };
}

/** The rows of the list, by the sentence each one says. */
function events(): string[] {
  return screen.queryAllByRole('option').map((row) => row.textContent ?? '');
}

afterEach(() => clearUndoOffers());

describe('the inbox tabs', () => {
  it('filters to the right rows and counts them', async () => {
    const { user } = renderInbox([
      notification('n-unread'),
      notification('n-read', { readAt: AT, type: 'comment' }),
      notification('n-asleep', { snoozedUntil: LATER, type: 'mention' }),
    ]);

    // Inbox holds the two awake rows; the snoozed one is only in its own tab.
    expect(within(screen.getByRole('tab', { name: /^Inbox/ })).getByText('2')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /^Unread/ })).getByText('1')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /^Snoozed/ })).getByText('1')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /^Done/ })).getByText('1')).toBeTruthy();
    expect(events()).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: /^Snoozed/ }));
    expect(events()).toHaveLength(1);
    expect(events()[0]).toContain('mentioned you in ENG-4');

    await user.click(screen.getByRole('tab', { name: /^Done/ }));
    expect(events()).toHaveLength(1);
    expect(events()[0]).toContain('commented on ENG-4');
  });

  it('steps between tabs from the keyboard rather than a local key handler', async () => {
    const { user } = renderInbox([notification('n1'), notification('n2', { readAt: AT })]);

    await user.keyboard(']');
    expect(screen.getByRole('tab', { name: /^Unread/ }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{[}');
    expect(screen.getByRole('tab', { name: /^Inbox/ }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('the kind filter', () => {
  it('narrows the list to the reasons chosen, and clears back', async () => {
    const { user } = renderInbox([
      notification('n-assigned'),
      notification('n-mention', { type: 'mention', createdAt: '2026-08-16T10:00:00.000Z' }),
    ]);
    expect(events()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Filter by kind' })).getByText('Mentioned'),
    );

    expect(events()).toHaveLength(1);
    expect(events()[0]).toContain('mentioned you in ENG-4');
    // The narrowing is on the control itself, not only inside the menu it came from.
    expect(screen.getByRole('button', { name: 'Mentioned' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Mentioned' }));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Filter by kind' })).getByText('Clear filter'),
    );
    expect(events()).toHaveLength(2);
  });
});

describe('bulk actions over a selection', () => {
  it('marks read once per selected row, and not once per screen', async () => {
    const { user, mutate } = renderInbox([
      notification('n1'),
      notification('n2', { createdAt: '2026-08-16T10:00:00.000Z' }),
      notification('n3', { createdAt: '2026-08-16T09:00:00.000Z' }),
    ]);

    // The cursor starts on the newest row; `x` takes it, `shift+ArrowDown` takes the next.
    await user.keyboard('x');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(screen.getByRole('group', { name: 'Notification actions' })).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Mark read' }));

    const reads = mutate.mock.calls
      .map((call) => call[0].variables as { id?: string; read?: boolean })
      .filter((variables) => variables.read === true);
    expect(reads.map((variables) => variables.id).sort()).toEqual(['n1', 'n2']);
    // The third row was never in the selection and must not have been touched.
    expect(reads).toHaveLength(2);
  });

  it('dismisses the whole selection and offers one undo for it', async () => {
    const { user } = renderInbox([
      notification('n1'),
      notification('n2', { createdAt: '2026-08-16T10:00:00.000Z' }),
    ]);

    await user.keyboard('x');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(events()).toHaveLength(0);
    expect(screen.getByText('Dismissed 2 notifications')).toBeTruthy();
  });
});

describe('undo', () => {
  it('records a dismissal and puts the row back when the offer is taken', async () => {
    const { user, store } = renderInbox([
      notification('n1'),
      notification('n2', { type: 'comment', createdAt: '2026-08-16T10:00:00.000Z' }),
    ]);

    await user.keyboard('{Backspace}');
    expect(events()).toHaveLength(1);
    expect(store.notifications.has('n1')).toBe(false);
    expect(screen.getByText('Dismissed 1 notification')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(store.notifications.has('n1')).toBe(true);
    expect(events()).toHaveLength(2);
  });

  it('offers the way back from a bulk mark-read, and undoing makes them unread again', async () => {
    const { user, store } = renderInbox([
      notification('n1'),
      notification('n2', { createdAt: '2026-08-16T10:00:00.000Z' }),
    ]);

    await user.keyboard('x');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Mark read' }));
    expect(store.notifications.get('n1')?.readAt).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.notifications.get('n1')?.readAt).toBeUndefined();
    expect(store.notifications.get('n2')?.readAt).toBeUndefined();
  });
});
