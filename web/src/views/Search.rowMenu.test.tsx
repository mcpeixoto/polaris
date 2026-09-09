import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { updateIssue } from '~/features/issue/mutations';
import {
  Store,
  type Change,
  type Issue,
  type Label,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Search } from './Search';

/**
 * What a search result can be done to, rather than what it says.
 *
 * Search was the last list in the product where a row was only a link: no right-click, no
 * property shortcuts, and four glyphs that looked like controls and were pictures. These
 * cover the half of that which is easy to get subtly wrong — that the menu acts on the row
 * the pointer is over rather than the one the cursor happened to be on, and that a result
 * whose issue this device has never received refuses the write instead of swallowing it.
 *
 * The store is a real one, seeded through `applyChanges`, for the reason `pickers.test.tsx`
 * gives: a mocked store keeps passing through exactly the changes that break the screen.
 * `gql` is the one thing stubbed, because the ranking is the server's.
 */

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

// Spied rather than exercised: what this file is about is *whether* a write is planned and
// for which issue, not how `updateIssues` batches one. That has its own suite.
vi.mock('~/features/issue/mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/features/issue/mutations')>();
  return { ...actual, updateIssue: vi.fn().mockResolvedValue(undefined) };
});

const gqlMock = vi.mocked(gql);
const updateIssueMock = vi.mocked(updateIssue);

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
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
    id: 'u-ada',
    workspaceId: WORKSPACE,
    name: 'Ada Lovelace',
    displayName: 'Ada Lovelace',
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function label(): Label {
  return {
    id: 'l-bug',
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'Bug',
    color: '#eb5757',
    isGroup: false,
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    description: '',
    dueDateSource: 'manual',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

type Entity = Team | WorkflowState | Issue | User | Label;

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Entity][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['workflowState', state('s-doing', 'In Progress', 'started')],
    ['user', person()],
    ['label', label()],
    ['issue', issue(1, 'Fix the flake')],
    ['issue', issue(2, 'Flaky importer')],
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

/** One issue as the search API returns it, which is not the same as one in the replica. */
function wireIssue(id: string, identifier: string, title: string) {
  return {
    id,
    identifier,
    title,
    priority: 0,
    state: { id: 's-todo', name: 'Todo', category: 'unstarted', color: '#5e6ad2' },
    assignee: null,
  };
}

function wireComment(id: string, issueId: string, body: string) {
  return { id, issueId, body, createdAt: AT };
}

function answer(issues: readonly unknown[], comments: readonly unknown[] = []) {
  return { search: { issues, comments, issueCount: issues.length } };
}

function renderSearch(store: Store, path: string) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={[path]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/search" element={<Search />} />
            <Route path="/issue/:identifier" element={<div>an issue</div>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { engine, user: userEvent.setup() };
}

/** The results, in the order they are drawn. */
async function results(): Promise<HTMLElement[]> {
  await screen.findByRole('listbox');
  return screen.getAllByRole('option');
}

/**
 * Hands the keyboard to the results.
 *
 * The box is focused on arrival and the keymap deliberately does not deliver plain letters
 * to a text field, so `S` only means anything after this — which is exactly the handover the
 * field's own hint describes.
 */
async function leaveBox(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.keyboard('{Escape}');
}

beforeEach(() => {
  gqlMock.mockReset();
  updateIssueMock.mockClear();
  gqlMock.mockReturnValue(new Promise(() => {}));
});

describe('a search result', () => {
  it('moves the cursor to the row that was right-clicked, then opens the menu there', async () => {
    gqlMock.mockResolvedValue(
      answer([
        wireIssue('issue-1', 'ENG-1', 'Fix the flake'),
        wireIssue('issue-2', 'ENG-2', 'Flaky importer'),
      ]),
    );
    const { user } = renderSearch(seeded(), '/search?q=flake');

    const rows = await results();
    // The cursor starts on the first row, so the second is the one that proves it moved.
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');

    await user.pointer({ keys: '[MouseRight]', target: rows[1] as HTMLElement });

    expect(screen.getByRole('menu')).toBeTruthy();
    expect((await results())[1]?.getAttribute('aria-selected')).toBe('true');
    expect((await results())[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('never offers to delete, because there is nothing here to take it back with', async () => {
    gqlMock.mockResolvedValue(answer([wireIssue('issue-1', 'ENG-1', 'Fix the flake')]));
    const { user } = renderSearch(seeded(), '/search?q=flake');

    const rows = await results();
    await user.pointer({ keys: '[MouseRight]', target: rows[0] as HTMLElement });

    // The items that are here, and the one that deliberately is not: no multi-select, no
    // confirmation and no undo toast on this screen, which is what makes a right-click
    // delete recoverable on the issue list and unrecoverable here.
    expect(screen.getByRole('menuitem', { name: /^Status…/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Open issue/ })).toBeTruthy();
    // Copy is a submenu of link + ID, matching the shared builder.
    expect(screen.getByRole('menuitem', { name: /^Copy$/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Archive/ })).toBeNull();
  });

  it('refuses every property on a result the replica does not hold', async () => {
    // Ranked by the server, and about an issue this device has never received: there is no
    // local row to patch, so a write would be planned against nothing and sent nowhere.
    gqlMock.mockResolvedValue(answer([wireIssue('issue-99', 'ENG-99', 'Flake on CI')]));
    const { user } = renderSearch(seeded(), '/search?q=flake');

    const rows = await results();
    expect(rows).toHaveLength(1);

    // `aria-disabled` rather than `disabled`: an unavailable control that keeps its focus
    // and its tooltip is the one the reader can still ask about. See IconButton.
    for (const name of ['Todo', 'No labels', 'No priority', 'Unassigned']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    }

    await user.pointer({ keys: '[MouseRight]', target: rows[0] as HTMLElement });

    for (const name of [/^Status…/, /^Assignee…/, /^Priority…/, /^Project…/, /^Labels…/]) {
      expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('opens the status picker on S and writes what is chosen', async () => {
    gqlMock.mockResolvedValue(answer([wireIssue('issue-1', 'ENG-1', 'Fix the flake')]));
    const { engine, user } = renderSearch(seeded(), '/search?q=flake');

    await results();
    await leaveBox(user);
    await user.keyboard('s');

    const menu = screen.getByRole('menu', { name: 'Status' });
    expect(menu).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    expect(updateIssueMock).toHaveBeenCalledWith(engine, 'issue-1', { stateId: 's-doing' }, null);
  });

  it('leaves S alone when the cursor is on a comment', async () => {
    gqlMock.mockResolvedValue(answer([], [wireComment('c-1', 'issue-1', 'the flake again')]));
    const { user } = renderSearch(seeded(), '/search?q=flake');

    const rows = await results();
    expect(rows).toHaveLength(1);

    await leaveBox(user);
    await user.keyboard('s');

    // A comment has no status, and the action is disabled rather than silently doing
    // nothing — which is what lets the keystroke fall through to whatever claims it next.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(updateIssueMock).not.toHaveBeenCalled();
  });
});

describe('when nothing matches', () => {
  it('offers to drop the filter that is probably the reason', async () => {
    gqlMock.mockResolvedValue(answer([]));
    renderSearch(seeded(), '/search?q=zzz&filter=priority.in(1)');

    expect(await screen.findByRole('button', { name: 'Clear filter' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create issue/ })).toBeNull();
  });

  it('offers to file the work instead when there is no filter to blame', async () => {
    gqlMock.mockResolvedValue(answer([]));
    renderSearch(seeded(), '/search?q=zzz');

    expect(await screen.findByRole('button', { name: /Create issue/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });
});

/**
 * The menu's items were reachable with the pointer alone, on the one screen whose rows are
 * `role="option"` and never focused — so not even Shift+F10 had anything to aim at here.
 */
describe('reaching the result menu without a pointer', () => {
  it('opens on the cursor row when . is pressed', async () => {
    gqlMock.mockResolvedValue(
      answer([
        wireIssue('issue-1', 'ENG-1', 'Fix the flake'),
        wireIssue('issue-2', 'ENG-2', 'Flaky importer'),
      ]),
    );
    const { user } = renderSearch(seeded(), '/search?q=flake');

    await results();
    await leaveBox(user);
    await user.keyboard('.');

    // The menu is labelled with the identifier of the row it is about, which is the only
    // place it says out loud which result it belongs to.
    expect(await screen.findByRole('menu', { name: 'ENG-1' })).toBeTruthy();
  });

  it('follows the cursor rather than the first row', async () => {
    gqlMock.mockResolvedValue(
      answer([
        wireIssue('issue-1', 'ENG-1', 'Fix the flake'),
        wireIssue('issue-2', 'ENG-2', 'Flaky importer'),
      ]),
    );
    const { user } = renderSearch(seeded(), '/search?q=flake');

    await results();
    await leaveBox(user);
    await user.keyboard('j.');

    expect(await screen.findByRole('menu', { name: 'ENG-2' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'ENG-1' })).toBeNull();
    expect((await results())[1]?.getAttribute('aria-selected')).toBe('true');
  });
});
