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
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Teams</h2>
          {teams.map((team) => (
            <NavLink key={team.id} to={`/team/${team.key}`} className={navClass}>
              <span className={styles.teamKey}>{team.key}</span>
              {team.name}
            </NavLink>
          ))}
        </div>

        <div className={styles.spacer} />

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Workspace</h2>
          <NavLink to="/settings/members" className={navClass}>
            Members
          </NavLink>
          <NavLink to="/settings/labels" className={navClass}>
            Labels
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
 */
function ConnectionIndicator() {
  const status = useSyncStatus();
  // `polite`, not `assertive`: reconnecting is worth knowing and not worth interrupting
  // whatever the user is reading to say.
  const live = { role: 'status' as const, 'aria-live': 'polite' as const };

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
