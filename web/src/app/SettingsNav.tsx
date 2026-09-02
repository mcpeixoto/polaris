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
 *   Account       what this is for me, everywhere       — every role has all of it
 *   Workspace     what this workspace is and contains
 *   Features      which parts of the product are on
 *   Integrations  what else it talks to
 *   Data          what leaves or comes back
 *
 * The grouping is the disambiguation, too. "Pulse" names both a feed and a settings page and
 * the sidebar used to draw both words at once, one above the other; the two navigations never
 * render together, so the collision is gone without renaming a screen. `/settings/workspace`
 * is "General" here for the same reason — a "Workspace" row inside a Workspace group reads as
 * a mistake.
 *
 * The gating props come from `AppShell` rather than from `useViewerRole()` here, so both
 * navigations answer to one reading of the role. Both read an unanswered session as closed;
 * see the note on `showMemberSettings` there.
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

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
    title: 'Account',
    links: [
      { to: '/settings/profile', label: 'Profile', glyph: 'members', gate: 'all' },
      { to: '/settings/preferences', label: 'Preferences', glyph: 'prefs', gate: 'all' },
      { to: '/settings/notifications', label: 'Notifications', glyph: 'bell', gate: 'all' },
      { to: '/settings/sessions', label: 'Sessions', glyph: 'key', gate: 'all' },
      { to: '/settings/authorised-apps', label: 'Authorised apps', glyph: 'apps', gate: 'all' },
    ],
  },
  {
    title: 'Workspace',
    links: [
      { to: '/settings/workspace', label: 'General', glyph: 'apps', gate: 'admin' },
      { to: '/settings/billing', label: 'Billing', glyph: 'key', gate: 'admin' },
      { to: '/settings/members', label: 'Members', glyph: 'members', gate: 'member' },
      // Live teams. "Deleted teams" was listed here long before the teams themselves were,
      // which meant the settings nav could restore a team it offered no way to create.
      { to: '/settings/teams', label: 'Teams', glyph: 'members', gate: 'member' },
      { to: '/settings/labels', label: 'Labels', glyph: 'labels', gate: 'member' },
      { to: '/settings/project-labels', label: 'Project labels', glyph: 'labels', gate: 'admin' },
      {
        to: '/settings/initiative-labels',
        label: 'Initiative labels',
        glyph: 'labels',
        gate: 'admin',
      },
      {
        to: '/settings/project-statuses',
        label: 'Project statuses',
        glyph: 'project',
        gate: 'admin',
      },
      { to: '/settings/templates', label: 'Templates', glyph: 'template', gate: 'member' },
      { to: '/settings/slas', label: 'SLAs', glyph: 'bell', gate: 'admin' },
      // Visible to every admin, including on plans that do not include it: the screen
      // itself explains the gate. Filtering the link on the entitlement would hide the
      // feature's existence, which is the opposite of "disabled with a reason, never
      // hidden".
      { to: '/settings/audit-log', label: 'Audit log', glyph: 'key', gate: 'admin' },
    ],
  },
  {
    title: 'Features',
    links: [
      { to: '/settings/pulse', label: 'Pulse', glyph: 'pulse', gate: 'admin' },
      { to: '/settings/project-updates', label: 'Project updates', glyph: 'bell', gate: 'admin' },
      { to: '/settings/customers', label: 'Customer requests', glyph: 'customer', gate: 'admin' },
      { to: '/settings/asks', label: 'Asks', glyph: 'template', gate: 'member' },
    ],
  },
  {
    title: 'Integrations',
    links: [
      { to: '/settings/integrations', label: 'Integrations', glyph: 'apps', gate: 'member' },
      { to: '/settings/github', label: 'GitHub', glyph: 'github', gate: 'admin' },
      { to: '/settings/gitlab', label: 'GitLab', glyph: 'gitlab', gate: 'admin' },
      { to: '/settings/sentry', label: 'Sentry', glyph: 'sentry', gate: 'admin' },
      { to: '/settings/slack', label: 'Slack', glyph: 'slack', gate: 'admin' },
      { to: '/settings/webhooks', label: 'Webhooks', glyph: 'webhook', gate: 'admin' },
      { to: '/settings/api-keys', label: 'API keys', glyph: 'key', gate: 'member' },
      { to: '/settings/oauth-apps', label: 'OAuth apps', glyph: 'apps', gate: 'admin' },
      { to: '/settings/mcp', label: 'MCP', glyph: 'apps', gate: 'member' },
    ],
  },
  {
    title: 'Data',
    links: [
      { to: '/settings/export', label: 'Export', glyph: 'export', gate: 'member' },
      { to: '/settings/trash', label: 'Trash', glyph: 'trash', gate: 'member' },
      { to: '/settings/deleted-teams', label: 'Deleted teams', glyph: 'trash', gate: 'member' },
    ],
  },
];

export function SettingsNav({
  showMemberSettings,
  showAdminSettings,
  workspaceName,
  workspaceLogoUrl,
  status,
  collapseControl,
}: SettingsNavProps) {
  const allowed = (gate: Gate) =>
    gate === 'all' || (gate === 'member' ? showMemberSettings : showAdminSettings);

  return (
    <nav className={navStyles.sidebar} aria-label="Settings">
      {/*
        Which workspace this is, before anything about it can be changed.

        Entering settings used to unwind the workspace entirely: the mark, the name and the
        switcher all vanished, so nothing on a page editing labels, members or billing said
        *whose* labels, members or billing. That is a bad question to have to answer by
        reading the URL, and a worse one to guess at with two workspaces open in two tabs.

        Read-only, and deliberately not the menu the workspace nav draws. Switching workspace
        from inside a settings screen would leave the person on the same path in a different
        workspace, looking at a form they had half-filled for the other one. The way out is
        the row directly below.
      */}
      <div className={styles.identity}>
        <WorkspaceMark name={workspaceName} logoUrl={workspaceLogoUrl} />
        <span className={styles.identityName}>{workspaceName}</span>
        {status}
        {collapseControl}
      </div>

      {/*
        The way out, first and on its own.

        A mode you cannot see the edge of is a trap, and a settings sidebar that looks like
        the workspace sidebar is exactly the kind of thing somebody scrolls looking for
        Inbox. `/` goes through `HomeRedirect`, so it lands wherever `prefs.homeView` says
        rather than on a route this component picked.
      */}
      <div className={navStyles.section}>
        <NavLink to="/" className={navClass} end>
          <NavGlyph name="back" />
          <span className={navStyles.navLabel}>Back to app</span>
        </NavLink>
      </div>

      {/* Not a heading: the screen beside it owns the page's `h1`, and two of those in one
          document is an outline saying the page is about two things. The nav is already named
          "Settings" to a screen reader by its own label; this is that name, drawn. */}
      <div className={styles.title}>Settings</div>

      {GROUPS.map((group) => {
        const links = group.links.filter((link) => allowed(link.gate));
        // A heading over nothing reads as a section that failed to load. A guest sees only
        // Account, and should see only Account.
        if (links.length === 0) return null;
        return (
          <div key={group.title} className={navStyles.section}>
            <h2 className={navStyles.sectionTitle}>{group.title}</h2>
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={navClass}>
                <NavGlyph name={link.glyph} />
                <span className={navStyles.navLabel}>{link.label}</span>
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
