/**
 * The initiatives tree: indentation, the fold that survives a remount, the keyboard, the
 * headings a grouping produces, the right-click menu, and the gate that keeps a cold boot
 * from claiming the workspace is empty.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Initiatives } from './Initiatives';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'member', displayName: 'Ada' }),
}));

afterEach(() => {
  window.localStorage.clear();
});

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function initiative(id: string, name: string, sortOrder: string, ownerId?: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
    ...(ownerId === undefined ? null : { ownerId }),
  } as Entity;
}

function user(id: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    email: `${id}@example.com`,
    displayName: name,
    name,
    role: 'member',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function relation(id: string, parent: string, child: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    parentInitiativeId: parent,
    childInitiativeId: child,
    sortOrder: 'a',
    createdAt: AT,
  } as Entity;
}

interface Harness {
  readonly store: Store;
  readonly engine: SyncEngine;
  readonly mutate: ReturnType<typeof vi.fn>;
}

function harness(changes: Change[]): Harness {
  const store = new Store(WORKSPACE);
  store.applyChanges(changes);
  const mutate = vi.fn(async () => ({}));
  return { store, engine: { store, mutate } as unknown as SyncEngine, mutate };
}

function renderList(
  h: Harness,
  { url = '/initiatives', status = { phase: 'idle' } as EngineStatus } = {},
) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <KeymapProvider>
        <EngineProvider engine={h.engine} status={status}>
          <Routes>
            <Route path="/initiatives" element={<Initiatives />} />
            <Route path="/initiative/:initiativeId" element={<Opened />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

/** Where Enter lands, so a test can name the initiative that was opened. */
function Opened() {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  return <p>opened {initiativeId}</p>;
}

