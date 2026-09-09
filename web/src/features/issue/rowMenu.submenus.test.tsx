/**
 * The cascading half of the row menu.
 *
 * Two things are worth holding here and nothing else is. The first is that the tree a surface
 * gets *without* options is the tree it has always had — `rowMenu.test.tsx` describes that one
 * in full, and this file only insists that passing no options changes nothing about it, which
 * is what lets Search keep a menu whose rows are not in the replica. The second is that a
 * value chosen in a cascade goes to `set` rather than to `pick`: the whole point of the change
 * is that a status no longer costs a menu, a hand-off and a second aim.
 */

import { describe, expect, it, vi } from 'vitest';

import type { MenuItem, MenuNode, MenuSubmenu } from '~/components';

import {
  issueRowMenuItems,
  type IssueRowMenuCommands,
  type IssueRowMenuOptions,
  type IssueRowMenuTarget,
} from './rowMenu';

const ONE: IssueRowMenuTarget = {
  count: 1,
  editable: true,
  canSetStatus: true,
  identifier: 'ENG-402',
  estimates: true,
  cycles: true,
};

const OPTIONS: IssueRowMenuOptions = {
  states: [
    { id: 's-todo', name: 'Todo', category: 'unstarted', color: '#5e6ad2' },
    { id: 's-doing', name: 'In Progress', category: 'started', color: '#f2c94c' },
  ],
  stateId: 's-doing',
  priority: 2,
  people: [{ id: 'u-ada', name: 'Ada Lovelace', avatarUrl: null }],
  assigneeId: null,
  labels: [
    {
      key: 'ungrouped',
      heading: null,
      options: [
        {
          id: 'l-bug',
          name: 'Bug',
          color: '#eb5757',
          applied: true,
          displaces: [],
          displacedNames: [],
        },
        {
          id: 'l-design',
          name: 'Design',
          color: '#5e6ad2',
          applied: false,
          displaces: [],
          displacedNames: [],
        },
      ],
    },
  ],
  projects: [{ id: 'p-apollo', name: 'Apollo', heading: 'Active' }],
  projectId: null,
  milestones: [{ id: 'm-beta', name: 'Beta' }],
  milestoneId: null,
  cycles: [],
  cycleId: null,
  estimates: [
    { value: null, label: 'No estimate' },
    { value: 3, label: '3' },
  ],
  estimate: 3,
  dueDates: [{ id: 'today', label: 'Today', date: '2026-09-09' }],
  dueDate: null,
  candidates: [
    { id: 'issue-7', identifier: 'ENG-7', title: 'Fix the flake', category: 'started' },
    { id: 'issue-9', identifier: 'ENG-9', title: 'Ship the importer', category: 'backlog' },
  ],
};

function submenu(nodes: readonly MenuNode[], id: string): MenuSubmenu | undefined {
  return nodes.find((node): node is MenuSubmenu => node.kind === 'submenu' && node.id === id);
}

function items(nodes: readonly MenuNode[]): MenuItem[] {
  return nodes.filter((node): node is MenuItem => node.kind === undefined);
}

/** The shape of the tree, ignoring the closures, so two builds can be compared. */
function shapeOf(nodes: readonly MenuNode[]): unknown {
  return nodes.map((node) => {
    if (node.kind === 'separator') return 'separator';
    if (node.kind === 'heading') return `heading:${node.label}`;
    if (node.kind === 'submenu') {
      return { submenu: node.id, label: node.label, items: shapeOf(node.items) };
    }
    return { item: node.id, label: node.label, keys: node.keys, disabled: node.disabled };
  });
}

