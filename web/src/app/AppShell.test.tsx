/**
 * The sidebar, and the two questions it answers that are not merely presentational.
 *
 * **Which saved views may this person see.** A view with an owner is private to that owner.
 * The replica holds whatever the sync stream delivered, and the stream is scoped by team
 * rather than by view ownership — so "do not render somebody else's private view" is a
 * decision the client makes, and a decision the client makes is one a test has to hold it to.
 * This is the only place in the product where a client-side filter is the thing standing
 * between one person's private view and another person's sidebar.
 *
 * **What a favourite points at.** A favourite is a `(kind, targetId)` pair with no copy of
 * the target's name, so every row is a lookup — and a lookup that misses is the ordinary
 * case, not an edge one: the target may have been deleted, or may be in a team this person
 * has since left. A row with a blank name that navigates nowhere is worse than one fewer row.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AppShell } from './AppShell';
import { EngineProvider } from './context';
import { KeymapProvider } from './keymap';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const OTHER = '01900000-0000-7000-8000-000000000003';
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

/**
 * The role the sidebar is asked to gate on, settable per test.
 *
 * It has to be settable, because the Settings nav is now three answers rather than two and
 * a fixture pinned to one role can only ever prove one of them. It also has to come from
 * here rather than from the replica: `useViewer` reads `store.users`, a guest's replica has
 * no `user` rows, and gating on it is the bug this suite exists downstream of.
 */
let viewerRole: 'owner' | 'admin' | 'member' | 'guest' | null = 'admin';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
  // The role comes from the session query rather than the replica, so it is answered here
  // even though `useViewer` is not: the sidebar's role gates read this one.
  useViewerRole: () => viewerRole,
}));

beforeEach(() => {
  viewerRole = 'admin';
});

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
      },
    ] as [string, Entity],
    [
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
      },
    ] as [string, Entity],
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

