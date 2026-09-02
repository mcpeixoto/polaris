/**
 * The sidebar as a thing the user owns rather than a fixed rail.
 *
 * Everything here is a behaviour the shell did not have: a sidebar that collapses and
 * remembers, an edge that can be dragged and arrowed, sections that close, a team that opens
 * into the screens inside it, counts on the rows that know a number, and a favourites section
 * that still offers its own controls when it is empty.
 *
 * The persisted half is tested through `localStorage` deliberately. The whole point of the
 * feature is that the shape survives a reload, and a test that only asserted the toggle
 * flipped a boolean would pass for a version that forgot everything on refresh.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { AppShell } from './AppShell';
import { EngineProvider } from './context';
import { KeymapProvider } from './keymap';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('./Boot', () => ({
  useWorkspaceSession: () => ({
    workspaces: [
      {
        id: WORKSPACE,
        name: 'Polaris',
        urlKey: 'polaris',
        plan: 'free',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    currentId: WORKSPACE,
    switchTo: vi.fn(),
  }),
}));

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
  useViewerRole: () => 'admin',
}));

/**
 * A `localStorage` the suite can actually inspect.
 *
 * The runner's environment supplies a `localStorage` object with no methods on it at all —
 * which the shell survives, because every access there is guarded, and which is exactly why
 * the persistence has to be tested against something real. A Map-backed double is that
 * something, and asserting on it is asserting on the bytes a reload would read back.
 */
const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
      clear: () => stored.clear(),
    },
  });
});

afterEach(() => {
  stored.clear();
});

function team(overrides: Record<string, unknown> = {}): [string, Entity] {
  return [
    'team',
    {
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
      ...overrides,
    } as unknown as Entity,
  ];
}

function seeded(extra: readonly [string, Entity][] = []): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'workspace',
      {
        id: WORKSPACE,
        name: 'Polaris',
        urlKey: 'polaris',
        plan: 'free',
        pulseEnabled: true,
        customerRequestsEnabled: true,
        customerRevenueUnit: '',
        customerTiers: [],
        pulseDigestCadence: 'daily',
        projectUpdateReminderIntervalDays: 7,
        projectUpdateReminderWeekday: 5,
        projectUpdateReminderHour: 9,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    ...(extra.some(([type]) => type === 'team') ? [] : [team()]),
    ...extra,
  ];

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

function view(id: string, name: string): [string, Entity] {
  return [
    'view',
    {
      id,
      workspaceId: WORKSPACE,
      name,
      filter: { conj: 'and', nodes: [] },
      display: {},
      position: 'V',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity,
  ];
}

function favorite(
  id: string,
  kind: string,
  targetId: string,
  extra: Record<string, unknown> = {},
): [string, Entity] {
  return [
    'favorite',
    {
      id,
      workspaceId: WORKSPACE,
      userId: VIEWER,
      kind,
      targetId,
      position: 'V',
      createdAt: AT,
      updatedAt: AT,
      ...extra,
    } as unknown as Entity,
  ];
}

function renderShell(store: Store, at = '/', status: EngineStatus = { phase: 'idle' }) {
  const engine = { store, mutate: vi.fn(), start: vi.fn().mockResolvedValue(undefined) };
  render(
    <MemoryRouter initialEntries={[at]}>
      <KeymapProvider>
        <EngineProvider engine={engine as unknown as SyncEngine} status={status}>
          <AppShell>
            <div />
          </AppShell>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return engine;
}

describe('collapsing the sidebar', () => {
  it('takes the navigation away and leaves a way back', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    // Unmounted rather than hidden: a closed sidebar should be closed for a screen reader
    // and for the Tab key too, not merely invisible.
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeTruthy();
  });

  it('remembers that it was collapsed, which is the whole point of collapsing it', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const memory: unknown = JSON.parse(stored.get('polaris.sidebar') ?? '{}');
    expect((memory as { collapsed?: boolean }).collapsed).toBe(true);
  });

  it('answers the mod chord as well as the button, because that is what people arrive with', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    // Control rather than Meta: `mod` resolves per platform and the runner's navigator does
    // not look like an Apple one, so this is `⌘.` as the registry sees it here.
    await user.keyboard('{Control>}.{/Control}');
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
  });

  it('answers [ too, which is where the left hand already is', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.keyboard('{[}');
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
  });

  it('withdraws the jump pickers with the navigation that anchors them', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // `O V` opens a Menu positioned against a button inside that nav. With the nav gone the
    // anchor is gone, so the action has to go with it rather than fail when chosen.
    await user.keyboard('ov');
    expect(screen.queryByRole('menu', { name: 'Views' })).toBeNull();
  });
});

