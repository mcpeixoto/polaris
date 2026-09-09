/**
 * What the projects list does once it is more than a table: how it is grouped, what the
 * keyboard reaches, what a right-click offers, and the gate all three layouts stand behind.
 *
 * The claims here are the ones the screen used to get wrong. Grouping was hard-wired to
 * priority bands, so "whose projects are these" had no answer. `j` did nothing, because the
 * screen registered one action and claimed no key context. And the timeline was returned
 * before the loading gate, so it drew an unsettled replica as a plan with nothing in it.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Projects } from './Projects';

/** The rows, and not the `<option>`s of the toolbar's own dropdowns. */
function rows(): HTMLElement[] {
  return within(screen.getByRole('listbox', { name: 'Projects' })).getAllByRole('option');
}

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, workspaceId: WORKSPACE, role: 'admin', displayName: 'Ada' }),
  useViewerRole: () => 'admin',
}));

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

function status(id: string, name: string, category: string, position: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function user(id: string, displayName: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    email: `${id}@example.com`,
    displayName,
    role: 'member',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function project(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-started',
    priority: 0,
    sortOrder: id,
    updateSchedule: 'never',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', status('ps-planned', 'Planned', 'planned', 'a')),
    upsert(2, 'projectStatus', status('ps-started', 'In progress', 'started', 'b')),
    upsert(3, 'user', user('u2', 'Ada Lovelace')),
    upsert(4, 'project', project('p1', 'Launch', { leadId: 'u2' })),
    upsert(5, 'project', project('p2', 'Migrate', { statusId: 'ps-planned' })),
  ]);
  return store;
}

