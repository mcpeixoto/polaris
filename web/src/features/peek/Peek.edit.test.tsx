/**
 * Peek's properties rail is a rail of controls, not a printout.
 *
 * It used to draw the status, the priority and the rest as plain text: the panel that showed
 * you the issue under the cursor could not change one thing about it, so a glance that found
 * something wrong had to be shut and reopened as the issue screen. The rows are buttons now,
 * and what is covered here is the part of that which is easy to lose again — the naming that
 * lets a reader hear "Todo, Status" instead of "Status, Status", the write landing on the
 * peeked issue rather than on a selection, Escape dismissing the picker without taking the
 * panel with it, and the rows sitting in the tab order a panel's controls belong in.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Peek } from './Peek';

afterEach(cleanup);

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const BACKLOG = '01900000-0000-7000-8000-000000000003';
const TODO = '01900000-0000-7000-8000-000000000004';
const DOING = '01900000-0000-7000-8000-000000000005';
// The issue Peek is pointed at, and two more sitting in the same store — the stand-in for a
// list with a selection of its own, since Peek is told an id and nothing else.
const ISSUE_A = '01900000-0000-7000-8000-00000000000a';
const ISSUE_B = '01900000-0000-7000-8000-00000000000b';
const ISSUE_C = '01900000-0000-7000-8000-00000000000c';
const ADA = '01900000-0000-7000-8000-000000000006';
const CYCLE = '01900000-0000-7000-8000-000000000007';
const PROJECT = '01900000-0000-7000-8000-000000000008';
const LABEL = '01900000-0000-7000-8000-000000000009';
const ISSUE_LABEL = '01900000-0000-7000-8000-00000000000d';

const AT = '2026-01-01T00:00:00.000Z';

function issue(id: string, number: number, title: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    title,
    description: '',
    stateId: TODO,
    priority: 2,
    assigneeId: ADA,
    cycleId: CYCLE,
    projectId: PROJECT,
    dueDateSource: 'none',
    sortOrder: 'a',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function state(id: string, name: string, category: string, position: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: category === 'backlog',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function seeded(): Store {
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
        // No estimates, so the rail has no estimate row to reason about here.
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    ['workflowState', state(BACKLOG, 'Backlog', 'backlog', 'V')],
    ['workflowState', state(TODO, 'Todo', 'unstarted', 'V')],
    ['workflowState', state(DOING, 'In Progress', 'started', 'V')],
    [
      'user',
      {
        id: ADA,
        workspaceId: WORKSPACE,
        name: 'Ada Lovelace',
        displayName: 'Ada Lovelace',
        timezone: 'UTC',
        role: 'member',
        status: 'active',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'cycle',
      {
        id: CYCLE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 4,
        name: 'Cycle 4',
        startsAt: AT,
        endsAt: AT,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'project',
      {
        id: PROJECT,
        workspaceId: WORKSPACE,
        name: 'Importer',
        description: '',
        color: '#5e6ad2',
        statusId: 'ps-backlog',
        priority: 0,
        sortOrder: 'a',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'label',
      {
        id: LABEL,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        isGroup: false,
        name: 'Regression',
        color: '#eb5757',
        position: 'V',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    ['issue', issue(ISSUE_A, 7, 'Ship the importer')],
    ['issue', issue(ISSUE_B, 8, 'Rewrite the parser')],
    ['issue', issue(ISSUE_C, 9, 'Retire the old endpoint')],
    [
      'issueLabel',
      {
        id: ISSUE_LABEL,
        workspaceId: WORKSPACE,
        issueId: ISSUE_A,
        labelId: LABEL,
        teamId: TEAM,
        createdAt: AT,
      } as unknown as Entity,
    ],
  ];

  const store = new Store(WORKSPACE);
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

function renderPeek() {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      {/* Peek's rail draws the chord that does the same thing from the keyboard, and a
          key cap has to be able to ask the registry how to spell itself on this platform. */}
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Peek open issueId={ISSUE_A} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

/** The words `aria-describedby` actually points at — the hidden `<dt>`, not a copy of it. */
function descriptionOf(trigger: HTMLElement): string | null {
  const id = trigger.getAttribute('aria-describedby');
  if (id === null) return null;
  return document.getElementById(id)?.textContent ?? null;
}