/** Parent with one child, which is the shape every tree assertion below needs. */
function tree(): Harness {
  return harness([
    upsert(1, 'initiative', initiative('parent', 'Company goals', 'a')),
    upsert(2, 'initiative', initiative('child', 'Platform reliability', 'b')),
    upsert(3, 'initiativeLabel', {
      id: 'il1',
      workspaceId: WORKSPACE,
      name: 'Platform',
      color: '#5e6ad2',
      isGroup: false,
      position: 'a0',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(4, 'initiativeLabelLink', {
      id: 'ill1',
      workspaceId: WORKSPACE,
      initiativeId: 'child',
      labelId: 'il1',
      createdAt: AT,
    }),
    upsert(5, 'initiativeRelation', relation('ir1', 'parent', 'child')),
  ]);
}

/** The row a link sits in — where the depth and the cursor live. */
function rowOf(name: string | RegExp): HTMLElement {
  const link = screen.getByRole('link', { name });
  const row = link.closest('li');
  if (row === null) throw new Error('row not found');
  return row;
}

describe('Initiatives list nesting', () => {
  it('indents a child under its parent and shows the label chip', () => {
    renderList(tree());

    const parent = screen.getByRole('link', { name: /Company goals/ });
    const child = screen.getByRole('link', { name: /Platform reliability/ });
    expect(parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The indent moved off the link and onto the row, so the chevron and the cells can be
    // siblings; a depth of one is still a depth of one.
    expect(rowOf(/Platform reliability/).style.getPropertyValue('--depth')).toBe('1');
    expect(rowOf(/Company goals/).style.getPropertyValue('--depth')).toBe('0');
    expect(screen.getByText('Platform')).toBeTruthy();
  });

  it('folds a parent, hides its children, and remembers the fold across a remount', async () => {
    const user_ = userEvent.setup();
    const h = tree();
    const first = renderList(h);

    await user_.click(screen.getByRole('button', { name: 'Collapse Company goals' }));
    expect(screen.queryByRole('link', { name: /Platform reliability/ })).toBeNull();

    first.unmount();
    renderList(h);
    expect(screen.queryByRole('link', { name: /Platform reliability/ })).toBeNull();
    // And it can be opened again from the state it came back in.
    await user_.click(screen.getByRole('button', { name: 'Expand Company goals' }));
    expect(screen.getByRole('link', { name: /Platform reliability/ })).toBeTruthy();
  });

  it('gives a chevron only to a row with something below it', () => {
    renderList(tree());
    expect(screen.getByRole('button', { name: 'Collapse Company goals' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Platform reliability/ })).toBeNull();
  });
});

describe('Initiatives list keyboard', () => {
  it('moves the cursor with j and k and opens the row under it with Enter', async () => {
    const user_ = userEvent.setup();
    renderList(tree());

    const list = screen.getByRole('listbox', { name: 'Initiatives' });
    list.focus();
    expect(rowOf(/Company goals/).getAttribute('aria-selected')).toBe('false');
    expect(rowOf(/Company goals/).hasAttribute('data-cursor')).toBe(true);

    await user_.keyboard('j');
    expect(rowOf(/Platform reliability/).hasAttribute('data-cursor')).toBe(true);
    await user_.keyboard('k');
    expect(rowOf(/Company goals/).hasAttribute('data-cursor')).toBe(true);

    await user_.keyboard('j{Enter}');
    // Enter opens the row the cursor is on, not the first row of the list.
    expect(screen.getByText('opened child')).toBeTruthy();
  });
});

describe('Initiatives list grouping', () => {
  it('groups by owner under a heading each, with the ownerless run last', () => {
    const h = harness([
      upsert(1, 'user', user('u2', 'Grace')),
      upsert(2, 'initiative', initiative('a', 'Company goals', 'a', 'u2')),
      upsert(3, 'initiative', initiative('b', 'Someday', 'b')),
    ]);
    renderList(h, { url: '/initiatives?group=owner' });

    const grace = screen.getByRole('button', { name: /Grace/ });
    const none = screen.getByRole('button', { name: /No owner/ });
    expect(grace.compareDocumentPosition(none) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A grouping flattens the tree, so no row keeps a chevron of its own.
    expect(screen.queryByRole('button', { name: /^Collapse Company goals$/ })).toBeNull();
  });

  it('drops a column the display options turned off', () => {
    renderList(tree(), { url: '/initiatives?columns=labels,health,targetDate' });
    expect(screen.queryByText('Progress')).toBeNull();
    expect(screen.getByText('Labels')).toBeTruthy();
  });
});

describe('Initiatives list context menu', () => {
  it('favourites the right-clicked initiative', async () => {
    const user_ = userEvent.setup();
    const h = tree();
    renderList(h);

    await user_.pointer({ target: rowOf(/Company goals/), keys: '[MouseRight]' });
    await user_.click(screen.getByRole('menuitem', { name: 'Add to favourites' }));

    const call = h.mutate.mock.calls[0]?.[0] as {
      optimistic: readonly { type: string; after: { kind: string; targetId: string } | null }[];
    };
    expect(call.optimistic[0]?.type).toBe('favorite');
    expect(call.optimistic[0]?.after?.kind).toBe('initiative');
    expect(call.optimistic[0]?.after?.targetId).toBe('parent');
  });
});

describe('Initiatives list loading gate', () => {
  it('says it is loading until the replica has settled, and only then that it is empty', () => {
    const booting = renderList(harness([]), { status: { phase: 'bootstrapping' } as EngineStatus });
    expect(screen.getByText('Loading initiatives…')).toBeTruthy();
    expect(screen.queryByText('No initiatives yet')).toBeNull();
    booting.unmount();

    renderList(harness([]), { status: { phase: 'ready' } as EngineStatus });
    expect(screen.getByText('No initiatives yet')).toBeTruthy();
  });
});

describe('Initiatives list columns', () => {
  it('names its columns above the rows', () => {
    renderList(tree());
    for (const label of [
      'Name',
      'Labels',
      'Status',
      'Health',
      'Owner',
      'Target date',
      'Progress',
    ]) {
      expect(
        within(screen.getByRole('listbox', { name: 'Initiatives' })).getAllByText(label).length,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * Every item in the menu above — archive included — was reachable only with a pointer.
 * Shift+F10 and the Menu key reach it too, and macOS has neither.
 */
describe('reaching the initiative menu without a pointer', () => {
  it('opens on the cursor row when . is pressed', async () => {
    const user_ = userEvent.setup();
    renderList(tree());

    screen.getByRole('listbox', { name: 'Initiatives' }).focus();
    // The cursor starts on the first row, so that is the row the menu must name.
    await user_.keyboard('.');

    expect(await screen.findByRole('menu', { name: 'Options for Company goals' })).toBeTruthy();
  });

  it('follows the cursor rather than the first row', async () => {
    const user_ = userEvent.setup();
    renderList(tree());

    screen.getByRole('listbox', { name: 'Initiatives' }).focus();
    await user_.keyboard('j.');

    expect(
      await screen.findByRole('menu', { name: 'Options for Platform reliability' }),
    ).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Options for Company goals' })).toBeNull();
  });
});
