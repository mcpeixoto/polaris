/**
 * The builder's job is to make four surfaces agree on one menu, so the tests are mostly
 * about what it *refuses* to draw: a key cap the caller did not claim, a destructive item
 * nobody asked for, an enabled property on a row this client cannot write.
 */

import { describe, expect, it, vi } from 'vitest';

import type { MenuItem, MenuNode, MenuSubmenu } from '~/components';

import { issueRowMenuItems, type IssueRowMenuTarget } from './rowMenu';

const ONE: IssueRowMenuTarget = {
  count: 1,
  editable: true,
  canSetStatus: true,
  identifier: 'ENG-402',
};

function items(nodes: readonly MenuNode[]): MenuItem[] {
  return nodes.filter((node): node is MenuItem => node.kind === undefined);
}

function byId(nodes: readonly MenuNode[], id: string): MenuItem | undefined {
  return items(nodes).find((item) => item.id === id);
}

describe('issueRowMenuItems', () => {
  it('offers the five properties in the same order whatever the surface', () => {
    const nodes = issueRowMenuItems(ONE, { pick: vi.fn() });

    expect(items(nodes).slice(0, 5).map((item) => item.id)).toEqual([
      'status',
      'assignee',
      'priority',
      'project',
      'labels',
    ]);
  });

  it('draws no key cap for a property the caller did not claim a chord for', () => {
    // The sub-issue panel is the reason this is a test and not a convention: `S` is
    // registered there, and it changes the parent's status. A cap it did not ask for would
    // be a promise the surface cannot keep.
    const nodes = issueRowMenuItems(ONE, { pick: vi.fn() }, { status: 's' });

    expect(byId(nodes, 'status')?.keys).toBe('s');
    expect(byId(nodes, 'assignee')?.keys).toBeUndefined();
    expect(byId(nodes, 'priority')?.keys).toBeUndefined();
  });

  it('draws no key caps at all when no chords are passed', () => {
    const nodes = issueRowMenuItems(ONE, { pick: vi.fn() });

    for (const item of items(nodes)) expect(item.keys).toBeUndefined();
  });

  it('disables every property on a row this client cannot write, and nothing else', () => {
    // A search result whose issue is not in the replica: there is no local row to patch, so
    // the write would return silently. Better disabled than a no-op that looks like success.
    const nodes = issueRowMenuItems(
      { count: 1, editable: false, canSetStatus: true },
      { pick: vi.fn(), open: vi.fn(), copyLink: vi.fn() },
    );

    expect(byId(nodes, 'status')?.disabled).toBe(true);
    expect(byId(nodes, 'labels')?.disabled).toBe(true);
    expect(byId(nodes, 'open')?.disabled).toBeFalsy();
    expect(byId(nodes, 'copy-link')?.disabled).toBeFalsy();
  });

  it('disables only status when a selection spans two workflows', () => {
    const nodes = issueRowMenuItems(
      { count: 4, editable: true, canSetStatus: false },
      { pick: vi.fn() },
    );

    expect(byId(nodes, 'status')?.disabled).toBe(true);
    expect(byId(nodes, 'assignee')?.disabled).toBe(false);
  });

  it('omits Delete entirely when the surface offers no delete', () => {
    const nodes = issueRowMenuItems(ONE, { pick: vi.fn(), open: vi.fn() });

    expect(byId(nodes, 'delete')).toBeUndefined();
  });

  it('names the issue when deleting one and counts them when deleting several', () => {
    const single = issueRowMenuItems(ONE, { pick: vi.fn(), askDelete: vi.fn() });
    expect(byId(single, 'delete')?.label).toBe('Delete ENG-402');
    expect(byId(single, 'delete')?.danger).toBe(true);

    const many = issueRowMenuItems(
      { count: 3, editable: true, canSetStatus: true },
      { pick: vi.fn(), askDelete: vi.fn() },
    );
    expect(byId(many, 'delete')?.label).toBe('Delete 3 issues');
  });

  it('carries the navigation the avatar and the chips gave up', () => {
    const goToAssignee = vi.fn();
    const goToLabel = vi.fn();
    const nodes = issueRowMenuItems(
      { ...ONE, assigneeName: 'Ada Lovelace', labels: [{ id: 'l1', name: 'bug' }] },
      { pick: vi.fn(), goToAssignee, goToLabel },
    );

    byId(nodes, 'go-assignee')?.onSelect();
    expect(goToAssignee).toHaveBeenCalled();

    byId(nodes, 'label-l1')?.onSelect();
    expect(goToLabel).toHaveBeenCalledWith('l1');
  });

  it('folds several labels into a submenu rather than burying the commands under them', () => {
    const nodes = issueRowMenuItems(
      {
        ...ONE,
        labels: [
          { id: 'l1', name: 'bug' },
          { id: 'l2', name: 'design' },
        ],
      },
      { pick: vi.fn(), goToLabel: vi.fn() },
    );

    const submenu = nodes.find(
      (node): node is MenuSubmenu => node.kind === 'submenu' && node.id === 'labels-nav',
    );
    expect(submenu?.items).toHaveLength(2);
  });

  it('offers no navigation when there is nothing to navigate to', () => {
    const nodes = issueRowMenuItems(ONE, { pick: vi.fn(), goToAssignee: vi.fn() });

    expect(byId(nodes, 'go-assignee')).toBeUndefined();
  });

  it('routes every property through one pick call', () => {
    const pick = vi.fn();
    const nodes = issueRowMenuItems(ONE, { pick });

    for (const item of items(nodes).slice(0, 5)) item.onSelect();

    expect(pick.mock.calls.map(([kind]) => kind)).toEqual([
      'status',
      'assignee',
      'priority',
      'project',
      'labels',
    ]);
  });
});
