/**
 * The application shell: sidebar, main pane, and the surfaces that float above both.
 *
 * The global actions are registered here because they are the ones that exist regardless
 * of what is on screen — open the command menu, show help, create an issue, navigate.
 * Screen-specific actions register themselves as their screen mounts, so the command menu
 * offers what is actually available rather than a fixed list that fails when chosen.
 */

import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import { useDesktopNotifications, useUnreadBadge } from '~/features/inbox/desktop';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { usePresence } from '~/hooks/usePresence';
import { useViewerId, useViewerRole } from '~/hooks/useViewer';
import { Menu, type MenuNode } from '~/components';
import { auth } from '~/sync/api';
import { gotoLabelItems, labelViewPath, userViewPath } from '~/features/labels/labelView';
import { personName } from '~/features/prefs/prefs';
import { triageQueueCount } from '~/features/triage/queue';
import { CreateIssueProvider } from '~/features/issue/create-context';
import { type IssueComposerSeed } from '~/features/issue/create-url';
import {
  createFavoriteFolder,
  moveFavorite,
  removeFavorite,
  renameFavoriteFolder,
} from '~/features/view/mutations';
import { byOrderKey, byOrderKeyThen } from '~/store';
import type { Document, Favorite, Store, Team, UUID, View } from '~/store';
import type { EngineStatus } from '~/sync/engine';

import { useWorkspaceSession } from './Boot';
import { useEngine, useQuery, useSyncStatus } from './context';
import { useActions } from './keymap';
import { CommandMenu } from './CommandMenu';
import { HelpOverlay } from './HelpOverlay';
import { pathToActiveIssues, pathToBacklogIssues } from './teamIssuePaths';
import { NavGlyph, navClass, navStyles } from './nav';
import { SettingsNav } from './SettingsNav';
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
  renderCreateIssue?: (props: { onClose: () => void; seed?: IssueComposerSeed }) => ReactNode;
  /**
   * Same split as create-issue: the action is global (command menu from any screen) and
   * the modal lives with the rest of the project UI. `C` stays create-issue.
   */
  renderCreateProject?: (props: { onClose: () => void }) => ReactNode;
  renderCreateInitiative?: (props: { onClose: () => void }) => ReactNode;
  renderCreateCustomer?: (props: { onClose: () => void }) => ReactNode;
  renderCreateCustomerRequest?: (props: { onClose: () => void }) => ReactNode;
  renderCreateDashboard?: (props: { onClose: () => void }) => ReactNode;
}

