/**
 * The shell's chrome as Linear draws it: the top row with its two buttons, the sections a
 * person can close, the team rows with their emoji and their cycles, and the foot of the
 * column with help and the plan.
 *
 * Every assertion here is about a control that exists or a destination it reaches, not about
 * a pixel — the stylesheet is checked by eye, and what a test can hold still is that the
 * pencil opens the composer the `C` key opens and the "?" opens the sheet the `?` key opens.
 */

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { AppShell, teamCycleLinks } from './AppShell';
import { EngineProvider } from './context';
import { KeymapProvider } from './keymap';
import { workspaceInitials } from './nav';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000004';
const CYCLE_CURRENT = '01900000-0000-7000-8000-000000000010';
const CYCLE_NEXT = '01900000-0000-7000-8000-000000000011';
const CYCLE_LATER = '01900000-0000-7000-8000-000000000012';
const CYCLE_DONE = '01900000-0000-7000-8000-000000000013';
const AT = '2026-01-01T00:00:00.000Z';

let role: 'admin' | 'member' | 'guest' = 'admin';

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
  useViewerRole: () => role,
}));

const stored = new Map<string, string>();

beforeEach(() => {
  role = 'admin';
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
  vi.useRealTimers();
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

function cycle(
  id: string,
  number: number,
  startsAt: string,
  endsAt: string,
  extra: Record<string, unknown> = {},
): [string, Entity] {
  return [
    'cycle',
    {
      id,
      workspaceId: WORKSPACE,
      teamId: TEAM,
      number,
      name: `Cycle ${number}`,
      startsAt,
      endsAt,
      createdAt: AT,
      updatedAt: AT,
      ...extra,
    } as unknown as Entity,
  ];
}

function seeded(
  extra: readonly [string, Entity][] = [],
  workspaceOverrides: Record<string, unknown> = {},
): Store {
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
        ...workspaceOverrides,
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

function renderShell(store: Store, at = '/', status: EngineStatus = { phase: 'idle' }) {
  const engine = { store, mutate: vi.fn(), start: vi.fn().mockResolvedValue(undefined) };
  const renderCreateIssue = vi.fn(({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="New issue composer" /> : null,
  );
  const renderCreateProject = vi.fn(() => <div role="dialog" aria-label="New project composer" />);
  render(
    <MemoryRouter initialEntries={[at]}>
      <KeymapProvider>
        <EngineProvider engine={engine as unknown as SyncEngine} status={status}>
          <AppShell renderCreateIssue={renderCreateIssue} renderCreateProject={renderCreateProject}>
            <Routes>
              <Route path="/search" element={<div>Search screen</div>} />
              <Route path="*" element={<div />} />
            </Routes>
          </AppShell>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { engine, renderCreateIssue };
}

describe('the top row', () => {
  it('reaches search from a button as well as from /', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('Search screen')).toBeTruthy();
  });

  it('opens the composer from the pencil, the same one C opens', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Compose issue' }));
    expect(screen.getByRole('dialog', { name: 'New issue composer' })).toBeTruthy();
  });

  it('keeps the workspace menu behind the workspace name', () => {
    renderShell(seeded());
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('button', { name: 'Workspace menu' })).toBeTruthy();
  });
});

describe('the workspace initials', () => {
  it('takes one letter from each of the first two words', () => {
    expect(workspaceInitials('Polaris')).toBe('P');
    expect(workspaceInitials('Peixoto Labs')).toBe('PL');
    expect(workspaceInitials('  three word name ')).toBe('TW');
    expect(workspaceInitials('')).toBe('');
  });
});

describe('the sections', () => {
  it('draws Workspace, Favourites, Your teams and Try as disclosures', () => {
    renderShell(seeded());
    for (const name of ['Workspace', 'Favourites', 'Your teams', 'Try']) {
      expect(
        screen.getByRole('button', { name }).getAttribute('aria-expanded'),
        `${name} is not a disclosure`,
      ).toBe('true');
    }
  });

  it('closes Workspace and remembers it', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    expect(screen.getByRole('link', { name: 'Projects' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(screen.queryByRole('link', { name: 'Projects' })).toBeNull();
    expect(JSON.parse(stored.get('polaris.sidebar') ?? '{}')).toMatchObject({
      sections: { workspace: false },
    });
  });

  it('keeps Inbox and My issues above every section, in that order', () => {
    renderShell(seeded());
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links.indexOf('Inbox')).toBeLessThan(links.indexOf('My issues'));
    expect(links.indexOf('My issues')).toBeLessThan(links.indexOf('Projects'));
  });

  it('has no Search row, because the button and / are how search is reached', () => {
    renderShell(seeded());
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).queryByRole('link', { name: 'Search' })).toBeNull();
  });
});

describe('the Try section', () => {
  it('offers the project composer, and withholds it from a guest', () => {
    renderShell(seeded());
    expect(
      within(screen.getByRole('group', { name: 'Try' })).getByRole('button', {
        name: 'Start a project',
      }),
    ).toBeTruthy();
  });

  it('withholds the project composer from a guest', () => {
    role = 'guest';
    renderShell(seeded());
    const group = screen.getByRole('group', { name: 'Try' });
    expect(within(group).queryByRole('button', { name: 'Start a project' })).toBeNull();
    expect(within(group).getByRole('button', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('opens the project composer from its row', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Start a project' }));
    expect(screen.getByRole('dialog', { name: 'New project composer' })).toBeTruthy();
  });

  it('keeps every settings screen out of the workspace sidebar, Try included', () => {
    renderShell(seeded());
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.startsWith('/settings'))).toEqual([]);
  });

  it('opens the shortcut sheet from its row', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    const group = screen.getByRole('group', { name: 'Try' });
    await user.click(within(group).getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});

describe('a team row', () => {
  it('shows the team’s emoji when it has one', () => {
    renderShell(seeded([team({ icon: '🚀' })]));
    const link = screen.getByRole('link', { name: /Engineering/ });
    expect(link.textContent).toContain('🚀');
    expect(link.textContent).not.toContain('ENG');
  });

  it('falls back to the key badge when it has none', () => {
    renderShell(seeded());
    const link = screen.getByRole('link', { name: /Engineering/ });
    expect(link.textContent).toContain('ENG');
  });
});

describe('a team’s cycles, opened', () => {
  const now = new Date('2026-03-10T12:00:00.000Z');

  function withCycles(): Store {
    return seeded([
      team({ cyclesEnabled: true }),
      cycle(CYCLE_DONE, 1, '2026-02-24T00:00:00.000Z', '2026-03-03T00:00:00.000Z'),
      cycle(CYCLE_CURRENT, 2, '2026-03-03T00:00:00.000Z', '2026-03-17T00:00:00.000Z'),
      cycle(CYCLE_LATER, 4, '2026-03-31T00:00:00.000Z', '2026-04-14T00:00:00.000Z'),
      cycle(CYCLE_NEXT, 3, '2026-03-17T00:00:00.000Z', '2026-03-31T00:00:00.000Z'),
    ]);
  }

  it('names the current cycle and the next one, and nothing later', () => {
    vi.useFakeTimers({ now, toFake: ['Date'] });
    expect(teamCycleLinks(withCycles(), TEAM)).toEqual({
      current: CYCLE_CURRENT,
      upcoming: CYCLE_NEXT,
    });
  });

  it('ignores an archived cycle whatever its dates say', () => {
    vi.useFakeTimers({ now, toFake: ['Date'] });
    const store = seeded([
      team({ cyclesEnabled: true }),
      cycle(CYCLE_CURRENT, 2, '2026-03-03T00:00:00.000Z', '2026-03-17T00:00:00.000Z', {
        archivedAt: AT,
      }),
    ]);
    expect(teamCycleLinks(store, TEAM)).toEqual({ current: null, upcoming: null });
  });

  it('nests Current and Upcoming under Cycles', async () => {
    vi.useFakeTimers({ now, toFake: ['Date'] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderShell(withCycles());
    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));
    const inside = within(screen.getByRole('group', { name: 'Engineering' }));
    expect(inside.getByRole('link', { name: 'Cycles' }).getAttribute('href')).toBe(
      '/team/ENG/cycles',
    );
    expect(inside.getByRole('link', { name: 'Current' }).getAttribute('href')).toBe(
      `/cycle/${CYCLE_CURRENT}`,
    );
    expect(inside.getByRole('link', { name: 'Upcoming' }).getAttribute('href')).toBe(
      `/cycle/${CYCLE_NEXT}`,
    );
  });

  it('draws neither row for a team with no cycle to go to', async () => {
    const user = userEvent.setup();
    renderShell(seeded([team({ cyclesEnabled: true })]));
    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));
    const inside = within(screen.getByRole('group', { name: 'Engineering' }));
    expect(inside.getByRole('link', { name: 'Cycles' })).toBeTruthy();
    expect(inside.queryByRole('link', { name: 'Current' })).toBeNull();
    expect(inside.queryByRole('link', { name: 'Upcoming' })).toBeNull();
  });
});

describe('a team’s three lists', () => {
  it('lights only the row whose filter the URL carries', async () => {
    const user = userEvent.setup();
    renderShell(seeded(), '/team/ENG');
    await user.click(screen.getByRole('button', { name: 'Expand Engineering' }));
    const inside = within(screen.getByRole('group', { name: 'Engineering' }));
    const current = (name: string) => inside.getByRole('link', { name }).className;
    // Three links share the pathname; only the unfiltered one is the screen on show.
    expect(current('Issues')).not.toBe(current('Active'));
    expect(current('Active')).toBe(current('Backlog'));

    await user.click(inside.getByRole('link', { name: 'Active' }));
    expect(current('Active')).not.toBe(current('Backlog'));
    expect(current('Issues')).toBe(current('Backlog'));
  });
});

describe('the foot of the sidebar', () => {
  it('opens the shortcut sheet from the help button', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('names the plan the price list knows the workspace by', () => {
    renderShell(seeded());
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByText('Cloud Free')).toBeTruthy();
  });

  it('says nothing about a plan the price list does not know', () => {
    renderShell(seeded([], { plan: 'legacy_trial' }));
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).queryByText(/plan/i)).toBeNull();
    expect(within(nav).queryByText('legacy_trial')).toBeNull();
  });

  it('keeps the collapse control, now at the foot', async () => {
    const user = userEvent.setup();
    renderShell(seeded());
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeTruthy();
  });
});
