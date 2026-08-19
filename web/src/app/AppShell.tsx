/**
 * The application shell: sidebar, main pane, and the surfaces that float above both.
 *
 * The global actions are registered here because they are the ones that exist regardless
 * of what is on screen — open the command menu, show help, create an issue, navigate.
 * Screen-specific actions register themselves as their screen mounts, so the command menu
 * offers what is actually available rather than a fixed list that fails when chosen.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import { toFilterParam } from '~/filter';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Favorite, Store, UUID, View } from '~/store';

import { useQuery, useSyncStatus } from './context';
import { useActions } from './keymap';
import { CommandMenu } from './CommandMenu';
import { HelpOverlay } from './HelpOverlay';
import styles from './AppShell.module.css';

export interface AppShellProps {
  children: ReactNode;
  /**
   * Renders the create-issue modal.
   *
   * A render prop rather than an import, because the shell owns the *action* ("C" is
   * bound here, globally) while the router owns the *screens*. Importing the modal here
   * would make the shell depend on the views layer, and the views layer already depends
   * on the shell for its context — a cycle that bundlers resolve in whichever order they
   * happen to walk the graph.
   */
  renderCreateIssue?: (props: { onClose: () => void }) => ReactNode;
  /**
   * Same split as create-issue: the action is global (command menu from any screen) and
   * the modal lives with the rest of the project UI. `C` stays create-issue.
   */
  renderCreateProject?: (props: { onClose: () => void }) => ReactNode;
}

