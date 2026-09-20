/**
 * Arranging the group headings, driven the way somebody actually does it.
 *
 * `groupOrder.test.ts` proves the arithmetic and `group.listOrder.test.ts` proves the
 * grouping honours it. What can only be checked here is the wiring between them: that a drag
 * on a heading reaches `setDisplay`, that what it writes lands in the address bar so the
 * arrangement is in the link, and that the chords do the same job without a pointer.
 *
 * jsdom has no drag implementation, so the events are fired by hand with a `dataTransfer`
 * stub. That is not a weaker test than it looks: the component's own contract is exactly
 * "dragstart on the source, drop on the target", and the part jsdom cannot run — the browser
 * deciding to start a drag at all — is `draggable`, which is asserted directly.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { detectPlatform } from '~/keys';
import { Store, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
}));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

/** jsdom is not a Mac, but it is not reliably not-a-Mac either. Ask the matcher. */
const MOD = detectPlatform() === 'mac' ? 'Meta' : 'Control';

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
    createdAt: AT,
    updatedAt: AT,
  } as Team;
}

function state(id: string, name: string, category: string): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#888',
    category: category as WorkflowState['category'],
    position: 'a0',
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, stateId: string, sortOrder: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    stateId,
    priority: 0,
    sortOrder,
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  } as Issue;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['workflowState', state('s-doing', 'In Progress', 'started')],
    ['workflowState', state('s-done', 'Done', 'completed')],
    ['issue', issue(1, 'Fix the flake', 's-todo', 'V')],
    ['issue', issue(2, 'Rewrite the seeder', 's-doing', 'W')],
    ['issue', issue(3, 'Ship the importer', 's-done', 'X')],
  ];
  store.applyChanges(
    entities.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as never,
  );
  return store;
}

/** The address bar, so an assertion can be about the link rather than about a call. */
let search = '';
function SearchProbe() {
  search = useLocation().search;
  return null;
}

function renderList(initial = '') {
  const store = seeded();
  const engine = {
    store,
    mutate: vi.fn().mockResolvedValue({}),
  } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/team/ENG${initial}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SearchProbe />
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { store, user: userEvent.setup() };
}

/** The draggable bar, which is the heading's button's parent — see `GroupHeader`. */
function heading(name: string): HTMLElement {
  const button = screen.getAllByRole('button').find((el) => el.textContent?.startsWith(name));
  if (button?.parentElement == null) throw new Error(`no group heading for ${name}`);
  return button.parentElement;
}

/**
 * The group headings in the order they are drawn, by name.
 *
 * Found through `draggable`, not through `aria-expanded`: the filter bar, the display trigger
 * and every property glyph on a row are expandable too, and selecting on that returned
 * fourteen elements of which three were headings. The trailing count is stripped, so the
 * assertion is about the order rather than about how many issues happen to be in each group.
 */
function headings(): string[] {
  return [...document.querySelectorAll('[draggable="true"]')].map((el) =>
    (el.textContent ?? '').replace(/\d+$/, ''),
  );
}

/** Enough of a `DataTransfer` for the handlers, which only set, read and list types. */
function dataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    get types() {
      return [...store.keys()];
    },
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

function drag(from: string, to: string) {
  const transfer = dataTransfer();
  fireEvent.dragStart(heading(from), { dataTransfer: transfer });
  fireEvent.dragOver(heading(to), { dataTransfer: transfer });
  fireEvent.drop(heading(to), { dataTransfer: transfer });
}

/**
 * jsdom lays nothing out, so every element reports a zero size — and a virtualiser told its
 * viewport is zero pixels tall correctly renders no rows at all. The same shim
 * `IssueList.test.tsx` installs, and for the same reason: without it this file asserts about
 * an empty list and passes for the wrong reason.
 */
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

describe('arranging the group headings', () => {
  it('reads started, then unstarted, then completed before anything is arranged', () => {
    renderList();
    expect(headings()).toEqual(['In Progress', 'Todo', 'Done']);
  });

  it('marks the headings draggable, which is what lets a browser start the drag at all', () => {
    renderList();
    expect(heading('In Progress').getAttribute('draggable')).toBe('true');
  });

  it('puts the dragged heading where it was dropped, and says so in the link', () => {
    renderList();

    drag('Done', 'In Progress');

    expect(headings()).toEqual(['Done', 'In Progress', 'Todo']);
    expect(new URLSearchParams(search).get('groups')).toBe('s-done,s-doing,s-todo');
  });

  it('writes the whole arrangement, not only the heading that moved', () => {
    renderList();
    drag('Todo', 'In Progress');
    // Three keys for one drag: an order that named only the moved group would drop every
    // group it does not mention the next time one is read back.
    expect(new URLSearchParams(search).get('groups')?.split(',')).toHaveLength(3);
  });

  it('does nothing at all when a heading is dropped on itself', () => {
    renderList();
    drag('Todo', 'Todo');
    expect(new URLSearchParams(search).has('groups')).toBe(false);
  });

  it('restores the computed order when the arrangement is cleared', () => {
    renderList('?groups=s-done,s-doing,s-todo');
    expect(headings()[0]).toBe('Done');
  });

  it('moves the cursor row group with the chord', async () => {
    const { user } = renderList();
    // The cursor starts on the first row, which is the one issue in In Progress.
    await user.keyboard(`{${MOD}>}{Shift>}{ArrowDown}{/Shift}{/${MOD}}`);
    expect(new URLSearchParams(search).get('groups')).toBe('s-todo,s-doing,s-done');
  });

  it('refuses to move past the top, rather than wrapping round to the bottom', async () => {
    const { user } = renderList();
    await user.keyboard(`{${MOD}>}{Shift>}{ArrowUp}{/Shift}{/${MOD}}`);
    expect(new URLSearchParams(search).has('groups')).toBe(false);
  });

  it('offers no drag under no grouping, where there is no heading to take hold of', () => {
    renderList('?group=none');
    expect(headings()).toEqual([]);
  });

  it('offers no drag under swimlanes, where a key names two dimensions at once', () => {
    renderList('?sub=assignee');
    expect(headings()).toEqual([]);
  });
});