describe('the resize handle', () => {
  it('is a separator that says how wide the sidebar is', () => {
    renderShell(seeded());
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('232');
  });

  it('resizes from the keyboard, so the value it announces is one it can actually change', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    handle.focus();
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('separator', { name: 'Resize sidebar' }).getAttribute('aria-valuenow'),
    ).toBe('240');
  });

  it('clamps rather than letting the sidebar be dragged out of reach', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    handle.focus();
    await user.keyboard('{Home}');
    expect(
      screen.getByRole('separator', { name: 'Resize sidebar' }).getAttribute('aria-valuenow'),
    ).toBe('180');
  });
});

describe('the sections', () => {
  it('closes a section and unmounts the rows in it', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    expect(screen.getByRole('link', { name: /Engineering/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Teams' }));

    expect(screen.queryByRole('link', { name: /Engineering/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Teams' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('remembers which sections were closed', async () => {
    const user = userEvent.setup();
    renderShell(seeded([view('v-1', 'All bugs')]));
    await user.click(screen.getByRole('button', { name: 'Views' }));

    const memory: unknown = JSON.parse(stored.get('polaris.sidebar') ?? '{}');
    expect((memory as { sections?: Record<string, boolean> }).sections?.['views']).toBe(false);
  });
});

describe('a team, opened', () => {
  it('expands to the screens inside it, and only to routes that exist', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));

    const inside = within(screen.getByRole('group', { name: 'Engineering' }));
    const hrefOf = (name: string) => inside.getByRole('link', { name }).getAttribute('href') ?? '';
    expect(hrefOf('Issues')).toBe('/team/ENG');
    expect(hrefOf('Projects')).toBe('/team/ENG/projects');
    // Active and Backlog are the same list under the URL's own filter grammar rather than
    // routes of their own — the link somebody would copy out of the address bar.
    expect(hrefOf('Active')).toContain('/team/ENG?');
    expect(hrefOf('Backlog')).toContain('/team/ENG?');
  });

  it('leaves out the cadences the team does not run', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));
    // A link to a screen whose only content is "this is switched off" is not navigation.
    const inside = within(screen.getByRole('group', { name: 'Engineering' }));
    expect(inside.queryByRole('link', { name: 'Cycles' })).toBeNull();
    expect(inside.queryByRole('link', { name: /Triage/ })).toBeNull();
  });

  it('offers cycles and triage where the team runs them', async () => {
    const user = userEvent.setup();
    renderShell(seeded([team({ cyclesEnabled: true, triageEnabled: true })]));
    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));
    const inside = within(screen.getByRole('group', { name: 'Engineering' }));
    expect(inside.getByRole('link', { name: 'Cycles' }).getAttribute('href')).toBe(
      '/team/ENG/cycles',
    );
    expect(inside.getByRole('link', { name: 'Triage' }).getAttribute('href')).toBe(
      '/team/ENG/triage',
    );
  });

  it('starts closed, because nine teams expanded is the problem the chevron solves', () => {
    renderShell(seeded());
    expect(
      screen.getByRole('button', { name: 'Expand Engineering' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});

describe('the counts on the rows that know a number', () => {
  it('says nothing rather than "0" on an empty inbox', () => {
    renderShell(seeded());
    const inbox = screen.getByRole('link', { name: /Inbox/ });
    expect(inbox.textContent).toBe('Inbox');
  });
});

describe('favourites with nothing in them', () => {
  it('keeps its header and its controls, so a folder can still be made', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    // The guard that used to hide this section hid the only control that could create a
    // folder, so the folder feature was unreachable until a favourite arrived some other way.
    expect(screen.getByRole('button', { name: 'Favourites' })).toBeTruthy();
    expect(screen.getByText('Star a view, team or issue to keep it here')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole('textbox', { name: 'Folder name' })).toBeTruthy();
  });
});

describe('a favourites folder', () => {
  const withFolder = () =>
    seeded([
      favorite('f-folder', 'folder', 'f-folder', { name: 'Reading', position: 'V' }),
      view('v-1', 'All bugs'),
      favorite('f-1', 'view', 'v-1', { folderId: 'f-folder', position: 'W' }),
    ]);

  it('draws its name as text rather than as a live input', () => {
    renderShell(withFolder());
    expect(screen.getByText('Reading')).toBeTruthy();
    // The old header was a permanently live borderless input: a Tab stop per folder that
    // renamed on blur after any stray keystroke.
    expect(screen.queryByRole('textbox', { name: /Reading/ })).toBeNull();
  });

  it('puts rename and delete behind one menu', async () => {
    const user = userEvent.setup();
    renderShell(withFolder());
    await user.click(screen.getByRole('button', { name: 'Reading folder actions' }));
    const menu = screen.getByRole('menu', { name: 'Reading folder actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('offers an input only once rename is chosen', async () => {
    const user = userEvent.setup();
    renderShell(withFolder());
    await user.click(screen.getByRole('button', { name: 'Reading folder actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByRole('textbox', { name: 'Rename Reading' })).toBeTruthy();
  });

  it('asks before deleting, and says what happens to the rows inside', async () => {
    const user = userEvent.setup();
    renderShell(withFolder());
    await user.click(screen.getByRole('button', { name: 'Reading folder actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Reading?' });
    expect(dialog.textContent).toContain('move back to the sidebar');
  });
});

describe('dragging a favourite out of a folder', () => {
  const withFiledFavourite = () =>
    seeded([
      favorite('f-folder', 'folder', 'f-folder', { name: 'Reading', position: 'V' }),
      view('v-1', 'All bugs'),
      favorite('f-1', 'view', 'v-1', { folderId: 'f-folder', position: 'W' }),
    ]);

  it('keeps somewhere to drop it even when nothing is unfiled', () => {
    renderShell(withFiledFavourite());
    // The container used to be a bare div whose only children were the unfiled rows, so with
    // nothing unfiled it was zero pixels tall and could not be hit at all.
    expect(screen.getByRole('group', { name: 'Unfiled favourites' })).toBeTruthy();
  });

  it('says when something is over it', () => {
    renderShell(withFiledFavourite());
    const target = screen.getByRole('group', { name: 'Unfiled favourites' });
    fireEvent.dragEnter(target);
    expect(target.hasAttribute('data-drop-active')).toBe(true);
    fireEvent.dragLeave(target);
    expect(target.hasAttribute('data-drop-active')).toBe(false);
  });

  it('tells the pointer this is a move rather than a refusal', () => {
    renderShell(withFiledFavourite());
    const target = screen.getByRole('group', { name: 'Unfiled favourites' });
    const dataTransfer = { dropEffect: 'none', getData: () => '', setData: () => undefined };
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('move');
  });

  it('moves the focused favourite from the keyboard', async () => {
    const user = userEvent.setup();
    const engine = renderShell(
      seeded([
        view('v-1', 'First'),
        view('v-2', 'Second'),
        favorite('f-1', 'view', 'v-1', { position: 'V' }),
        favorite('f-2', 'view', 'v-2', { position: 'W' }),
      ]),
    );

    screen.getByRole('link', { name: 'Second' }).focus();
    await user.keyboard('{Control>}{ArrowUp}{/Control}');

    expect(engine.mutate).toHaveBeenCalled();
    const [call] = engine.mutate.mock.calls as unknown as [
      [{ optimistic: readonly { id: string }[] }],
    ];
    expect(call[0].optimistic[0]?.id).toBe('f-2');
  });

  it('does nothing when the keyboard is nowhere near a favourite', async () => {
    const user = userEvent.setup();
    const engine = renderShell(seeded([view('v-1', 'First'), favorite('f-1', 'view', 'v-1')]));
    await user.keyboard('{Control>}{ArrowUp}{/Control}');
    expect(engine.mutate).not.toHaveBeenCalled();
  });
});

describe('the hidden jump anchors', () => {
  it('are out of the tab order, so ten "Open X" stops do not precede My issues', () => {
    renderShell(seeded());
    for (const name of ['Open label', 'Open issue', 'Open view', 'Open favourite']) {
      expect(screen.getByRole('button', { name }).getAttribute('tabindex')).toBe('-1');
    }
  });
});

describe('arriving somewhere', () => {
  it('says which screen this is, for the people the entrance animation tells nothing', () => {
    renderShell(seeded(), '/inbox');
    const regions = screen.getAllByRole('status');
    expect(regions.some((region) => region.textContent === 'Inbox')).toBe(true);
  });

  it('names a screen the shell has no written name for', () => {
    renderShell(seeded(), '/team/ENG/archives');
    const regions = screen.getAllByRole('status');
    expect(regions.some((region) => region.textContent === 'Archives')).toBe(true);
  });
});

describe('the shell on a settings route', () => {
  it('still says which workspace is being edited', () => {
    renderShell(seeded(), '/settings');
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByText('Polaris')).toBeTruthy();
  });

  it('still shows the sync badge, on the screens whose saves are easiest to lose', () => {
    renderShell(seeded(), '/settings', { phase: 'ready', connection: 'connecting', pending: 0 });
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByText('Reconnecting')).toBeTruthy();
  });

  it('offers the collapse control there too', () => {
    renderShell(seeded(), '/settings');
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });
});

describe('the offline badge', () => {
  it('is a button whose name carries the error, rather than a word with a tooltip', () => {
    renderShell(seeded(), '/', { phase: 'failed', error: 'Failed to fetch' });
    expect(
      screen.getByRole('button', { name: 'Offline. Failed to fetch. Try connecting again' }),
    ).toBeTruthy();
  });

  it('retries the connection when pressed', async () => {
    const user = userEvent.setup();
    const engine = renderShell(seeded(), '/', { phase: 'failed', error: 'Failed to fetch' });
    await user.click(
      screen.getByRole('button', { name: 'Offline. Failed to fetch. Try connecting again' }),
    );
    expect(engine.start).toHaveBeenCalled();
  });
});