export function AppShell({ children, renderCreateIssue, renderCreateProject }: AppShellProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const onProjects =
    pathname === '/projects' ||
    pathname.startsWith('/project/') ||
    /\/team\/[^/]+\/projects(?:\/|$)/.test(pathname);
  const onCycles =
    pathname.startsWith('/cycle/') || /\/team\/[^/]+\/cycles(?:\/|$)/.test(pathname);

  const teams = useQuery(
    (store) => [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );
  const workspace = useQuery((store) => [...store.workspaces.values()][0], ['workspace']);
  const cyclesPath = useQuery((store) => pathToCycles(store), ['team', 'cycle']);
  const triagePath = useQuery((store) => pathToTriage(store), ['team']);
  const archivesPath = useQuery((store) => pathToArchives(store), ['team']);

  const viewerId = useViewerId();
  const favorites = useLiveQuery(
    (store) => (viewerId === null ? [] : favoriteLinks(store, viewerId)),
    ['favorite', 'view', 'team', 'issue', 'label'],
    [viewerId],
  );
  const views = useLiveQuery(
    (store) => (viewerId === null ? [] : visibleViews(store, viewerId)),
    ['view', 'favorite'],
    [viewerId],
  );

  const closeAll = useCallback(() => {
    setCommandOpen(false);
    setHelpOpen(false);
    setCreateOpen(false);
    setCreateProjectOpen(false);
  }, []);

  useActions(
    [
      {
        id: 'app.commandMenu',
        title: 'Open command menu',
        keys: ['mod+k'],
        group: 'General',
        run: () => setCommandOpen(true),
      },
      {
        id: 'app.help',
        title: 'Keyboard shortcuts',
        keys: ['?'],
        group: 'General',
        run: () => setHelpOpen(true),
      },
      {
        id: 'app.dismiss',
        title: 'Dismiss',
        keys: ['Escape'],
        group: 'General',
        // Hidden: Escape is discoverable by trying it, and an entry reading "Dismiss" in
        // a searchable command list is noise rather than help.
        hidden: true,
        run: closeAll,
      },
      {
        id: 'issue.create',
        title: 'Create issue',
        keys: ['c'],
        group: 'Issues',
        run: () => setCreateOpen(true),
      },
      {
        id: 'project.create',
        title: 'Create project',
        group: 'Projects',
        run: () => setCreateProjectOpen(true),
      },
      {
        id: 'nav.myIssues',
        title: 'Go to My Issues',
        keys: ['g m'],
        group: 'Navigation',
        run: () => navigate('/my-issues'),
      },
      {
        id: 'nav.inbox',
        title: 'Go to Inbox',
        keys: ['g i'],
        group: 'Navigation',
        run: () => navigate('/inbox'),
      },
      {
        id: 'nav.settings',
        title: 'Go to workspace settings',
        keys: ['g s'],
        group: 'Navigation',
        run: () => navigate('/settings/members'),
      },
      {
        id: 'nav.search',
        title: 'Search',
        // Global, and the search screen binds the same key in `list` to focus its own box.
        // That is not a conflict — a context binding shadows the global one — and it is the
        // behaviour people expect from this key: press it anywhere to get to search, press
        // it there to get back to the box.
        keys: ['/'],
        group: 'Navigation',
        run: () => navigate('/search'),
      },
      {
        id: 'nav.projects',
        title: 'Go to Projects',
        keys: ['g p'],
        group: 'Navigation',
        run: () => navigate('/projects'),
      },
      {
        id: 'nav.cycles',
        title: 'Go to current cycle',
        keys: ['g c'],
        group: 'Navigation',
        run: () => navigate(cyclesPath),
      },
      {
        id: 'nav.triage',
        title: 'Go to Triage',
        keys: ['g t'],
        group: 'Navigation',
        run: () => navigate(triagePath),
      },
      {
        id: 'nav.archives',
        title: 'Go to archives',
        keys: ['g x'],
        group: 'Navigation',
        run: () => navigate(archivesPath),
      },
      {
        id: 'nav.trash',
        title: 'Go to trash',
        group: 'Navigation',
        run: () => navigate('/settings/trash'),
      },
    ],
    [navigate, closeAll, cyclesPath, triagePath, archivesPath],
  );

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Workspace">
        <div className={styles.workspace}>
          <span className={styles.workspaceMark} aria-hidden="true">
            {(workspace?.name ?? 'P').slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.workspaceName}>{workspace?.name ?? 'Polaris'}</span>
          <ConnectionIndicator />
        </div>

        <div className={styles.section}>
          <NavLink to="/my-issues" className={navClass}>
            <NavGlyph name="issues" />
            <span className={styles.navLabel}>My Issues</span>
          </NavLink>
          <NavLink to="/inbox" className={navClass}>
            <NavGlyph name="inbox" />
            <span className={styles.navLabel}>Inbox</span>
          </NavLink>
          <NavLink to="/search" className={navClass}>
            <NavGlyph name="search" />
            <span className={styles.navLabel}>Search</span>
          </NavLink>
          <NavLink to="/projects" className={() => navClass({ isActive: onProjects })}>
            <NavGlyph name="project" />
            <span className={styles.navLabel}>Projects</span>
          </NavLink>
          <NavLink to={cyclesPath} className={() => navClass({ isActive: onCycles })}>
            <NavGlyph name="cycle" />
            <span className={styles.navLabel}>Cycles</span>
          </NavLink>
        </div>

        {favorites.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Favourites</h2>
            {favorites.map((favorite) => (
              <NavLink key={favorite.id} to={favorite.to} className={navClass}>
                {favorite.prefix !== null && (
                  <span className={styles.teamKey}>{favorite.prefix}</span>
                )}
                <span className={styles.navLabel}>{favorite.label}</span>
              </NavLink>
            ))}
          </div>
        )}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Teams</h2>
          {teams.map((team) => (
            <NavLink key={team.id} to={`/team/${team.key}`} className={navClass}>
              <span className={styles.teamKey}>{team.key}</span>
              <span className={styles.navLabel}>{team.name}</span>
            </NavLink>
          ))}
        </div>

        {views.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Views</h2>
            {views.map((view) => (
              <NavLink key={view.id} to={viewPath(view)} className={navClass}>
                <NavGlyph name="view" />
                <span className={styles.navLabel}>{view.name}</span>
              </NavLink>
            ))}
          </div>
        )}

        <div className={styles.spacer} />

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Workspace</h2>
          <NavLink to="/settings/members" className={navClass}>
            <NavGlyph name="members" />
            <span className={styles.navLabel}>Members</span>
          </NavLink>
          <NavLink to="/settings/labels" className={navClass}>
            <NavGlyph name="labels" />
            <span className={styles.navLabel}>Labels</span>
          </NavLink>
          <NavLink to="/settings/notifications" className={navClass}>
            <NavGlyph name="bell" />
            <span className={styles.navLabel}>Notifications</span>
          </NavLink>
          <NavLink to="/settings/templates" className={navClass}>
            <NavGlyph name="template" />
            <span className={styles.navLabel}>Templates</span>
          </NavLink>
          <NavLink to="/settings/api-keys" className={navClass}>
            <NavGlyph name="key" />
            <span className={styles.navLabel}>API keys</span>
          </NavLink>
          <NavLink to="/settings/webhooks" className={navClass}>
            <NavGlyph name="webhook" />
            <span className={styles.navLabel}>Webhooks</span>
          </NavLink>
          <NavLink to="/settings/trash" className={navClass}>
            <NavGlyph name="trash" />
            <span className={styles.navLabel}>Trash</span>
          </NavLink>
        </div>
      </nav>

      <main className={styles.main}>{children}</main>

      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      {createOpen && renderCreateIssue?.({ onClose: () => setCreateOpen(false) })}
      {createProjectOpen && renderCreateProject?.({ onClose: () => setCreateProjectOpen(false) })}
    </div>
  );
}

