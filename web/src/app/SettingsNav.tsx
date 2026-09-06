/**
 * The settings navigation.
 *
 * Twenty-eight of these links used to sit at the bottom of the workspace sidebar under a
 * heading that read "Workspace" — which five of them were not, being an account rather than
 * a workspace — pinned below a spacer so they were always rendered and always past the fold.
 * They are the least-used rows in the product and they were the largest block in the most-
 * used navigation.
 *
 * So settings became a mode. `AppShell` swaps to this nav on any `/settings` path, the
 * routes are untouched, and the rows are grouped by the question each one answers:
 *
 *   Personal        what this is for me, everywhere        — every role has all of it
 *   Issues          how issues are described and promised
 *   Projects        how projects and initiatives are described
 *   Features        which parts of the product are on, and what else it talks to
 *   Administration  who is in this workspace, what it costs, what leaves it
 *
 * The grouping is the disambiguation, too. "Pulse" names both a feed and a settings page and
 * the sidebar used to draw both words at once, one above the other; the two navigations never
 * render together, so the collision is gone without renaming a screen. `/settings/workspace`
 * is "General" here for the same reason — a "Workspace" row inside an Administration group
 * about the workspace reads as a mistake.
 *
 * Thirty rows is more than anyone scans, which is why there is a search box before them. It
 * filters the rows as you type and hides a group whose rows all went; it does not navigate,
 * because the arrow keys and Enter already do that through the links it leaves behind.
 *
 * The gating props come from `AppShell` rather than from `useViewerRole()` here, so both
 * navigations answer to one reading of the role. Both read an unanswered session as closed;
 * see the note on `showMemberSettings` there.
 */

import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';

import { Input } from '~/components';

import { NavGlyph, WorkspaceMark, navClass, navStyles, type NavGlyphName } from './nav';
import styles from './SettingsNav.module.css';

export interface SettingsNavProps {
  showMemberSettings: boolean;
  showAdminSettings: boolean;
  /** The workspace being edited, drawn read-only. See the identity row below. */
  workspaceName: string;
  workspaceLogoUrl?: string | undefined;
  /**
   * The sync badge, and the control that collapses the sidebar.
   *
   * Both are the shell's, rendered by the shell and handed down, because both belong to the
   * application rather than to either navigation. The badge in particular used to be mounted
   * inside the workspace `<nav>`, which meant "Offline", "Reconnecting" and "Syncing 3" were
   * invisible on all thirty-one settings screens — the screens whose saves are single,
   * deliberate writes that are the worst ones to lose quietly.
   */
  status?: ReactNode;
  collapseControl?: ReactNode;
}

type Gate = 'all' | 'member' | 'admin';

interface SettingsLink {
  to: string;
  label: string;
  glyph: NavGlyphName;
  gate: Gate;
}

interface SettingsGroup {
  title: string;
  links: readonly SettingsLink[];
}

const GROUPS: readonly SettingsGroup[] = [
  {
    title: 'Personal',
    links: [
      { to: '/settings/profile', label: 'Profile', glyph: 'members', gate: 'all' },
      { to: '/settings/preferences', label: 'Preferences', glyph: 'prefs', gate: 'all' },
      { to: '/settings/notifications', label: 'Notifications', glyph: 'bell', gate: 'all' },
      { to: '/settings/sessions', label: 'Sessions', glyph: 'key', gate: 'all' },
      { to: '/settings/authorised-apps', label: 'Authorised apps', glyph: 'apps', gate: 'all' },
      // Personal keys, minted by and for this account; they are here rather than beside the
      // workspace's OAuth apps and webhooks because revoking one affects only its owner.
      { to: '/settings/api-keys', label: 'API keys', glyph: 'key', gate: 'member' },
    ],
  },
  {
    title: 'Issues',
    links: [
      { to: '/settings/labels', label: 'Labels', glyph: 'labels', gate: 'member' },
      { to: '/settings/templates', label: 'Templates', glyph: 'template', gate: 'member' },
      { to: '/settings/slas', label: 'SLAs', glyph: 'cycle', gate: 'admin' },
    ],
  },
  {
    title: 'Projects',
    links: [
      { to: '/settings/project-labels', label: 'Project labels', glyph: 'labels', gate: 'admin' },
      {
        to: '/settings/project-statuses',
        label: 'Project statuses',
        glyph: 'project',
        gate: 'admin',
      },
      { to: '/settings/project-updates', label: 'Project updates', glyph: 'pulse', gate: 'admin' },
      {
        to: '/settings/initiative-labels',
        label: 'Initiative labels',
        glyph: 'initiative',
        gate: 'admin',
      },
    ],
  },
  {
    title: 'Features',
    links: [
      { to: '/settings/pulse', label: 'Pulse', glyph: 'pulse', gate: 'admin' },
      { to: '/settings/asks', label: 'Asks', glyph: 'inbox', gate: 'member' },
      { to: '/settings/customers', label: 'Customer requests', glyph: 'customer', gate: 'admin' },
      { to: '/settings/integrations', label: 'Integrations', glyph: 'apps', gate: 'member' },
      { to: '/settings/github', label: 'GitHub', glyph: 'github', gate: 'admin' },
      { to: '/settings/gitlab', label: 'GitLab', glyph: 'gitlab', gate: 'admin' },
      { to: '/settings/sentry', label: 'Sentry', glyph: 'sentry', gate: 'admin' },
      { to: '/settings/slack', label: 'Slack', glyph: 'slack', gate: 'admin' },
      { to: '/settings/mcp', label: 'MCP', glyph: 'dashboard', gate: 'member' },
    ],
  },
  {
    title: 'Administration',
    links: [
      { to: '/settings/workspace', label: 'General', glyph: 'dashboard', gate: 'admin' },
      { to: '/settings/members', label: 'Members', glyph: 'members', gate: 'member' },
      // Live teams. "Deleted teams" was listed here long before the teams themselves were,
      // which meant the settings nav could restore a team it offered no way to create.
      { to: '/settings/teams', label: 'Teams', glyph: 'members', gate: 'member' },
      { to: '/settings/billing', label: 'Billing', glyph: 'key', gate: 'admin' },
      { to: '/settings/webhooks', label: 'Webhooks', glyph: 'webhook', gate: 'admin' },
      { to: '/settings/oauth-apps', label: 'OAuth apps', glyph: 'apps', gate: 'admin' },
      // Visible to every admin, including on plans that do not include it: the screen
      // itself explains the gate. Filtering the link on the entitlement would hide the
      // feature's existence, which is the opposite of "disabled with a reason, never
      // hidden".
      { to: '/settings/audit-log', label: 'Audit log', glyph: 'view', gate: 'admin' },
      { to: '/settings/export', label: 'Export', glyph: 'export', gate: 'member' },
      { to: '/settings/trash', label: 'Trash', glyph: 'trash', gate: 'member' },
      { to: '/settings/deleted-teams', label: 'Deleted teams', glyph: 'trash', gate: 'member' },
    ],
  },
];