export function AppShell({
  children,
  renderCreateIssue,
  renderCreateProject,
  renderCreateInitiative,
  renderCreateCustomer,
  renderCreateCustomerRequest,
  renderCreateDashboard,
}: AppShellProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<IssueComposerSeed | undefined>();
  /**
   * Which sitting of the composer is on screen, and which one is allowed to close it.
   *
   * A boolean was not enough. The composer does not close when its button is clicked, it
   * closes when the create resolves, and `C` pressed inside that window used to reach this
   * shell, set `createOpen` to the `true` it already held, and vanish — the pending close
   * then landed on top of it. Reversed, it is no better: an open arriving between the close
   * and its commit collapses into the same boolean and leaves the previous sitting on
   * screen, still holding the title of the issue just filed.
   *
   * Counting the sittings makes both orders come out right. Opening always starts a new one,
   * which the `key` below turns into a fresh dialog rather than the old one's leftovers, and
   * closing only closes the sitting it belongs to — so a resolve that arrives after the user
   * has already asked for the next issue is ignored rather than shutting the door on them.
   */
  const [sitting, setSitting] = useState(0);
  const currentSitting = useRef(0);
  /**
   * Whether a composer is up, tracked synchronously alongside `createOpen`.
   *
   * The state is a frame behind at exactly the moment this has to be read: a close is queued
   * from the resolve of a create, and the chord asking for the next issue arrives before
   * React has committed it. Reading the state there would say "still open" and refuse to
   * start the next sitting, which is the original bug wearing a different hat.
   */
  const composerUp = useRef(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createInitiativeOpen, setCreateInitiativeOpen] = useState(false);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerRequestOpen, setCreateCustomerRequestOpen] = useState(false);
  const [createDashboardOpen, setCreateDashboardOpen] = useState(false);
  const session = useWorkspaceSession();
  const workspaceMenu = useMenuTrigger();
  const labelMenu = useMenuTrigger();
  const userMenu = useMenuTrigger();
  const issueMenu = useMenuTrigger();
  const projectMenu = useMenuTrigger();
  const teamMenu = useMenuTrigger();
  const viewMenu = useMenuTrigger();
  const documentMenu = useMenuTrigger();
  const favoriteMenu = useMenuTrigger();
  const customerMenu = useMenuTrigger();
  const onProjects =
    pathname === '/projects' ||
    pathname.startsWith('/project/') ||
    /\/team\/[^/]+\/projects(?:\/|$)/.test(pathname);
  const onInitiatives = pathname === '/initiatives' || pathname.startsWith('/initiative/');
  const onCustomers = pathname === '/customers' || pathname.startsWith('/customer/');
  const onDashboards = pathname === '/dashboards' || pathname.startsWith('/dashboard/');
  const onPulse = pathname === '/pulse';
  const onCycles = pathname.startsWith('/cycle/') || /\/team\/[^/]+\/cycles(?:\/|$)/.test(pathname);
  /**
   * Whether the shell is showing settings rather than the workspace.
   *
   * Settings is a mode, not a screen. Twenty-eight links to pages nobody opens twice a day
   * used to sit in the workspace navigation permanently, below a spacer that pinned them to
   * the bottom of a column they overflowed — always drawn and always out of sight, which is
   * the worst of both. They now have a navigation of their own, and this is the switch
   * between the two.
   *
   * Only the `<nav>` swaps. The command menu, the help overlay and every create modal are
   * siblings of it and stay mounted, so `Cmd+K` and the chords work the same on a settings
   * page as anywhere else.
   */
  const onSettings = pathname === '/settings' || pathname.startsWith('/settings/');

  const teams = useQuery(
    (store) => [...store.teams.values()].filter((team) => team.retiredAt === undefined),
    ['team'],
  );
  const teamTree = useMemo(() => buildTeamTree(teams), [teams]);
  const workspace = useQuery((store) => [...store.workspaces.values()][0], ['workspace']);
  const cyclesPath = useQuery((store) => pathToCycles(store), ['team', 'cycle']);
  // Also on the issues: with no team running triage, where `G T` lands depends on which
  // team is still holding a queue.
  const triagePath = useQuery((store) => pathToTriage(store), ['team', 'issue', 'workflowState']);
  const archivesPath = useQuery((store) => pathToArchives(store), ['team']);

  const viewerId = useViewerId();
  const viewerRole = useViewerRole();
  const engine = useEngine();
  useDesktopNotifications(engine, viewerId);
  useUnreadBadge();
  // Two readings of the same unknown, because the two things being gated fail in opposite
  // directions.
  //
  // The role comes from the session rather than from the replica: a guest's replica carries
  // no `user` rows at all — the directory is workspace-scoped and guests are not handed it
  // — so `useViewer()` is permanently null for exactly the person a role check exists to
  // exclude, and `viewer?.role !== 'guest'` read that as "not a guest".
  //
  // What a guest must never be shown reads unknown as *closed*, the way `showPulse` does:
  // the sidebar entries and the menus that list the workspace's customers.
  const notGuest = viewerRole !== null && viewerRole !== 'guest';
  const customersOn = workspace === undefined || workspace.customerRequestsEnabled;
  const showCustomers = notGuest && customersOn;
  const showDashboards = showCustomers;
  const showPulse = notGuest && (workspace === undefined || workspace.pulseEnabled);
  // Initiatives are workspace-wide and a guest is team-scoped: no workspace-wide surfaces,
  // and no settings beyond their own account — `docs/01-features/17-admin-security-
  // permissions.md`, "Guests".
  const showInitiatives = notGuest;
  // Settings is two halves, and until now both were `notGuest` under one flag named for the
  // half it did not implement.
  //
  // A workspace member is not an administrator: the same doc's role table gives Member "no
  // workspace administration pages". So the Settings nav is split by what the *server* does
  // with each screen, not by which sidebar block it happens to sit in:
  //
  //   - `showAdminSettings` — the screens where a non-admin may do nothing and see nothing.
  //     Either the read itself is refused (`ListWebhooks`, `ListOauthClients` and the
  //     GitHub/GitLab/Sentry/Slack settings queries, which select a webhook secret guarded
  //     by `ActionGitHubManage` and friends), or every control on the page is an admin
  //     action (`ActionWorkspaceUpdate` behind Workspace, Project updates, Pulse, Customer
  //     requests and SLAs; `ActionWorkspaceLabelManage` behind Project and Initiative
  //     labels; `ActionProjectStatusManage` behind Project statuses). Driven as a member,
  //     `/settings/oauth-apps` gave a page shell, a New OAuth app button and the alert
  //     "OAuth applications could not be fetched. Only admins can read them." — a list of
  //     doors rather than a way through one.
  //
  //   - `showMemberSettings` — the rest, which a member genuinely uses and which must not be
  //     swept up with the above. `ActionAPIKeyManage` is `!IsGuest`, so members mint their
  //     own keys (and MCP is the page that explains where to point them). `exportCap` gives
  //     a member 250 issues. Trash restores through `CanInTeam(ActionIssueDelete)`, which is
  //     membership. Labels and Templates each carry a team scope whose action is membership
  //     too. Members is deliberately readable with its admin controls withheld (#108). Asks
  //     and Deleted teams answer to `ActionTeamUpdate`/`ActionTeamDelete`, which a *team
  //     owner* holds while being an ordinary workspace member — a role this hook does not
  //     carry, so hiding them would take a page away from the people who use it.
  //
  // Both read an unanswered session as closed, the way `showPulse` does. A create action
  // reads it the other way; see `mayCreate` below.
  const isAdmin = viewerRole === 'owner' || viewerRole === 'admin';
  const showMemberSettings = notGuest;
  const showAdminSettings = isAdmin;
  // A create action reads it as *open*, because holding one back is what breaks. These
  // pages draw a create button that reaches its dialogue through the keymap, so an action
  // registered only once the role is known makes the first click land on nothing and stay
  // landed on nothing — nothing retries it. Offering the action to somebody whose role has
  // not arrived costs a refusal from the server at worst, and it is withdrawn the moment
  // the session answers "guest".
  const mayCreate = viewerRole !== 'guest';
  const mayCreateCustomers = mayCreate && customersOn;
  const views = useLiveQuery(
    (store) => (viewerId === null ? [] : visibleViews(store, viewerId)),
    ['view', 'favorite'],
    [viewerId],
  );
  const gotoLabels = useLiveQuery((store) => gotoLabelItems(store), ['label'], []);
  const gotoUsers = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.archivedAt === undefined && user.kind === 'human')
        .sort((a, b) => personName(a).localeCompare(personName(b))),
    ['user'],
    [],
  );
  const gotoIssues = useLiveQuery(
    (store: Store) =>
      [...store.issues.values()]
        .filter((issue) => issue.archivedAt === undefined)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 80)
        .map((issue) => ({
          id: issue.id,
          label: `${store.identifierOf(issue)} ${issue.title}`,
          href: `/issue/${store.identifierOf(issue)}`,
        })),
    ['issue', 'team'],
    [],
  );
  const gotoProjects = useLiveQuery(
    (store: Store) =>
      [...store.projects.values()]
        .filter((project) => project.archivedAt === undefined && project.deletedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['project'],
    [],
  );
  const gotoViews = useLiveQuery(
    (store: Store) => (viewerId === null ? [] : jumpViews(store, viewerId)),
    ['view'],
    [viewerId],
  );
  const gotoDocuments = useLiveQuery(
    (store: Store) =>
      [...store.documents.values()]
        .filter((doc) => doc.archivedAt === undefined && doc.deletedAt === undefined)
        .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
    ['document'],
    [],
  );
  const gotoFavorites = useLiveQuery(
    (store: Store) => (viewerId === null ? [] : flattenFavorites(favoriteNav(store, viewerId))),
    ['favorite', 'view', 'team', 'issue', 'label'],
    [viewerId],
  );
  const gotoCustomers = useLiveQuery(
    (store: Store) =>
      [...store.customers.values()]
        .filter((customer) => customer.archivedAt === undefined && customer.deletedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['customer'],
    [],
  );

  const closeAll = useCallback(() => {
    setCommandOpen(false);
    setHelpOpen(false);
    composerUp.current = false;
    setCreateOpen(false);
    setCreateSeed(undefined);
    setCreateProjectOpen(false);
    setCreateInitiativeOpen(false);
    setCreateCustomerOpen(false);
    setCreateCustomerRequestOpen(false);
    setCreateDashboardOpen(false);
  }, []);

  const openCreate = useCallback((seed?: IssueComposerSeed) => {
    // Asking for a composer that is already up is asking for something you have. Starting a
    // new sitting here would throw away a half-written issue, so the request is dropped and
    // the dialog on screen keeps the floor. The dialog itself claims the chord for the one
    // case where that is the wrong answer — a create already in flight.
    if (composerUp.current) return;
    composerUp.current = true;
    currentSitting.current += 1;
    setSitting(currentSitting.current);
    setCreateSeed(seed);
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback(
    (closing: number) => {
      // A create that resolved after the filer had already started the next issue. The
      // dialog they are looking at is not the one asking to close.
      if (closing !== currentSitting.current) return;
      composerUp.current = false;
      setCreateOpen(false);
      setCreateSeed(undefined);
      if (pathname === '/new' || /\/team\/[^/]+\/new$/.test(pathname)) {
        void navigate('/');
      }
    },
    [navigate, pathname],
  );

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
        keys: ['?', 'mod+slash'],
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
        run: () => openCreate(),
      },
      ...(mayCreate
        ? [
            {
              id: 'project.create',
              title: 'Create project',
              group: 'Projects',
              run: () => setCreateProjectOpen(true),
            },
            {
              id: 'initiative.create',
              title: 'Create initiative',
              group: 'Initiatives',
              run: () => setCreateInitiativeOpen(true),
            },
          ]
        : []),
      ...(mayCreateCustomers
        ? [
            {
              id: 'customer.create',
              title: 'Create customer',
              group: 'Customers',
              run: () => setCreateCustomerOpen(true),
            },
            {
              id: 'customerRequest.create',
              title: 'Create customer request',
              group: 'Customers',
              run: () => setCreateCustomerRequestOpen(true),
            },
          ]
        : []),
      ...(mayCreateCustomers
        ? [
            {
              id: 'dashboard.create',
              title: 'Create dashboard',
              group: 'Dashboards',
              run: () => setCreateDashboardOpen(true),
            },
          ]
        : []),
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
      ...(showPulse
        ? [
            {
              id: 'nav.pulse',
              title: 'Go to Pulse',
              keys: ['g u'],
              group: 'Navigation',
              run: () => navigate('/pulse'),
            },
          ]
        : []),
      {
        id: 'nav.drafts',
        title: 'Go to Drafts',
        keys: ['g d'],
        group: 'Navigation',
        run: () => navigate('/drafts'),
      },
      {
        id: 'nav.preferences',
        title: 'Go to Preferences',
        group: 'Navigation',
        run: () => navigate('/settings/preferences'),
      },
      /**
       * The jump pickers, offered only while the workspace navigation is on screen.
       *
       * Every one of them opens a `Menu` anchored to a visually hidden button that lives
       * inside that `<nav>`. In settings the nav is the settings one, those buttons are not
       * mounted, and `o i` would ask a menu to position itself against a ref holding null.
       * The command menu's claim is that it "offers what is actually available rather than
       * a fixed list that fails when chosen", and here that is literal.
       */
      ...(onSettings
        ? []
        : [
            {
              id: 'nav.switchWorkspace',
              title: 'Switch workspace',
              keys: ['o w'],
              group: 'Navigation',
              run: () => workspaceMenu.show(),
            },
            {
              id: 'nav.openLabel',
              title: 'Open label',
              keys: ['o l'],
              group: 'Navigation',
              run: () => labelMenu.show(),
            },
            {
              id: 'nav.openUser',
              title: 'Open user',
              keys: ['o u'],
              group: 'Navigation',
              run: () => userMenu.show(),
            },
            {
              id: 'nav.openIssue',
              title: 'Open issue',
              keys: ['o i'],
              group: 'Navigation',
              run: () => issueMenu.show(),
            },
            {
              id: 'nav.openProject',
              title: 'Open project',
              keys: ['o p'],
              group: 'Navigation',
              run: () => projectMenu.show(),
            },
            {
              id: 'nav.openTeam',
              title: 'Open team',
              keys: ['o t'],
              group: 'Navigation',
              run: () => teamMenu.show(),
            },
            {
              id: 'nav.openView',
              title: 'Open view',
              keys: ['o v'],
              group: 'Navigation',
              run: () => viewMenu.show(),
            },
            {
              id: 'nav.openDocument',
              title: 'Open document',
              keys: ['o d'],
              group: 'Navigation',
              run: () => documentMenu.show(),
            },
            {
              id: 'nav.openFavorite',
              title: 'Open favourite',
              keys: ['o f'],
              group: 'Navigation',
              run: () => favoriteMenu.show(),
            },
          ]),
      ...(showCustomers && !onSettings
        ? [
            {
              id: 'nav.openCustomer',
              title: 'Open customer',
              keys: ['o q'],
              group: 'Navigation',
              run: () => customerMenu.show(),
            },
          ]
        : []),
      {
        // Not admin-gated any more, and not pointed at an admin page. `/settings` used to
        // render the workspace general form, so `G S` as a member drew "Only admins can
        // open this" — a shortcut whose whole job is to open settings, refusing to. It
        // redirects to Profile now, which everybody has.
        id: 'nav.settings',
        title: 'Go to settings',
        keys: ['g s'],
        group: 'Navigation',
        run: () => navigate('/settings'),
      },
      {
        id: 'nav.profile',
        title: 'Go to Profile',
        group: 'Navigation',
        run: () => navigate('/settings/profile'),
      },
      ...(showAdminSettings
        ? [
            {
              id: 'nav.projectStatuses',
              title: 'Go to Project statuses',
              group: 'Navigation',
              run: () => navigate('/settings/project-statuses'),
            },
          ]
        : []),
      {
        id: 'nav.sessions',
        title: 'Go to Sessions',
        group: 'Navigation',
        run: () => navigate('/settings/sessions'),
      },
      {
        id: 'nav.authorisedApps',
        title: 'Go to Authorised apps',
        group: 'Navigation',
        run: () => navigate('/settings/authorised-apps'),
      },
      ...(showMemberSettings
        ? [
            {
              id: 'nav.mcp',
              title: 'Go to MCP',
              group: 'Navigation',
              run: () => navigate('/settings/mcp'),
            },
            {
              id: 'nav.asks',
              title: 'Go to Asks',
              group: 'Navigation',
              run: () => navigate('/settings/asks'),
            },
          ]
        : []),
      ...(showAdminSettings
        ? [
            {
              id: 'nav.customerRequests',
              title: 'Go to Customer requests',
              group: 'Navigation',
              run: () => navigate('/settings/customers'),
            },
          ]
        : []),
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
        id: 'nav.active',
        title: 'Go to Active issues',
        keys: ['g a'],
        group: 'Navigation',
        run: () => navigate(pathToActiveIssues(engine.store, pathname)),
      },
      {
        id: 'nav.backlog',
        title: 'Go to Backlog',
        keys: ['g b'],
        group: 'Navigation',
        run: () => navigate(pathToBacklogIssues(engine.store, pathname)),
      },
      ...(showInitiatives
        ? [
            {
              id: 'nav.initiatives',
              title: 'Go to Initiatives',
              group: 'Navigation',
              run: () => navigate('/initiatives'),
            },
          ]
        : []),
      ...(showCustomers
        ? [
            {
              id: 'nav.customers',
              title: 'Go to Customers',
              keys: ['g q'],
              group: 'Navigation',
              run: () => navigate('/customers'),
            },
          ]
        : []),
      ...(showDashboards
        ? [
            {
              id: 'nav.dashboards',
              title: 'Go to Dashboards',
              group: 'Navigation',
              run: () => navigate('/dashboards'),
            },
          ]
        : []),
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
      ...(showMemberSettings
        ? [
            {
              id: 'nav.trash',
              title: 'Go to trash',
              group: 'Navigation',
              run: () => navigate('/settings/trash'),
            },
          ]
        : []),
    ],
    [
      navigate,
      closeAll,
      cyclesPath,
      triagePath,
      archivesPath,
      openCreate,
      workspaceMenu.show,
      labelMenu.show,
      userMenu.show,
      issueMenu.show,
      projectMenu.show,
      teamMenu.show,
      viewMenu.show,
      documentMenu.show,
      favoriteMenu.show,
      customerMenu.show,
      showCustomers,
      showDashboards,
      mayCreate,
      mayCreateCustomers,
      showPulse,
      showInitiatives,
      showMemberSettings,
      showAdminSettings,
      onSettings,
      engine,
      pathname,
    ],
  );

  /**
   * The workspace menu.
   *
   * It listed workspaces and nothing else, which made it the one control in the product
   * that answers a question nobody asks daily — most people belong to one workspace — while
   * the three things they *do* look for behind a workspace mark were not there at all.
   * Settings, an invitation and the way out now hang below the switcher, which is where
   * every other tool of this shape keeps them.
   *
   * Invite is admin-only for the reason `MemberSettings` gives about its own command: an
   * entry that answers with the server's 403 is worse than no entry. It hands off through
   * the URL rather than by hoisting the dialog's state up here, so the seat check that
   * guards it still runs, and the link is worth sending to somebody.
   */
  const workspaceItems: MenuNode[] = [
    ...(session.workspaces.length > 1 ? [{ kind: 'heading' as const, label: 'Workspaces' }] : []),
    ...session.workspaces.map((item) => ({
      id: item.id,
      label: item.name,
      selected: item.id === session.currentId,
      onSelect: () => {
        if (item.id === session.currentId) return;
        void session.switchTo(item.id);
      },
    })),
    { kind: 'separator' as const },
    {
      id: 'workspace-settings',
      label: 'Settings',
      keys: 'g s',
      onSelect: () => void navigate('/settings'),
    },
    ...(showAdminSettings
      ? [
          {
            id: 'workspace-invite',
            label: 'Invite people',
            onSelect: () => void navigate('/settings/members?invite=1'),
          },
        ]
      : []),
    { kind: 'separator' as const },
    {
      id: 'workspace-logout',
      label: 'Log out',
      danger: true,
      // `logout` clears the session and fires the auth-lost callbacks, and those are what
      // return the app to the sign-in screen. Navigating here as well would race them.
      onSelect: () => void auth.logout(),
    },
  ];

  return (
    <CreateIssueProvider value={{ open: openCreate }}>
      <div className={styles.shell}>
        {onSettings ? (
          <SettingsNav
            showMemberSettings={showMemberSettings}
            showAdminSettings={showAdminSettings}
          />
        ) : (
          <nav className={navStyles.sidebar} aria-label="Workspace">
            <div className={styles.workspace}>
              {/*
                Named for the menu rather than for one entry in it. It read "Switch workspace"
                while the menu did nothing else; with Settings, an invitation and Log out
                behind it, a screen reader announcing a button that switches workspaces is
                announcing the wrong control. The `O`+`W` command keeps the old title —
                switching really is what that chord is for.
              */}
              <button
                type="button"
                className={styles.workspaceSwitch}
                {...workspaceMenu.props}
                aria-label="Workspace menu"
              >
                <WorkspaceMark name={workspace?.name ?? 'Polaris'} logoUrl={workspace?.logoUrl} />
                <span className={styles.workspaceName}>{workspace?.name ?? 'Polaris'}</span>
              </button>
              <ConnectionIndicator />
              <Menu
                open={workspaceMenu.open}
                onClose={workspaceMenu.hide}
                trigger={workspaceMenu.ref}
                label="Workspace menu"
                items={workspaceItems}
              />
              <button type="button" className={styles.gotoTrigger} {...labelMenu.props}>
                Open label
              </button>
              <Menu
                open={labelMenu.open}
                onClose={labelMenu.hide}
                trigger={labelMenu.ref}
                label="Labels"
                filterable={gotoLabels.length > 8}
                filterPlaceholder="Filter labels"
                emptyLabel="No labels yet"
                items={gotoLabels.map((item) => ({
                  id: item.id,
                  label:
                    item.groupName === undefined ? item.name : `${item.groupName}: ${item.name}`,
                  onSelect: () => navigate(labelViewPath(item.id)),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...userMenu.props}>
                Open user
              </button>
              <Menu
                open={userMenu.open}
                onClose={userMenu.hide}
                trigger={userMenu.ref}
                label="People"
                filterable={gotoUsers.length > 8}
                filterPlaceholder="Filter people"
                emptyLabel="No people in this workspace"
                items={gotoUsers.map((user) => ({
                  id: user.id,
                  label: personName(user),
                  onSelect: () => navigate(userViewPath(user.id)),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...issueMenu.props}>
                Open issue
              </button>
              <Menu
                open={issueMenu.open}
                onClose={issueMenu.hide}
                trigger={issueMenu.ref}
                label="Issues"
                filterable
                filterPlaceholder="Filter issues"
                emptyLabel="No issues yet"
                items={gotoIssues.map((item) => ({
                  id: item.id,
                  label: item.label,
                  onSelect: () => navigate(item.href),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...projectMenu.props}>
                Open project
              </button>
              <Menu
                open={projectMenu.open}
                onClose={projectMenu.hide}
                trigger={projectMenu.ref}
                label="Projects"
                filterable={gotoProjects.length > 8}
                filterPlaceholder="Filter projects"
                emptyLabel="No projects yet"
                items={gotoProjects.map((project) => ({
                  id: project.id,
                  label: project.name,
                  onSelect: () => navigate(`/project/${project.id}`),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...teamMenu.props}>
                Open team
              </button>
              <Menu
                open={teamMenu.open}
                onClose={teamMenu.hide}
                trigger={teamMenu.ref}
                label="Teams"
                filterable={teams.length > 8}
                filterPlaceholder="Filter teams"
                emptyLabel="No teams yet"
                items={teams.map((team) => ({
                  id: team.id,
                  label: `${team.key} ${team.name}`,
                  onSelect: () => navigate(`/team/${team.key}`),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...viewMenu.props}>
                Open view
              </button>
              <Menu
                open={viewMenu.open}
                onClose={viewMenu.hide}
                trigger={viewMenu.ref}
                label="Views"
                filterable={gotoViews.length > 8}
                filterPlaceholder="Filter views"
                emptyLabel="No views yet"
                items={gotoViews.map((view) => ({
                  id: view.id,
                  label: view.name,
                  onSelect: () => navigate(viewPath(view)),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...documentMenu.props}>
                Open document
              </button>
              <Menu
                open={documentMenu.open}
                onClose={documentMenu.hide}
                trigger={documentMenu.ref}
                label="Documents"
                filterable={gotoDocuments.length > 8}
                filterPlaceholder="Filter documents"
                emptyLabel="No documents yet"
                items={gotoDocuments.map((doc: Document) => ({
                  id: doc.id,
                  label: doc.title === '' ? 'Untitled' : doc.title,
                  onSelect: () => navigate(`/document/${doc.id}`),
                }))}
              />
              <button type="button" className={styles.gotoTrigger} {...favoriteMenu.props}>
                Open favourite
              </button>
              <Menu
                open={favoriteMenu.open}
                onClose={favoriteMenu.hide}
                trigger={favoriteMenu.ref}
                label="Favourites"
                filterable={gotoFavorites.length > 8}
                filterPlaceholder="Filter favourites"
                emptyLabel="No favourites yet"
                items={gotoFavorites.map((item) => ({
                  id: item.id,
                  label: item.prefix === null ? item.label : `${item.prefix} ${item.label}`,
                  onSelect: () => navigate(item.to),
                }))}
              />
              {showCustomers ? (
                <>
                  <button type="button" className={styles.gotoTrigger} {...customerMenu.props}>
                    Open customer
                  </button>
                  <Menu
                    open={customerMenu.open}
                    onClose={customerMenu.hide}
                    trigger={customerMenu.ref}
                    label="Customers"
                    filterable={gotoCustomers.length > 8}
                    filterPlaceholder="Filter customers"
                    emptyLabel="No customers yet"
                    items={gotoCustomers.map((customer) => ({
                      id: customer.id,
                      label: customer.name,
                      onSelect: () => navigate(`/customer/${customer.id}`),
                    }))}
                  />
                </>
              ) : null}
            </div>

            <div className={navStyles.section}>
              <NavLink to="/my-issues" className={navClass}>
                <NavGlyph name="issues" />
                <span className={navStyles.navLabel}>My Issues</span>
              </NavLink>
              <NavLink to="/inbox" className={navClass}>
                <NavGlyph name="inbox" />
                <span className={navStyles.navLabel}>Inbox</span>
              </NavLink>
              {showPulse && (
                <NavLink to="/pulse" className={() => navClass({ isActive: onPulse })}>
                  <NavGlyph name="pulse" />
                  <span className={navStyles.navLabel}>Pulse</span>
                </NavLink>
              )}
              <NavLink to="/drafts" className={navClass}>
                <NavGlyph name="drafts" />
                <span className={navStyles.navLabel}>Drafts</span>
              </NavLink>
              <NavLink to="/search" className={navClass}>
                <NavGlyph name="search" />
                <span className={navStyles.navLabel}>Search</span>
              </NavLink>
              <NavLink to="/projects" className={() => navClass({ isActive: onProjects })}>
                <NavGlyph name="project" />
                <span className={navStyles.navLabel}>Projects</span>
              </NavLink>
              {showInitiatives && (
                <NavLink to="/initiatives" className={() => navClass({ isActive: onInitiatives })}>
                  <NavGlyph name="initiative" />
                  <span className={navStyles.navLabel}>Initiatives</span>
                </NavLink>
              )}
              {showCustomers && (
                <NavLink to="/customers" className={() => navClass({ isActive: onCustomers })}>
                  <NavGlyph name="customer" />
                  <span className={navStyles.navLabel}>Customers</span>
                </NavLink>
              )}
              {showDashboards && (
                <NavLink to="/dashboards" className={() => navClass({ isActive: onDashboards })}>
                  <NavGlyph name="dashboard" />
                  <span className={navStyles.navLabel}>Dashboards</span>
                </NavLink>
              )}
              <NavLink to={cyclesPath} className={() => navClass({ isActive: onCycles })}>
                <NavGlyph name="cycle" />
                <span className={navStyles.navLabel}>Cycles</span>
              </NavLink>
            </div>

            {viewerId !== null && <FavoritesSection userId={viewerId} />}

            <div className={navStyles.section}>
              <h2 className={navStyles.sectionTitle}>Teams</h2>
              {teamTree.roots.map((team) => (
                <TeamNavItems
                  key={team.id}
                  team={team}
                  depth={0}
                  childrenByParent={teamTree.childrenByParent}
                />
              ))}
            </div>

            {views.length > 0 && (
              <div className={navStyles.section}>
                <h2 className={navStyles.sectionTitle}>Views</h2>
                {views.map((view) => (
                  <NavLink key={view.id} to={viewPath(view)} className={navClass}>
                    <NavGlyph name="view" />
                    <span className={navStyles.navLabel}>{view.name}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </nav>
        )}

        <main className={styles.main}>
          {/*
           * Keyed on the pathname so that every route change is a mount, and a mount is what
           * a CSS entrance needs. Most navigations already replaced this subtree — different
           * routes render different components — so the key changes little except for the
           * navigations that stay within one screen and swap its subject, `/issue/A` to
           * `/issue/B` being the obvious one. Those are the ones that most needed it: the
           * page used to change its entire contents with nothing to say that it had.
           *
           * The pathname, deliberately, and not the whole location. The query string carries
           * the filters and the display options, and remounting the list every time somebody
           * narrows it would throw away the virtualiser's measurements and the scroll
           * position on each keystroke — a route transition for something that is not a route
           * change.
           */}
          <div key={pathname} className={styles.view}>
            {children}
          </div>
        </main>

        <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
        <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
        {createOpen && (
          // Keyed by the sitting: asking for a new issue while one is on screen replaces the
          // dialog rather than leaving the filed issue's title sitting in the field.
          <Fragment key={sitting}>
            {renderCreateIssue?.({ onClose: () => closeCreate(sitting), seed: createSeed })}
          </Fragment>
        )}
        {createProjectOpen && renderCreateProject?.({ onClose: () => setCreateProjectOpen(false) })}
        {createInitiativeOpen &&
          renderCreateInitiative?.({ onClose: () => setCreateInitiativeOpen(false) })}
        {createCustomerOpen &&
          renderCreateCustomer?.({ onClose: () => setCreateCustomerOpen(false) })}
        {createCustomerRequestOpen &&
          renderCreateCustomerRequest?.({ onClose: () => setCreateCustomerRequestOpen(false) })}
        {createDashboardOpen &&
          renderCreateDashboard?.({ onClose: () => setCreateDashboardOpen(false) })}
      </div>
    </CreateIssueProvider>
  );
}

function buildTeamTree(teams: readonly Team[]): {
  roots: Team[];
  childrenByParent: Map<UUID, Team[]>;
} {
  const childrenByParent = new Map<UUID, Team[]>();
  const roots: Team[] = [];
  for (const team of teams) {
    if (team.parentTeamId === undefined) {
      roots.push(team);
      continue;
    }
    const siblings = childrenByParent.get(team.parentTeamId) ?? [];
    siblings.push(team);
    childrenByParent.set(team.parentTeamId, siblings);
  }
  const byKey = (a: Team, b: Team) => a.key.localeCompare(b.key);
  roots.sort(byKey);
  for (const siblings of childrenByParent.values()) {
    siblings.sort(byKey);
  }
  return { roots, childrenByParent };
}

function TeamNavItems({
  team,
  depth,
  childrenByParent,
}: {
  team: Team;
  depth: number;
  childrenByParent: ReadonlyMap<UUID, Team[]>;
}) {
  const children = childrenByParent.get(team.id) ?? [];
  return (
    <>
      <NavLink
        to={`/team/${team.key}/home`}
        className={navClass}
        style={
          depth > 0 ? { paddingInlineStart: `calc(var(--space-3) * ${depth + 1})` } : undefined
        }
      >
        <span className={styles.teamKey}>{team.key}</span>
        <span className={navStyles.navLabel}>{team.name}</span>
      </NavLink>
      {children.map((child) => (
        <TeamNavItems
          key={child.id}
          team={child}
          depth={depth + 1}
          childrenByParent={childrenByParent}
        />
      ))}
    </>
  );
}

const FAVORITE_DRAG = 'text/polaris-favorite';

function FavoritesSection({ userId }: { userId: UUID }) {
  const engine = useEngine();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const nav = useLiveQuery(
    (store) => favoriteNav(store, userId),
    ['favorite', 'view', 'team', 'issue', 'label'],
    [userId],
  );

  if (nav.folders.length === 0 && nav.unfiled.length === 0 && !creating) return null;

  const submitFolder = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (name === '') return;
    void createFavoriteFolder(engine, userId, name);
    setDraft('');
    setCreating(false);
  };

  const onDropOn = (folderId: UUID | null) => (event: DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(FAVORITE_DRAG);
    if (id === '') return;
    void moveFavorite(engine, id, folderId);
  };

  return (
    <div className={navStyles.section}>
      <h2 className={navStyles.sectionTitle}>
        Favourites
        <button type="button" className={styles.folderAction} onClick={() => setCreating(true)}>
          New folder
        </button>
      </h2>

      {creating ? (
        <form className={styles.folderCreate} onSubmit={submitFolder}>
          <input
            className={styles.folderInput}
            aria-label="Folder name"
            value={draft}
            placeholder="Folder name"
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft.trim() === '') setCreating(false);
            }}
          />
        </form>
      ) : null}

      {nav.folders.map((folder) => (
        <div
          key={folder.id}
          className={styles.folder}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDropOn(folder.id)}
        >
          <FolderHeader
            folder={folder}
            onRename={(name) => void renameFavoriteFolder(engine, folder.id, name)}
            onDelete={() => void removeFavorite(engine, userId, 'folder', folder.id)}
          />
          {folder.items.map((item) => (
            <FavoriteItem key={item.id} item={item} />
          ))}
        </div>
      ))}

      <div onDragOver={(event) => event.preventDefault()} onDrop={onDropOn(null)}>
        {nav.unfiled.map((item) => (
          <FavoriteItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function FolderHeader({
  folder,
  onRename,
  onDelete,
}: {
  folder: FavoriteFolderNav;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(folder.name);
  const commit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === folder.name) {
      setName(folder.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div className={styles.folderHeader}>
      <form
        className={styles.folderName}
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <input
          className={styles.folderInput}
          aria-label={`Folder ${folder.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
        />
      </form>
      <button
        type="button"
        className={styles.folderAction}
        onClick={onDelete}
        aria-label={`Delete ${folder.name}`}
      >
        Delete
      </button>
    </div>
  );
}

function FavoriteItem({ item }: { item: FavoriteLink }) {
  return (
    <NavLink
      to={item.to}
      className={navClass}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(FAVORITE_DRAG, item.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      {item.prefix !== null && <span className={styles.teamKey}>{item.prefix}</span>}
      <span className={navStyles.navLabel}>{item.label}</span>
    </NavLink>
  );
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
 * Where `G T` should land: the first team that runs triage, else the first team still
 * holding a queue somebody turned intake off on top of, else the first team's inbox page —
 * which then teaches how to turn it on.
 */
function pathToTriage(store: Store): string {
  const teams = [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key));
  const withTriage =
    teams.find((team) => team.triageEnabled) ??
    teams.find((team) => triageQueueCount(store, team.id) > 0) ??
    teams[0];
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
  if (view.projectId !== undefined) return `/project/${view.projectId}/view/${view.id}`;
  return `/view/${view.id}`;
}

interface FavoriteLink {
  readonly id: UUID;
  readonly to: string;
  readonly label: string;
  /** The team key, for an issue or a team. Null for anything without one. */
  readonly prefix: string | null;
}

interface FavoriteFolderNav {
  readonly id: UUID;
  readonly name: string;
  readonly items: readonly FavoriteLink[];
}

interface FavoriteNav {
  readonly folders: readonly FavoriteFolderNav[];
  readonly unfiled: readonly FavoriteLink[];
}

/**
 * The viewer's favourites, resolved to links and grouped into folders.
 *
 * A favourite whose target is not in the replica is dropped rather than rendered as a row
 * with a blank name: the entity may have been deleted, or may be in a team this person has
 * since left, and either way a sidebar entry that goes nowhere is worse than one fewer entry.
 * The server's own delta removes the row soon enough.
 */
function favoriteNav(store: Store, userId: UUID): FavoriteNav {
  const ordered = [...store.favorites.values()]
    .filter((favorite) => favorite.userId === userId)
    .sort(byOrderKey('position'));

  const folderIds = new Set<UUID>();
  for (const favorite of ordered) {
    if (favorite.kind === 'folder') folderIds.add(favorite.id);
  }

  const itemsByFolder = new Map<UUID, FavoriteLink[]>();
  const unfiled: FavoriteLink[] = [];

  for (const favorite of ordered) {
    if (favorite.kind === 'folder') continue;
    const link = favoriteLink(store, favorite);
    if (link === null) continue;
    if (favorite.folderId !== undefined && folderIds.has(favorite.folderId)) {
      const bucket = itemsByFolder.get(favorite.folderId) ?? [];
      bucket.push(link);
      itemsByFolder.set(favorite.folderId, bucket);
      continue;
    }
    unfiled.push(link);
  }

  const folders: FavoriteFolderNav[] = [];
  for (const favorite of ordered) {
    if (favorite.kind !== 'folder') continue;
    folders.push({
      id: favorite.id,
      name: favorite.name ?? 'Folder',
      items: itemsByFolder.get(favorite.id) ?? [],
    });
  }

  return { folders, unfiled };
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
        : { id: favorite.id, to: `/team/${team.key}/home`, label: team.name, prefix: team.key };
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
      return {
        id: favorite.id,
        to: labelViewPath(label.id),
        label: label.name,
        prefix: null,
      };
    }
    case 'folder':
      return null;
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
function flattenFavorites(nav: FavoriteNav): FavoriteLink[] {
  return [...nav.unfiled, ...nav.folders.flatMap((folder) => [...folder.items])];
}

/**
 * Views the jump picker offers, including ones already favourited.
 *
 * The sidebar hides a favourited view from the Views section so it is not listed twice.
 * `O V` is a jump, not a section: hiding the row there would mean the picker could not
 * reach a view the person uses every day.
 */
function jumpViews(store: Store, userId: UUID): readonly View[] {
  return [...store.views.values()]
    .filter(
      (view) =>
        view.archivedAt === undefined &&
        view.projectId === undefined &&
        (view.ownerId === undefined || view.ownerId === userId),
    )
    .sort(byOrderKeyThen('position', 'name'));
}

function visibleViews(store: Store, userId: UUID): readonly View[] {
  const favourited = new Set<UUID>();
  for (const favorite of store.favorites.values()) {
    if (favorite.userId === userId && favorite.kind === 'view') favourited.add(favorite.targetId);
  }

  return [...store.views.values()]
    .filter(
      (view) =>
        view.archivedAt === undefined &&
        view.projectId === undefined &&
        !favourited.has(view.id) &&
        (view.ownerId === undefined || view.ownerId === userId),
    )
    .sort(byOrderKeyThen('position', 'name'));
}

/**
 * The square beside the workspace name: its logo if it has one, its initial otherwise.
 *
 * The letter is not a placeholder waiting for an upload — most workspaces never set a logo,
 * and it is what Settings → Workspace promises is kept when the field is blank. Which makes
 * the image the exception, and the fallback the thing that has to be right: a URL that
 * 404s, or one that pointed at an image somebody has since deleted, falls back to the letter
 * rather than leaving a broken-image glyph in the corner of every screen.
 *
 * Keyed by url rather than by a boolean, as `Avatar` is, so replacing a broken logo with a
 * working one is not ignored for the rest of the session.
 */
function WorkspaceMark({ name, logoUrl }: { name: string; logoUrl?: string | undefined }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const usable = logoUrl !== undefined && logoUrl !== '' && logoUrl !== brokenSrc;

  return (
    <span className={styles.workspaceMark} aria-hidden="true">
      {usable ? (
        // Empty alt, and the wrapper is already hidden: the workspace's name is written
        // immediately beside this, and naming it twice helps nobody.
        <img
          className={styles.workspaceLogo}
          src={logoUrl}
          alt=""
          onError={() => setBrokenSrc(logoUrl)}
        />
      ) : (
        [...name][0]?.toUpperCase()
      )}
    </span>
  );
}

/** What the badge currently says, or `null` for the states it stays quiet about. */
interface SyncReport {
  readonly text: string;
  readonly title: string;
  /** The tone class, or undefined for the neutral states. */
  readonly tone: string | undefined;
}

/**
 * The ladder, lifted out of the component.
 *
 * It used to be four `return <span>` branches, which was fine while the badge could vanish
 * mid-frame. It cannot any more: the node has to outlive the status that justified it for
 * the length of its exit, so the component needs to be able to render a report the current
 * status no longer produces — and a component that returns markup from four branches has
 * nowhere to keep one.
 */
function describeSync(status: EngineStatus): SyncReport | null {
  if (status.phase === 'bootstrapping') {
    return {
      text: `Loading ${status.received > 0 ? `${status.received}` : ''}`,
      title: 'Loading your workspace',
      tone: undefined,
    };
  }
  if (status.phase === 'failed') {
    return { text: 'Offline', title: status.error, tone: styles.statusError };
  }
  if (status.phase !== 'ready') return null;
  if (status.pending > 0) {
    return {
      text: `Syncing ${status.pending}`,
      title: 'Changes waiting to be sent',
      tone: undefined,
    };
  }
  if (status.connection !== 'ready') {
    return { text: 'Reconnecting', title: 'Reconnecting', tone: styles.statusWarn };
  }
  return null;
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
 *
 * It is also now a *single* span across all four states rather than one per branch. That is
 * not tidiness: four elements meant the badge tore itself down and rebuilt itself every time
 * bootstrapping handed over to syncing, so there was never one node for a colour to
 * transition on, and every handover was a fresh insertion into the live region rather than an
 * update to it.
 */
function ConnectionIndicator() {
  const status = useSyncStatus();
  const ref = useRef<HTMLSpanElement>(null);
  // Memoised on the status object so that `report` only changes when the status does, which
  // is what makes the render-phase update below terminate rather than propose a new report
  // on every pass.
  const report = useMemo(() => describeSync(status), [status]);
  const { present, exitProps } = usePresence(report !== null, ref);

  /**
   * The last thing it said, held for the length of the fade out.
   *
   * `report` is already null on the frame the badge starts leaving — being null is what makes
   * it leave — so rendering straight from it would empty the span first and then fade out an
   * empty box. This is the same render-phase update usePresence makes, and it is here for the
   * same reason: deriving from props without paying a second commit.
   */
  const [shown, setShown] = useState(report);
  if (report !== null && report !== shown) setShown(report);

  if (!present || shown === null) return null;

  return (
    <span
      ref={ref}
      role="status"
      // `polite`, not `assertive`: reconnecting is worth knowing and not worth interrupting
      // whatever the user is reading to say.
      aria-live="polite"
      aria-label="Sync status"
      className={[styles.status, shown.tone].filter(Boolean).join(' ')}
      title={shown.title}
      {...exitProps}
    >
      {shown.text}
    </span>
  );
}