// CSS-module lookups are `string | undefined` under noUncheckedIndexedAccess, so classes
// are composed by filtering rather than by interpolation — a missing class should drop
// out, not render the literal "undefined" into the DOM.
function navClass({ isActive }: { isActive: boolean }): string {
  return [styles.navItem, isActive ? styles.navItemActive : null].filter(Boolean).join(' ');
}

type NavGlyphName =
  | 'issues'
  | 'inbox'
  | 'search'
  | 'project'
  | 'cycle'
  | 'view'
  | 'members'
  | 'labels'
  | 'bell'
  | 'template'
  | 'key'
  | 'webhook'
  | 'trash';

function NavGlyph({ name }: { name: NavGlyphName }) {
  return (
    <svg
      className={styles.navIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {glyphPath(name)}
    </svg>
  );
}

function glyphPath(name: NavGlyphName) {
  const stroke = {
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'issues':
      return (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...stroke} />
          <path d="M5 8h6M5 10.5h3.5" {...stroke} />
        </>
      );
    case 'inbox':
      return (
        <>
          <path d="M2.5 8.5 4.2 3.8A1.5 1.5 0 0 1 5.6 3h4.8a1.5 1.5 0 0 1 1.4.8L13.5 8.5" {...stroke} />
          <path d="M2.5 8.5h2.6l.8 1.8h4.2l.8-1.8h2.6V12a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2.5 12V8.5Z" {...stroke} />
        </>
      );
      case 'search':
        return (
          <>
            <circle cx="7" cy="7" r="3.75" {...stroke} />
            <path d="m10.2 10.2 3 3" {...stroke} />
          </>
        );
      case 'project':
        return (
          <>
            <path d="M8 2.5 13.5 6v4L8 13.5 2.5 10V6L8 2.5Z" {...stroke} />
            <path d="M8 8v5.5M2.5 6 8 8l5.5-2" {...stroke} />
          </>
        );
      case 'cycle':
        return (
          <>
            <circle cx="8" cy="8" r="5.25" {...stroke} />
            <path d="M8 5.25V8l2 1.5" {...stroke} />
          </>
        );
    case 'view':
      return (
        <>
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" {...stroke} />
        </>
      );
    case 'members':
      return (
        <>
          <circle cx="6" cy="5.5" r="2" {...stroke} />
          <path d="M3 12.5c.2-2 1.6-3 3-3s2.8 1 3 3" {...stroke} />
          <circle cx="11" cy="6" r="1.5" {...stroke} />
          <path d="M10.2 12.5c.15-1.4 1-2.2 2-2.2" {...stroke} />
        </>
      );
    case 'labels':
      return (
        <>
          <path d="M2.5 8.2 8.2 2.5h4.3A1 1 0 0 1 13.5 3.5v4.3L7.8 13.5a1 1 0 0 1-1.4 0L2.5 9.6a1 1 0 0 1 0-1.4Z" {...stroke} />
          <circle cx="10.2" cy="5.8" r="0.9" fill="currentColor" />
        </>
      );
    case 'bell':
      return (
        <>
          <path d="M4 10.5V8a4 4 0 0 1 8 0v2.5l1 1.5H3l1-1.5Z" {...stroke} />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" {...stroke} />
        </>
      );
    case 'template':
      return (
        <>
          <rect x="3" y="2.5" width="10" height="11" rx="1.5" {...stroke} />
          <path d="M6 6h4M6 8.5h4M6 11h2" {...stroke} />
        </>
      );
    case 'key':
      return (
        <>
          <circle cx="6" cy="8" r="2.5" {...stroke} />
          <path d="M8.2 8H14v2.2M11.5 8v2.2" {...stroke} />
        </>
      );
    case 'webhook':
      return (
        <>
          <circle cx="4.5" cy="8" r="2" {...stroke} />
          <path d="M6.5 8h3" {...stroke} />
          <path d="M9.5 5.5 12 8l-2.5 2.5" {...stroke} />
        </>
      );
    case 'trash':
      return (
        <>
          <path d="M3.5 5h9M6 5V3.5h4V5M5 5l.6 7.2A1 1 0 0 0 6.6 13h2.8a1 1 0 0 0 1-.8L11 5" {...stroke} />
        </>
      );
  }
}