function mount(options: { store?: Store; phase?: EngineStatus; url?: string } = {}) {
  const mutate = vi.fn().mockResolvedValue(undefined);
  const engine = { store: options.store ?? seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[options.url ?? '/projects']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={options.phase ?? { phase: 'idle' }}>
          <Routes>
            <Route path="/projects" element={<Projects />} />
            <Route path="/project/:projectId" element={<p>opened</p>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

afterEach(cleanup);

describe('Projects grouping', () => {
  it('heads a group with each lead, and calls the projects with none what they are', () => {
    mount({ url: '/projects?group=lead' });

    const headings = screen.getAllByRole('button', { expanded: true });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Ada Lovelace1', 'No lead1']);
  });

  it('groups by status when asked, in the workspace order rather than alphabetically', () => {
    mount({ url: '/projects?group=status' });

    const headings = screen.getAllByRole('button', { expanded: true });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Planned1', 'In progress1']);
  });

  it('draws one flat run under no grouping', () => {
    mount({ url: '/projects?group=none' });

    expect(screen.queryAllByRole('button', { expanded: true })).toEqual([]);
    expect(rows()).toHaveLength(2);
  });

  it('orders by name when the ordering says so, and reverses on the direction', () => {
    mount({ url: '/projects?group=none&order=name&dir=desc' });

    const names = rows().map((row) => row.textContent);
    expect(names[0]).toContain('Migrate');
    expect(names[1]).toContain('Launch');
  });
});

describe('Projects columns', () => {
  it('draws only the columns the URL asks for', () => {
    mount({ url: '/projects?cols=lead' });

    expect(screen.queryByText('Target date')).toBeNull();
    expect(screen.queryByText('Health')).toBeNull();
    expect(screen.getByText('Lead')).toBeTruthy();
  });
});

describe('Projects keyboard', () => {
  it('moves the cursor with j and k, and Enter opens the project under it', async () => {
    const { user } = mount({ url: '/projects?group=none&order=name' });

    await user.keyboard('j');
    expect(rows()[1]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('k');
    expect(rows()[0]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('opened')).toBeTruthy());
  });
});

describe('Projects row menu', () => {
  it('opens on a right-click and favourites the row it was opened on', async () => {
    const { mutate, user } = mount();

    const row = screen.getByRole('link', { name: /Launch/ }).closest('[role="option"]');
    await user.pointer({ target: row as HTMLElement, keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for Launch' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Add to favourites' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as {
      optimistic: readonly { type: string; after: { kind: string; targetId: string } }[];
    };
    expect(written.optimistic[0]?.type).toBe('favorite');
    expect(written.optimistic[0]?.after.kind).toBe('project');
    expect(written.optimistic[0]?.after.targetId).toBe('p1');
  });
});

describe('Projects board', () => {
  it('draws a column per project status, empty ones included', () => {
    mount({ url: '/projects?layout=board' });

    expect(
      within(screen.getByRole('region', { name: 'Planned' })).getByText('Migrate'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'In progress' })).getByText('Launch'),
    ).toBeTruthy();
  });
});

describe('Projects loading gate', () => {
  // The timeline used to be returned above the gate, so it rendered an unsettled replica as
  // a plan with nothing on it — the claim the gate exists to refuse.
  it('waits for the store before drawing the timeline', () => {
    mount({
      store: new Store(WORKSPACE),
      phase: { phase: 'hydrating' },
      url: '/projects?layout=timeline',
    });

    expect(screen.getByRole('status').textContent).toContain('Loading projects');
    expect(screen.queryByLabelText('Projects timeline')).toBeNull();
  });

  it('waits for the store before drawing the board', () => {
    mount({
      store: new Store(WORKSPACE),
      phase: { phase: 'hydrating' },
      url: '/projects?layout=board',
    });

    expect(screen.getByRole('status').textContent).toContain('Loading projects');
  });
});

describe('Projects peek', () => {
  /*
    Space is the glance the issue list already had and this one did not: the answer to "what
    is this project?" cost a navigation and the filters that came with it. Escape puts the
    panel away and hands the keyboard back to the list, which is the half that decides
    whether the next `j` moves anything.
  */
  it('opens the project under the cursor on Space, and Escape closes it', async () => {
    const { user } = mount({ url: '/projects?group=none&order=name' });

    await user.keyboard(' ');
    const panel = await screen.findByRole('complementary', { name: 'Peek Launch' });
    expect(panel.textContent).toContain('In progress');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Peek Launch' })).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Projects' })),
    );
  });

  it('follows the cursor rather than the row it was opened on', async () => {
    const { user } = mount({ url: '/projects?group=none&order=name' });

    await user.keyboard(' ');
    expect(await screen.findByRole('complementary', { name: 'Peek Launch' })).toBeTruthy();

    await user.keyboard('j');
    expect(await screen.findByRole('complementary', { name: 'Peek Migrate' })).toBeTruthy();
  });
});

describe('reaching the row menu without a pointer', () => {
  /*
    macOS has no Menu key and no Shift+F10, so on the platform this is built on the row menu
    was reachable only with a right-click. `.` is Linear's chord for it, and it has to act on
    the cursor row rather than the first one — otherwise the menu is about whatever the list
    happened to start on and moving the cursor means nothing.
  */
  it('opens the menu on the cursor row with the . chord', async () => {
    const { user } = mount({ url: '/projects?group=none&order=name' });

    await user.keyboard('.');

    expect(await screen.findByRole('menu', { name: 'Options for Launch' })).toBeTruthy();
  });

  it('follows the cursor rather than opening on the first row', async () => {
    const { user } = mount({ url: '/projects?group=none&order=name' });

    await user.keyboard('j.');

    expect(await screen.findByRole('menu', { name: 'Options for Migrate' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Options for Launch' })).toBeNull();
  });

  it('opens on the card under the cursor on the board too', async () => {
    const { user } = mount({ url: '/projects?layout=board' });

    // The board walks its columns in the workspace's status order, so the cursor starts on
    // Planned's card and one `j` puts it on the one in progress.
    await user.keyboard('j.');

    expect(await screen.findByRole('menu', { name: 'Options for Launch' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Options for Migrate' })).toBeNull();
  });
});