/** Every route the nav knows, gate aside. Exported for the test that checks nothing was lost. */
export const SETTINGS_ROUTES: readonly string[] = GROUPS.flatMap((group) =>
  group.links.map((link) => link.to),
);

export function SettingsNav({
  showMemberSettings,
  showAdminSettings,
  workspaceName,
  workspaceLogoUrl,
  status,
  collapseControl,
}: SettingsNavProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const allowed = (gate: Gate) =>
    gate === 'all' || (gate === 'member' ? showMemberSettings : showAdminSettings);
  const matches = (link: SettingsLink) =>
    needle === '' || link.label.toLowerCase().includes(needle);

  const groups = GROUPS.map((group) => ({
    title: group.title,
    links: group.links.filter((link) => allowed(link.gate) && matches(link)),
    // A heading over nothing reads as a section that failed to load. A guest sees only
    // Personal, and should see only Personal; a search that empties a group empties it.
  })).filter((group) => group.links.length > 0);

  return (
    <nav className={`${navStyles.sidebar} ${styles.sidebar}`} aria-label="Settings">
      {/*
        The way out, first and on its own.

        A mode you cannot see the edge of is a trap, and a settings sidebar that looks like
        the workspace sidebar is exactly the kind of thing somebody scrolls looking for
        Inbox. `/` goes through `HomeRedirect`, so it lands wherever `prefs.homeView` says
        rather than on a route this component picked.

        The shell's badge and collapse control share the row: they are the application's,
        not the mode's, and the top edge is where the other sidebar keeps them.
      */}
      <div className={styles.top}>
        <NavLink to="/" className={styles.back} end>
          <NavGlyph name="back" />
          <span className={navStyles.navLabel}>Back to app</span>
        </NavLink>
        {status}
        {collapseControl}
      </div>

      <div className={styles.search}>
        <Input
          type="search"
          label="Search settings"
          hideLabel
          placeholder="Search…"
          autoComplete="off"
          spellCheck={false}
          prefix={<NavGlyph name="search" />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {groups.length === 0 ? (
        <p className={styles.empty} role="status">
          No settings match “{query.trim()}”
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.title} className={navStyles.section}>
            <h2 className={navStyles.sectionTitle}>{group.title}</h2>
            {group.links.map((link) => (
              <NavLink key={link.to} to={link.to} className={navClass}>
                <NavGlyph name={link.glyph} />
                <span className={navStyles.navLabel}>{link.label}</span>
              </NavLink>
            ))}
          </div>
        ))
      )}

      <div className={navStyles.spacer} />

      {/*
        Which workspace this is.

        Entering settings used to unwind the workspace entirely: the mark, the name and the
        switcher all vanished, so nothing on a page editing labels, members or billing said
        *whose* labels, members or billing. That is a bad question to have to answer by
        reading the URL, and a worse one to guess at with two workspaces open in two tabs.

        Read-only, and deliberately not the menu the workspace nav draws. Switching workspace
        from inside a settings screen would leave the person on the same path in a different
        workspace, looking at a form they had half-filled for the other one. The way out is
        the row at the top.
      */}
      <div className={styles.identity}>
        <WorkspaceMark name={workspaceName} logoUrl={workspaceLogoUrl} />
        <span className={styles.identityName}>{workspaceName}</span>
      </div>
    </nav>
  );
}