/**
 * Where `G C` should land: the current cycle of the first team that runs them, else that
 * team's cycles page, else the first team's cycles page. Cycles are team-scoped; there is
 * no workspace-wide list to invent.
 */
function pathToCycles(store: Store): string {
  const now = Date.now();
  const teams = [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key));
  const withCadence = teams.find((team) => team.cyclesEnabled) ?? teams[0];
  if (withCadence === undefined) return '/';

  if (withCadence.cyclesEnabled) {
    for (const id of store.cycleIdsFor(withCadence.id)) {
      const cycle = store.cycles.get(id);
      if (cycle === undefined || cycle.archivedAt !== undefined) continue;
      const start = Date.parse(cycle.startsAt);
      const end = Date.parse(cycle.endsAt);
      if (start <= now && now < end) return `/cycle/${cycle.id}`;
    }
  }
  return `/team/${withCadence.key}/cycles`;
}

/**
 * Where `G T` should land: the first team that runs triage, else the first team's inbox
 * page — which then teaches how to turn it on.
 */
function pathToTriage(store: Store): string {
  const teams = [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key));
  const withTriage = teams.find((team) => team.triageEnabled) ?? teams[0];
  if (withTriage === undefined) return '/';
  return `/team/${withTriage.key}/triage`;
}

/**
 * Where `G X` should land: the first team, because archives is per-team and there is no
 * workspace-wide pile.
 */
function pathToArchives(store: Store): string {
  const teams = [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key));
  const first = teams[0];
  if (first === undefined) return '/';
  return `/team/${first.key}/archives`;
}

/**
 * Where a saved view lives.
 *
 * Its own route rather than a team's list with a query string, because a view is a thing
 * somebody named and can be shared as itself — and because a workspace-scoped view spans
 * every team and so has no team list to hang off. `SavedView` seeds the URL from the saved
 * filter on arrival, which is what keeps "the URL is the state" true for these too.
 */
function viewPath(view: View): string {
  return `/view/${view.id}`;
}

interface FavoriteLink {
  readonly id: UUID;
  readonly to: string;
  readonly label: string;
  /** The team key, for an issue or a team. Null for anything without one. */
  readonly prefix: string | null;
}

/**
 * The viewer's favourites, resolved to links.
 *
 * A favourite whose target is not in the replica is dropped rather than rendered as a row
 * with a blank name: the entity may have been deleted, or may be in a team this person has
 * since left, and either way a sidebar entry that goes nowhere is worse than one fewer entry.
 * The server's own delta removes the row soon enough.
 */
function favoriteLinks(store: Store, userId: UUID): readonly FavoriteLink[] {
  const links: FavoriteLink[] = [];

  const ordered = [...store.favorites.values()]
    .filter((favorite) => favorite.userId === userId)
    .sort((a, b) => a.position.localeCompare(b.position));

  for (const favorite of ordered) {
    const link = favoriteLink(store, favorite);
    if (link !== null) links.push(link);
  }
  return links;
}

