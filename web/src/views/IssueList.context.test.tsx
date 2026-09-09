/**
 * The right-click menu, and the two things that changed underneath it.
 *
 * It hands off to a picker now. Choosing "Status…" used to close the menu and then open the
 * status picker, and closing the menu took the one-pixel anchor at the pointer out of the
 * document with it — so the picker fell back to the toolbar button it is registered against
 * and opened half a screen from where the user had right-clicked. jsdom has no geometry, so
 * the anchoring itself cannot be asserted here; what *can* be asserted is the observable
 * consequence, which is that the toolbar the picker used to fall back to is not on screen at
 * all. `Menu.anchoring.test.tsx` covers the measuring half.
 *
 * And it carries the navigation the row gave up. The label chips and the assignee avatar are
 * pickers now, so unless "Go to Ada Lovelace's issues" and "Open label Bug" live here there
 * is no pointer route from a list to a person's issues or to a label's view at all. That
 * makes these two items load-bearing rather than a nicety, which is why they are tested.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { formatKeySpec } from '~/keys';
import {
  Store,
  type Change,
  type Issue,
  type IssueLabel,
  type Label,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
}));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const ADA = 'user-ada';
const BUG = 'label-bug';
const AT = '2026-01-01T00:00:00Z';

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

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function person(): User {
  return {
    id: ADA,
    workspaceId: WORKSPACE,
    name: 'Ada Lovelace',
    displayName: 'Ada Lovelace',
    timezone: 'Europe/Lisbon',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function label(): Label {
  return {
    id: BUG,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'Bug',
    color: '#5e6ad2',
    isGroup: false,
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, sortOrder: string, assigned: boolean): Issue {
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
    ...(assigned ? { assigneeId: ADA } : {}),
    createdAt: AT,
    updatedAt: AT,
  };
}

/**
 * One issue carrying both a label and an assignee, because the two navigation items only
 * exist when there is something to navigate to.
 */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | User | Label | Issue | IssueLabel][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['workflowState', state('s-doing', 'In Progress', 'started')],
    ['user', person()],
    ['label', label()],
    ['issue', issue(1, 'Fix the flake', 'V', true)],
    ['issue', issue(2, 'Ship the importer', 'W', false)],
    [
      'issueLabel',
      {
        id: `issue-1:${BUG}`,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        issueId: 'issue-1',
        labelId: BUG,
        createdAt: AT,
      },
    ],
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderList() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/team/ENG']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Location />
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

function where(): string {
  return screen.getByTestId('location').textContent ?? '';
}

/** Right-click one row and wait for its menu. */
async function openContextMenu(title: string): Promise<HTMLElement> {
  fireEvent.contextMenu(screen.getByRole('option', { name: new RegExp(title) }), {
    clientX: 120,
    clientY: 240,
  });
  return screen.findByRole('menu', { name: 'Issue actions' });
}

/** jsdom lays nothing out, so the virtualiser has to be told its viewport is not zero. */
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

describe('the row context menu', () => {
  it('hands off to the picker without raising the toolbar it used to fall back to', async () => {
    const { user } = renderList();

    const menu = await openContextMenu('Ship the importer');
    await user.click(within(menu).getByRole('menuitem', { name: /^Status…/ }));

    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();
    expect(
      screen.queryByRole('group', { name: 'Issue actions' }),
      'a bulk toolbar on screen is the picker having fallen back to its registered trigger',
    ).toBeNull();
  });

  it('writes the row it was opened on', async () => {
    const { user, mutate } = renderList();

    const menu = await openContextMenu('Ship the importer');
    await user.click(within(menu).getByRole('menuitem', { name: /^Status…/ }));
    await user.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    const ids = mutate.mock.calls.flatMap((call) => {
      const input = (call[0] as { variables: { input?: { ids?: string[]; id?: string } } })
        .variables.input;
      return input?.ids ?? (input?.id === undefined ? [] : [input.id]);
    });
    expect(ids).toEqual(['issue-2']);
  });

  it('draws the chord beside each property', async () => {
    renderList();

    const menu = await openContextMenu('Ship the importer');

    for (const [label, spec] of [
      ['Status…', 's'],
      ['Assignee…', 'a'],
      ['Priority…', 'p'],
      ['Labels…', 'l'],
    ] as const) {
      const item = within(menu).getByRole('menuitem', { name: new RegExp(`^${label}`) });
      expect(item.textContent, `${label} should teach its key`).toContain(formatKeySpec(spec));
    }
  });

  it('carries the navigation the avatar and the chips gave up', async () => {
    const { user } = renderList();

    const menu = await openContextMenu('Fix the flake');
    await user.click(within(menu).getByRole('menuitem', { name: "Go to Ada Lovelace's issues" }));

    expect(where()).toBe(`/user/${ADA}`);
  });

  it('opens a label view from the row that carries the label', async () => {
    const { user } = renderList();

    const menu = await openContextMenu('Fix the flake');
    await user.click(within(menu).getByRole('menuitem', { name: 'Open label Bug' }));

    expect(where()).toBe(`/label/${BUG}`);
  });

  it('offers no assignee navigation on an unassigned row', async () => {
    renderList();

    const menu = await openContextMenu('Ship the importer');

    // Nothing to go to, so no item rather than an item that goes nowhere.
    expect(within(menu).queryByRole('menuitem', { name: /^Go to/ })).toBeNull();
  });
});

/**
 * Until this existed, every item in the menu above — Delete included — was reachable only
 * with a pointer. In a product whose whole argument is the keyboard, that is not a gap in
 * the menu, it is a gap in the product.
 */
describe('reaching the row menu without a pointer', () => {
  it('opens on the cursor row when . is pressed', async () => {
    const { user } = renderList();

    // The cursor starts on the first row, so this is the row the menu must be about.
    await user.keyboard('.');

    const menu = await screen.findByRole('menu', { name: 'Issue actions' });
    // The Delete row names its target, which is the only place the menu says out loud which
    // issue it is about.
    expect(within(menu).getByRole('menuitem', { name: 'Delete ENG-1' })).toBeTruthy();
  });

  it('follows the cursor rather than the first row', async () => {
    const { user } = renderList();

    await user.keyboard('j.');

    const menu = await screen.findByRole('menu', { name: 'Issue actions' });
    expect(within(menu).queryByRole('menuitem', { name: 'Delete ENG-1' })).toBeNull();
  });

  it('opens from the synthesised event a browser sends for Shift+F10', async () => {
    renderList();

    // No pointer behind it: nothing pressed, and Chrome reports 0,0 for the coordinates.
    // The menu must still be about the row the event came from.
    fireEvent.contextMenu(screen.getByRole('option', { name: /Ship the importer/ }), {
      button: 0,
      buttons: 0,
      clientX: 0,
      clientY: 0,
    });

    const menu = await screen.findByRole('menu', { name: 'Issue actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Delete ENG-2' })).toBeTruthy();
  });
});

