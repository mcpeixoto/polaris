/**
 * The application shell: sidebar, main pane, and the surfaces that float above both.
 *
 * The global actions are registered here because they are the ones that exist regardless
 * of what is on screen — open the command menu, show help, create an issue, navigate.
 * Screen-specific actions register themselves as their screen mounts, so the command menu
 * offers what is actually available rather than a fixed list that fails when chosen.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';

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
}

export function AppShell({ children, renderCreateIssue }: AppShellProps) {
  const navigate = useNavigate();
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const teams = useQuery(
    (store) => [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );
  const workspace = useQuery((store) => [...store.workspaces.values()][0], ['workspace']);

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
        id: 'nav.trash',
        title: 'Go to trash',
        group: 'Navigation',
        run: () => navigate('/settings/trash'),
      },
    ],
    [navigate, closeAll],
  );

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label="Workspace">
        <div className={styles.workspace}>
          <span className={styles.workspaceName}>{workspace?.name ?? 'Polaris'}</span>
          <ConnectionIndicator />
        </div>

        <div className={styles.section}>
          <NavLink to="/my-issues" className={navClass}>
            My Issues
          </NavLink>
          <NavLink to="/inbox" className={navClass}>
            Inbox
          </NavLink>
          <NavLink to="/search" className={navClass}>
            Search
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
                {favorite.label}
              </NavLink>
            ))}
          </div>
        )}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Teams</h2>
          {teams.map((team) => (
            <NavLink key={team.id} to={`/team/${team.key}`} className={navClass}>
              <span className={styles.teamKey}>{team.key}</span>
              {team.name}
            </NavLink>
          ))}
        </div>

        {views.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Views</h2>
            {views.map((view) => (
              <NavLink key={view.id} to={viewPath(view)} className={navClass}>
                {view.name}
              </NavLink>
            ))}
          </div>
        )}

        <div className={styles.spacer} />

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Workspace</h2>
          <NavLink to="/settings/members" className={navClass}>
            Members
          </NavLink>
          <NavLink to="/settings/labels" className={navClass}>
            Labels
          </NavLink>
          <NavLink to="/settings/notifications" className={navClass}>
            Notifications
          </NavLink>
          <NavLink to="/settings/templates" className={navClass}>
            Templates
          </NavLink>
          <NavLink to="/settings/api-keys" className={navClass}>
            API keys
          </NavLink>
          <NavLink to="/settings/trash" className={navClass}>
            Trash
          </NavLink>
        </div>
      </nav>

      <main className={styles.main}>{children}</main>

      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      {createOpen && renderCreateIssue?.({ onClose: () => setCreateOpen(false) })}
    </div>
  );
}

// CSS-module lookups are `string | undefined` under noUncheckedIndexedAccess, so classes
// are composed by filtering rather than by interpolation — a missing class should drop
// out, not render the literal "undefined" into the DOM.
function navClass({ isActive }: { isActive: boolean }): string {
  return [styles.navItem, isActive ? styles.navItemActive : null].filter(Boolean).join(' ');
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