function view(id: string, name: string, ownerId?: string, position = 'V'): [string, Entity] {
  return [
    'view',
    {
      id,
      workspaceId: WORKSPACE,
      name,
      ...(ownerId === undefined ? null : { ownerId }),
      filter: { conj: 'and', nodes: [] },
      display: {},
      position,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity,
  ];
}

function favorite(id: string, kind: string, targetId: string, position = 'V'): [string, Entity] {
  return [
    'favorite',
    {
      id,
      workspaceId: WORKSPACE,
      userId: VIEWER,
      kind,
      targetId,
      position,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity,
  ];
}

function renderShell(store: Store) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AppShell>
            <div />
          </AppShell>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('the saved views in the sidebar', () => {
  it('shows a shared view and the viewer’s own private one', () => {
    renderShell(seeded([view('v-shared', 'All bugs'), view('v-mine', 'My triage', VIEWER)]));
    expect(screen.getByRole('link', { name: 'All bugs' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My triage' })).toBeTruthy();
  });

  it('does not show somebody else’s private view', () => {
    renderShell(seeded([view('v-theirs', 'Their triage', OTHER)]));
    // The replica may well hold it — the stream is scoped by team, not by view ownership —
    // so this is the client's decision and not the server's.
    expect(screen.queryByRole('link', { name: 'Their triage' })).toBeNull();
  });

  it('does not show an archived view', () => {
    const archived = view('v-old', 'Last quarter');
    (archived[1] as unknown as Record<string, unknown>)['archivedAt'] = AT;
    renderShell(seeded([archived]));
    expect(screen.queryByRole('link', { name: 'Last quarter' })).toBeNull();
  });

  it('omits the section entirely when there is nothing in it', () => {
    renderShell(seeded());
    expect(screen.queryByRole('heading', { name: 'Views' })).toBeNull();
  });

  /**
   * The sixth view is the one that catches this, and that is not a coincidence.
   *
   * `position` is a base-62 fractional key over `0-9A-Za-z`, stored in a column declared
   * `COLLATE "C"` so Postgres orders it byte by byte. Appending starts at "V" and steps one
   * digit at a time, so a sidebar's keys run V, W, X, Y, Z, a, b … — and 'Z' (0x5a) to 'a'
   * (0x61) is where byte order and *linguistic* order part company. `localeCompare` sorts by
   * letter before case, so it puts "a" first and the newest view jumps to the top of a
   * sidebar the server ordered last.
   *
   * Five views sort identically under both rules. That is why every fixture in this file, and
   * every workspace CI has ever built, missed it: the bug needs a workspace somebody has been
   * using, and appears on the sixth saved view and never goes away.
   */
  it('renders views in the server\u2019s byte order across the case boundary', () => {
    renderShell(
      seeded([
        view('v-1', 'First', undefined, 'V'),
        view('v-2', 'Second', undefined, 'W'),
        view('v-3', 'Third', undefined, 'X'),
        view('v-4', 'Fourth', undefined, 'Y'),
        view('v-5', 'Fifth', undefined, 'Z'),
        view('v-6', 'Sixth', undefined, 'a'),
      ]),
    );
    const names = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
    const rendered = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => names.includes(text));
    expect(rendered).toEqual(names);
  });
});

describe('the favourites in the sidebar', () => {
  it('names a favourited view and links to it', () => {
    renderShell(seeded([view('v-1', 'All bugs'), favorite('f-1', 'view', 'v-1')]));
    const link = screen.getByRole('link', { name: 'All bugs' });
    expect(link.getAttribute('href')).toBe('/view/v-1');
  });

  it('drops a favourite whose target is not in the replica rather than rendering a blank row', () => {
    renderShell(seeded([favorite('f-2', 'view', 'v-missing')]));
    // The section disappears with its only row. A sidebar entry with no name that navigates
    // nowhere is worse than one fewer entry, and the server's delta removes the row soon.
    expect(screen.queryByRole('heading', { name: 'Favourites' })).toBeNull();
  });

  it('renders favourites in their stored order rather than insertion order', () => {
    renderShell(
      seeded([
        view('v-a', 'Second', undefined),
        view('v-b', 'First', undefined),
        favorite('f-a', 'view', 'v-a', 'W'),
        favorite('f-b', 'view', 'v-b', 'V'),
      ]),
    );
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text === 'First' || text === 'Second');
    expect(names).toEqual(['First', 'Second']);
  });

  it('orders favourites by byte order too, not by letter then case', () => {
    // The same boundary as the Views section above: 'Z' is byte 0x5a and 'a' is 0x61, so
    // the row the server put last is the row `localeCompare` puts first.
    renderShell(
      seeded([
        view('v-a', 'Later', undefined),
        view('v-b', 'Earlier', undefined),
        favorite('f-a', 'view', 'v-a', 'a'),
        favorite('f-b', 'view', 'v-b', 'Z'),
      ]),
    );
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text === 'Earlier' || text === 'Later');
    expect(names).toEqual(['Earlier', 'Later']);
  });

  it('does not also list a favourited view under Views', () => {
    renderShell(seeded([view('v-1', 'All bugs'), favorite('f-1', 'view', 'v-1')]));
    // Favouriting moves a view rather than duplicating it. Two identical links in one sidebar
    // make somebody check whether they go to the same place.
    expect(screen.getAllByRole('link', { name: 'All bugs' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Views' })).toBeNull();
  });
});

/** Their own account, which every role keeps. */
const OWN_SETTINGS = ['Profile', 'Preferences', 'Notifications', 'Sessions', 'Authorised apps'];

/**
 * Settings a member uses, because the server lets them.
 *
 * `ActionAPIKeyManage` is `!IsGuest`; `exportCap` gives a member 250 issues; restoring from
 * Trash is `CanInTeam(ActionIssueDelete)`, i.e. membership; Labels and Templates each carry
 * a team scope whose action is membership; the Members roster is deliberately readable with
 * its admin controls withheld (#108); and Asks and Deleted teams answer to team ownership,
 * which an ordinary workspace member can hold.
 */
const MEMBER_SETTINGS = [
  'Members',
  'Labels',
  'Templates',
  'API keys',
  'MCP',
  'Asks',
  'Integrations',
  'Export',
  'Trash',
  'Deleted teams',
];

/**
 * Settings where a non-admin may do nothing and see nothing.
 *
 * Either the read itself is refused — `ListWebhooks`, `ListOauthClients`, and the
 * GitHub/GitLab/Sentry/Slack settings queries, which select a webhook secret guarded by
 * `ActionGitHubManage` and its siblings — or every control is an admin action:
 * `ActionWorkspaceUpdate`, `ActionWorkspaceLabelManage`, `ActionProjectStatusManage`.
 */
const ADMIN_SETTINGS = [
  'Workspace',
  'Project labels',
  'Initiative labels',
  'Project statuses',
  'Project updates',
  'Customer requests',
  'SLAs',
  'OAuth apps',
  'Webhooks',
  'GitHub',
  'GitLab',
  'Sentry',
  'Slack',
];

describe('the settings section', () => {
  /** Only this level can prove every screen built for M1 is actually reachable. */
  it('links to every workspace screen for an admin', () => {
    renderShell(seeded());
    for (const name of [...OWN_SETTINGS, ...MEMBER_SETTINGS, ...ADMIN_SETTINGS]) {
      expect(screen.getByRole('link', { name }), `${name} is not reachable`).toBeTruthy();
    }
    for (const name of ['My Issues', 'Inbox', 'Drafts', 'Search']) {
      expect(screen.getByRole('link', { name }), `${name} is not reachable`).toBeTruthy();
    }
    expect(
      screen.getAllByRole('link', { name: 'Pulse' }).length,
      'Pulse feed and Pulse settings',
    ).toBe(2);
  });

  /**
   * A member is not an administrator.
   *
   * `showAdminSettings` was assigned `notGuest`, so this whole list was in a member's
   * sidebar — and behind each entry was a page the server refuses, most visibly
   * `/settings/oauth-apps`, which answered "OAuth applications could not be fetched. Only
   * admins can read them." underneath a New OAuth app button. The role table in
   * `docs/01-features/17-admin-security-permissions.md` gives Member "no workspace
   * administration pages".
   */
  it('withholds the administration screens from a member', () => {
    viewerRole = 'member';
    renderShell(seeded());
    for (const name of ADMIN_SETTINGS) {
      expect(
        screen.queryByRole('link', { name }),
        `the sidebar offered a member ${name}`,
      ).toBeNull();
    }
    // Only the feed, not the settings page behind it.
    expect(screen.getAllByRole('link', { name: 'Pulse' }).length, 'Pulse settings').toBe(1);
    for (const name of [...OWN_SETTINGS, ...MEMBER_SETTINGS]) {
      expect(screen.getByRole('link', { name }), `${name} went missing for a member`).toBeTruthy();
    }
  });

  /**
   * An unanswered session reads as closed, the way every other display gate here does.
   *
   * The opposite reading is what the three leaks before this one all were: `useViewer()` is
   * null for a guest for the whole session, and `!== 'guest'` took that for "not a guest".
   */
  it('offers no settings beyond the viewer\u2019s own until the role is known', () => {
    viewerRole = null;
    renderShell(seeded());
    for (const name of [...MEMBER_SETTINGS, ...ADMIN_SETTINGS]) {
      expect(screen.queryByRole('link', { name }), `${name} was offered too early`).toBeNull();
    }
    for (const name of OWN_SETTINGS) {
      expect(screen.getByRole('link', { name }), `${name} went missing`).toBeTruthy();
    }
  });

  it('opens a team at its home rather than its issue list', () => {
    renderShell(seeded());
    const team = screen.getByRole('link', { name: /Engineering/ });
    expect(team.getAttribute('href')).toBe('/team/ENG/home');
  });

  it('offers a control to switch workspace', () => {
    renderShell(seeded());
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toBeTruthy();
  });
});

describe('the leftover jump pickers', () => {
  it('exposes hidden triggers for views, documents, and favourites', () => {
    renderShell(seeded());
    expect(screen.getByRole('button', { name: 'Open view' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open document' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open favourite' })).toBeTruthy();
  });

  it('opens the views picker from O V', async () => {
    const user = userEvent.setup();
    renderShell(seeded([view('v-1', 'All bugs')]));
    await user.keyboard('ov');
    expect(screen.getByRole('menu', { name: 'Views' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'All bugs' })).toBeTruthy();
  });
});