/**
 * Archive was the one item missing from a menu that already had everything behind it.
 *
 * The confirm dialogue, the bulk path and the undo offer were all wired to `askArchive` and
 * reachable only from the selection toolbar — which appears only once something is selected.
 * So the ordinary gesture, right-click one row, offered Delete and no way to archive, and
 * Delete is the one that does not come back. Linear puts Archive in the same menu; so does
 * this now.
 */
describe('archiving from the row menu', () => {
  it('offers Archive above Delete, naming the row', async () => {
    const { user } = renderList();

    const menu = await openContextMenu('Ship the importer');
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');

    const archive = items.findIndex((label) => label.startsWith('Archive'));
    const remove = items.findIndex((label) => label.startsWith('Delete'));
    expect(archive).toBeGreaterThan(-1);
    // Order matters: the recoverable one is read first.
    expect(archive).toBeLessThan(remove);
    expect(items[archive]).toBe('Archive ENG-2');
    await user.keyboard('{Escape}');
  });

  it('asks before archiving, and sends nothing until it is answered', async () => {
    const { user, mutate } = renderList();

    const menu = await openContextMenu('Ship the importer');
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive ENG-2' }));

    // The dialogue is the whole point of `askArchive`: an item that archived on click would
    // be a single mis-click away from emptying somebody's board.
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('pluralises for a selection, as the delete row already does', async () => {
    const { user } = renderList();

    // Select both rows, then right-click one of them: the menu is about the selection, and
    // renames itself to say so. The cursor lives on the scroller as an `aria-activedescendant`,
    // so the keyboard goes there — clicking a row would open the issue instead.
    screen.getByRole('listbox').focus();
    await user.keyboard('x{ArrowDown}x');

    fireEvent.contextMenu(screen.getByRole('option', { name: /Ship the importer/ }), {
      clientX: 120,
      clientY: 240,
    });
    const menu = await screen.findByRole('menu', { name: 'Actions for 2 issues' });

    expect(within(menu).getByRole('menuitem', { name: 'Archive 2 issues' })).toBeTruthy();
    await user.keyboard('{Escape}');
  });
});