describe('Peek’s properties rail, once it became editable', () => {
  it('names each row by its value and describes it with the property', () => {
    renderPeek();

    // "In Progress, Status" is the announcement this split is for: the name is what the
    // property is set to, the description is which property that is.
    for (const [value, property] of [
      ['Todo', 'Status'],
      ['High', 'Priority'],
      ['Ada Lovelace', 'Assignee'],
      ['Cycle 4', 'Cycle'],
      ['Importer', 'Project'],
      ['Regression', 'Labels'],
    ] as const) {
      const trigger = screen.getByRole('button', { name: value });
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(descriptionOf(trigger)).toBe(property);
    }
  });

  /*
   * Peek shows one issue, so a bulk write from it would have no visible subject: six rows
   * selected in the list and one on screen means five issues changing where nobody can see
   * it happen. The panel writes to the issue it draws, and the list's own toolbar — which
   * says how many it is about — is where a bulk edit belongs.
   */
  it('writes the status to the peeked issue alone, with two other issues in the store', async () => {
    const { user, mutate } = renderPeek();

    await user.click(screen.getByRole('button', { name: 'Todo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Backlog' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledTimes(1);
    // `updateIssue` sends one `UpdateIssueInput` naming its id; the optimistic patch is the
    // same claim locally, and both have to say A rather than B or C.
    expect(mutate.mock.calls[0]![0].variables.input).toMatchObject({
      id: ISSUE_A,
      stateId: BACKLOG,
    });
    expect(mutate.mock.calls[0]![0].optimistic).toEqual([
      expect.objectContaining({ type: 'issue', id: ISSUE_A }),
    ]);
  });

  it('closes the picker on Escape and leaves the panel standing', async () => {
    const { user, mutate } = renderPeek();

    await user.click(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    // Escape belongs to the topmost thing that can take it. The panel is not it while a
    // picker is open, so Peek is still here afterwards.
    expect(screen.getByRole('complementary', { name: 'Peek ENG-7' })).toBeTruthy();
  });

  /*
   * A list row's triggers are `tabIndex={-1}` inside a `role="option"`, because the row is
   * reached with `aria-activedescendant` and a Tab stop per property would turn one list
   * into hundreds. Peek is a panel, so its rows are ordinary focusable controls — and that
   * is the difference this asserts, since copying the row's trigger would have copied the
   * `-1` with it.
   */
  it('keeps its rows in the tab order, unlike the triggers on a list row', async () => {
    const { user } = renderPeek();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Todo' }));
    for (const value of ['Todo', 'High', 'Ada Lovelace', 'Cycle 4', 'Importer', 'Regression']) {
      expect(screen.getByRole('button', { name: value }).getAttribute('tabindex')).toBeNull();
    }
  });
});

/**
 * The panel's own menu had a pointer and nothing else.
 *
 * Peek pushes no key context of its own — that is deliberate, it is what lets the rail draw
 * the list's chords and have them be true — so its `.` is registered in `list` alongside the
 * list's own. Two bindings on one key in one context is only safe while their guards cannot
 * both match, and the split is the panel: open, the chord is the panel's. The list's half of
 * that pair lives in `IssueList.tsx`; this is the half that belongs to Peek.
 */
function renderPeekInList(open = true) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;

  // The list is what mounts Peek, and the list is what pushes `list`. Standing in for it is
  // the whole point: a `.` registered in a context nobody pushed fires nowhere.
  function InList() {
    useKeyContext('list');
    return <Peek open={open} issueId={ISSUE_A} />;
  }

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <InList />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

describe('reaching Peek’s menu without a pointer', () => {
  it('opens the panel’s menu on .', async () => {
    const { user } = renderPeekInList();

    await user.keyboard('.');

    // Longer than the default second: the panel's first paint is heavy, and on a loaded
    // machine this file's first mount has been seen to take most of it.
    const menu = await screen.findByRole('menu', { name: 'Issue actions' }, { timeout: 5000 });
    // Peek's menu carries no Delete, so the label item is what names the subject: only the
    // peeked issue carries Regression, the two others in the store carry nothing.
    expect(within(menu).getByRole('menuitem', { name: 'Open label Regression' })).toBeTruthy();
  });

  it('opens it from the synthesised event a browser sends for Shift+F10', async () => {
    renderPeekInList();

    // Nothing pressed and 0,0 for coordinates: the panel is measured rather than believed.
    fireEvent.contextMenu(screen.getByRole('complementary', { name: 'Peek ENG-7' }), {
      button: 0,
      buttons: 0,
      clientX: 0,
      clientY: 0,
    });

    // Longer than the default second: the panel's first paint is heavy, and on a loaded
    // machine this file's first mount has been seen to take most of it.
    const menu = await screen.findByRole('menu', { name: 'Issue actions' }, { timeout: 5000 });
    expect(within(menu).getByRole('menuitem', { name: 'Open label Regression' })).toBeTruthy();
  });

  it('leaves the chord alone while the panel is shut', async () => {
    const { user } = renderPeekInList(false);

    await user.keyboard('.');

    // Guarded, not merely registered. A closed Peek that still answered `.` would swallow
    // the chord the list needs for the row under its cursor.
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