function favoriteLink(store: Store, favorite: Favorite): FavoriteLink | null {
  switch (favorite.kind) {
    case 'view': {
      const view = store.get('view', favorite.targetId);
      return view === undefined
        ? null
        : { id: favorite.id, to: viewPath(view), label: view.name, prefix: null };
    }
    case 'team': {
      const team = store.get('team', favorite.targetId);
      return team === undefined
        ? null
        : { id: favorite.id, to: `/team/${team.key}`, label: team.name, prefix: team.key };
    }
    case 'issue': {
      const issue = store.get('issue', favorite.targetId);
      if (issue === undefined) return null;
      const identifier = store.identifierOf(issue);
      return {
        id: favorite.id,
        to: `/issue/${identifier}`,
        label: issue.title,
        prefix: identifier,
      };
    }
    case 'label': {
      const label = store.get('label', favorite.targetId);
      if (label === undefined) return null;
      // A favourited label is a filter, not a screen, so it links to the one place that can
      // render "every issue carrying this label" across teams.
      const filter = toFilterParam({
        conj: 'and',
        nodes: [{ field: 'label', op: 'in', values: [label.id] }],
      });
      return {
        id: favorite.id,
        to: `/search?filter=${encodeURIComponent(filter)}`,
        label: label.name,
        prefix: null,
      };
    }
  }
}

/**
 * The saved views this person can see, in the order they are displayed.
 *
 * Shared views in scope plus their own private ones — the same rule the server's `views`
 * query applies, restated here because the replica holds whatever the stream delivered and a
 * sidebar must not show a view somebody else made private. Archived views are excluded.
 *
 * A view the person has favourited is left out, because it is already above under Favourites.
 * Listing it twice is not redundancy the reader can ignore: two identical links in one
 * sidebar make somebody check whether they go to the same place, and favouriting something
 * should move it rather than duplicate it.
 */
function visibleViews(store: Store, userId: UUID): readonly View[] {
  const favourited = new Set<UUID>();
  for (const favorite of store.favorites.values()) {
    if (favorite.userId === userId && favorite.kind === 'view') favourited.add(favorite.targetId);
  }

  return [...store.views.values()]
    .filter(
      (view) =>
        view.archivedAt === undefined &&
        !favourited.has(view.id) &&
        (view.ownerId === undefined || view.ownerId === userId),
    )
    .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
}

/**
 * The sync indicator.
 *
 * It shows the count of unsent mutations rather than a generic "offline" badge, because
 * the question a user actually has when their network wobbles is "did my work save?" —
 * and "3 unsent" answers it while a grey cloud icon does not.
 *
 * It is a live region. The whole point of this indicator is to answer a question the user
 * has at a moment when something has gone wrong, and a status that only exists visually
 * answers it for some people and not others — a screen-reader user has no way to discover
 * that their last three edits are sitting in a queue.
 *
 * It is a *named* live region, and the name is fixed. There are two `role="status"` regions
 * in the shell — the undo toast is the other, mounted empty and permanently so that an
 * announcement inserted into it is actually announced — so "the status region" identifies
 * neither of them on its own. Naming it from its own text would not help: the text is the
 * value, reading "Reconnecting" one moment and "Syncing 3" the next, so a name taken from it
 * stops matching exactly when somebody wants to look at it. The label says which region this
 * is; the contents say what it currently reports.
 */
function ConnectionIndicator() {
  const status = useSyncStatus();
  // `polite`, not `assertive`: reconnecting is worth knowing and not worth interrupting
  // whatever the user is reading to say.
  const live = {
    role: 'status' as const,
    'aria-live': 'polite' as const,
    'aria-label': 'Sync status',
  };

  if (status.phase === 'bootstrapping') {
    return (
      <span {...live} className={styles.status} title="Loading your workspace">
        Loading {status.received > 0 ? `${status.received}` : ''}
      </span>
    );
  }
  if (status.phase === 'failed') {
    return (
      <span
        {...live}
        className={[styles.status, styles.statusError].join(' ')}
        title={status.error}
      >
        Offline
      </span>
    );
  }
  if (status.phase !== 'ready') return null;

  if (status.pending > 0) {
    return (
      <span {...live} className={styles.status} title="Changes waiting to be sent">
        Syncing {status.pending}
      </span>
    );
  }
  if (status.connection !== 'ready') {
    return (
      <span {...live} className={[styles.status, styles.statusWarn].join(' ')} title="Reconnecting">
        Reconnecting
      </span>
    );
  }
  return null;
}