describe('issueRowMenuItems without options', () => {
  it('is exactly the flat tree it has always been', () => {
    // The guarantee Search depends on: its rows may not be in the replica at all, so there is
    // nothing to offer for them and the hand-off list is the only correct menu.
    const commands: IssueRowMenuCommands = {
      pick: vi.fn(),
      open: vi.fn(),
      copyLink: vi.fn(),
      askDelete: vi.fn(),
    };
    const flat = issueRowMenuItems(ONE, commands, { status: 's' });
    const withUndefined = issueRowMenuItems(ONE, commands, { status: 's' }, undefined);

    expect(shapeOf(withUndefined)).toEqual(shapeOf(flat));
    expect(submenu(flat, 'status')).toBeUndefined();
  });

  it('leaves every property a hand-off when the surface can set nothing', () => {
    // `set` is what a cascade needs; a surface that offers lists and no way to write them
    // would draw menus that choose nothing.
    const nodes = issueRowMenuItems(ONE, { pick: vi.fn() }, {}, OPTIONS);

    expect(submenu(nodes, 'status')).toBeUndefined();
  });
});

describe('issueRowMenuItems with options', () => {
  const commands = (): IssueRowMenuCommands => ({
    pick: vi.fn(),
    set: vi.fn(),
    toggleLabel: vi.fn(),
    markAs: vi.fn(),
    createRelated: vi.fn(),
    makeCopy: vi.fn(),
    copyLink: vi.fn(),
    copyIdentifier: vi.fn(),
    copyTitle: vi.fn(),
    copyTitleAsLink: vi.fn(),
    copyGitBranch: vi.fn(),
  });

  it('draws status as a cascade whose rows carry an icon, with the current one ticked', () => {
    const run = commands();
    const nodes = issueRowMenuItems(ONE, run, { status: 's' }, OPTIONS);

    const status = submenu(nodes, 'status');
    // The row still promises a question and the panel is named for the property: "Status…"
    // opens a menu called "Status".
    expect(status?.label).toBe('Status…');
    expect(status?.text).toBe('Status');
    expect(status?.keys).toBe('s');
    const rows = items(status?.items ?? []);
    expect(rows.map((row) => row.id)).toEqual(['s-todo', 's-doing']);
    for (const row of rows) expect(row.icon).toBeTruthy();
    expect(rows.find((row) => row.id === 's-doing')?.selected).toBe(true);

    rows[0]?.onSelect();
    expect(run.set).toHaveBeenCalledWith('status', 's-todo');
  });

  it('keeps the properties in the rail’s order rather than the flat menu’s', () => {
    const nodes = issueRowMenuItems({ ...ONE, milestone: true }, commands(), {}, OPTIONS);
    const ids: string[] = [];
    for (const node of nodes) {
      if (node.kind === 'separator') break;
      if (node.kind === 'submenu') ids.push(node.id);
    }

    expect(ids).toEqual([
      'status',
      'priority',
      'assignee',
      'due',
      'labels',
      'project',
      'estimate',
      'cycle',
      'milestone',
    ]);
  });

  it('filters the assignee cascade and offers nobody as a value', () => {
    const run = commands();
    const nodes = issueRowMenuItems(ONE, run, {}, OPTIONS);

    const assignee = submenu(nodes, 'assignee');
    expect(assignee?.filterable).toBe(true);
    const rows = items(assignee?.items ?? []);
    expect(rows[0]?.id).toBe('assignee-none');
    expect(rows[0]?.selected).toBe(true);

    rows[1]?.onSelect();
    expect(run.set).toHaveBeenCalledWith('assignee', 'u-ada');
  });

  it('makes labels a filterable multi-select that says what is already on', () => {
    const run = commands();
    const nodes = issueRowMenuItems(ONE, run, {}, OPTIONS);

    const labels = submenu(nodes, 'labels');
    expect(labels?.filterable).toBe(true);
    const rows = items(labels?.items ?? []);
    expect(rows.find((row) => row.id === 'l-bug')?.selected).toBe(true);
    expect(rows.find((row) => row.id === 'l-design')?.selected).toBe(false);

    // Choosing an applied label takes it off, which is what makes one list both menus.
    rows.find((row) => row.id === 'l-bug')?.onSelect();
    expect(run.toggleLabel).toHaveBeenCalledWith('l-bug', true, []);
  });

  it('offers the relatives and a way out to the calendar', () => {
    const run = commands();
    const nodes = issueRowMenuItems(ONE, run, {}, OPTIONS);

    const due = items(submenu(nodes, 'due')?.items ?? []);
    expect(due.map((row) => row.id)).toEqual(['today', 'due-none', 'due-custom']);

    due[0]?.onSelect();
    expect(run.set).toHaveBeenCalledWith('due', '2026-09-09');

    // The one row that is still a hand-off: a calendar is a panel, not a list.
    due[2]?.onSelect();
    expect(run.pick).toHaveBeenCalledWith('due');
  });

  it('lists the issues a "Mark as" box found, and writes the one chosen', () => {
    const run = commands();
    const onSearch = vi.fn();
    const nodes = issueRowMenuItems(ONE, run, { markBlockedBy: 'm b' }, { ...OPTIONS, onSearch });

    const markAs = submenu(nodes, 'mark-as');
    expect(markAs?.items.map((node) => (node.kind === 'submenu' ? node.id : ''))).toEqual([
      'mark-parentOf',
      'mark-subIssueOf',
      'mark-related',
      'mark-blockedBy',
      'mark-blocking',
      'mark-duplicateOf',
    ]);

    const blockedBy = markAs?.items.find(
      (node): node is MenuSubmenu => node.kind === 'submenu' && node.id === 'mark-blockedBy',
    );
    expect(blockedBy?.filterable).toBe(true);
    expect(blockedBy?.keys).toBe('m b');
    // The surface runs the search: the corpus is not a list the menu can hold.
    blockedBy?.onFilterChange?.('ENG-7');
    expect(onSearch).toHaveBeenCalledWith('ENG-7');

    const candidates = items(blockedBy?.items ?? []);
    expect(candidates[0]?.label).toBe('ENG-7 Fix the flake');
    candidates[0]?.onSelect();
    expect(run.markAs).toHaveBeenCalledWith('blockedBy', 'issue-7');
  });

  it('offers the five copies and a copy of the issue itself', () => {
    const run = commands();
    const nodes = issueRowMenuItems(ONE, run, {}, OPTIONS);

    const copy = submenu(nodes, 'copy');
    expect(items(copy?.items ?? []).map((row) => row.id)).toEqual([
      'copy-link',
      'copy-id',
      'copy-title',
      'copy-title-link',
      'copy-branch',
    ]);
    expect(items(nodes).find((row) => row.id === 'make-copy')).toBeTruthy();
  });

  it('drops the one-issue commands when the menu is about a selection', () => {
    const many: IssueRowMenuTarget = {
      count: 4,
      editable: true,
      canSetStatus: true,
      estimates: false,
      cycles: false,
    };
    const nodes = issueRowMenuItems(many, commands(), {}, OPTIONS);

    // A parent for four issues is not a thing anybody can mean, and neither is one copy of
    // four. The properties above are still cascades: those genuinely apply to all four.
    expect(submenu(nodes, 'mark-as')).toBeUndefined();
    expect(submenu(nodes, 'create-related')).toBeUndefined();
    expect(items(nodes).find((row) => row.id === 'make-copy')).toBeUndefined();
    expect(submenu(nodes, 'status')).toBeTruthy();
  });

  it('offers the two detail-only properties only where the commands exist', () => {
    const withPanels = issueRowMenuItems(
      ONE,
      { ...commands(), addLink: vi.fn(), rename: vi.fn() },
      { addLink: 'mod+shift+u', rename: 'e' },
      OPTIONS,
    );
    expect(items(submenu(withPanels, 'more-properties')?.items ?? []).map((row) => row.id)).toEqual(
      ['add-link', 'rename'],
    );

    // A list row has no Links panel and no title field, so it draws neither rather than
    // drawing two items that open nothing.
    expect(
      submenu(issueRowMenuItems(ONE, commands(), {}, OPTIONS), 'more-properties'),
    ).toBeUndefined();
  });

  it('disables every cascade on a row this client cannot write', () => {
    const nodes = issueRowMenuItems({ ...ONE, editable: false }, commands(), {}, OPTIONS);

    expect(submenu(nodes, 'status')?.disabled).toBe(true);
    expect(submenu(nodes, 'labels')?.disabled).toBe(true);
  });
});
