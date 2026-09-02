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
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import { useDesktopNotifications, useUnreadBadge } from '~/features/inbox/desktop';
import { unreadCount, useWakingQuery } from '~/features/inbox/inbox';
import { offerError } from '~/features/toast/ToastHost';
import { offerUndo } from '~/features/undo/UndoToast';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { usePresence } from '~/hooks/usePresence';
import { useViewerId, useViewerRole } from '~/hooks/useViewer';
import { ConfirmDialog, IconButton, Menu, SkeletonRows, type MenuNode } from '~/components';
import { auth } from '~/sync/api';
import { gotoLabelItems, labelViewPath, userViewPath } from '~/features/labels/labelView';
import { personName } from '~/features/prefs/prefs';
import { triageQueueCount } from '~/features/triage/queue';
import { UpdateBanner } from '~/platform/UpdateBanner';
import { CreateIssueProvider } from '~/features/issue/create-context';
import { type IssueComposerSeed } from '~/features/issue/create-url';
import {
  createFavoriteFolder,
  moveFavorite,
  removeFavorite,
  renameFavoriteFolder,
} from '~/features/view/mutations';
import { MOVE_FAVORITE } from '~/features/view/operations';
import { byOrderKey, byOrderKeyThen, orderKeyBetween } from '~/store';
import type { Document, Favorite, Store, Team, UUID, View } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { useWorkspaceSession } from './Boot';
import { useEngine, useQuery, useSyncStatus } from './context';
import { useActions } from './keymap';
import { CommandMenu } from './CommandMenu';
import { HelpOverlay } from './HelpOverlay';
import { pathToActiveIssues, pathToBacklogIssues } from './teamIssuePaths';
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  NavChevron,
  NavGlyph,
  NavSection,
  WorkspaceMark,
  navClass,
  navStyles,
  useSidebarChrome,
  type SidebarChrome,
} from './nav';
import { SettingsNav } from './SettingsNav';
import { useScrollRestoration } from './useScrollRestoration';
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
  renderCreateIssue?: (props: {
    open: boolean;
    onClose: () => void;
    seed?: IssueComposerSeed;
  }) => ReactNode;
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

/**
 * How far one arrow key moves the sidebar's edge, and how far one with Shift held moves it.
 *
 * Pixels rather than a token because this is a delta rather than a size: nothing on the
 * spacing scale describes "the smallest movement worth making with a key", and tying it to
 * one would mean a density change silently retuned the keyboard.
 */
const RESIZE_STEP_PX = 8;
const RESIZE_STEP_COARSE_PX = 32;

/**
 * What to call the screen a path leads to.
 *
 * The names are the ones the sidebar draws, because the announcement's job is to tell
 * somebody they have arrived where they asked to go — "Inbox" after `G I`, not the URL. The
 * table covers the destinations the shell itself navigates to; anything else falls back to
 * the first meaningful segment, which is a worse name than a written one and a much better
 * one than silence.
 */
const SCREEN_NAMES: Readonly<Record<string, string>> = {
  '/my-issues': 'My issues',
  '/inbox': 'Inbox',
  '/pulse': 'Pulse',
  '/drafts': 'Drafts',
  '/search': 'Search',
  '/projects': 'Projects',
  '/initiatives': 'Initiatives',
  '/customers': 'Customers',
  '/dashboards': 'Dashboards',
  '/settings': 'Settings',
};

export function screenNameFor(pathname: string): string {
  const known = SCREEN_NAMES[pathname];
  if (known !== undefined) return known;
  const segments = pathname.split('/').filter((part) => part !== '');
  const last = segments.length > 1 ? segments[segments.length - 1] : segments[0];
  if (last === undefined) return 'Home';
  const spelled = last.replace(/-/g, ' ');
  return spelled.charAt(0).toUpperCase() + spelled.slice(1);
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
  const location = useLocation();
  const { pathname } = location;
  const sidebar = useSidebarChrome();
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
  const syncStatus = useSyncStatus();
  useDesktopNotifications(engine, viewerId);
  useUnreadBadge();
  /**
   * The same count the dock badge gets, drawn on the Inbox row.
   *
   * Through `useWakingQuery` rather than a plain live query for the reason `useUnreadBadge`
   * gives: the number moves without anything being written, because a snoozed row waking is
   * a clock comparison, and a count that only re-ran on a delta would keep a nine-o'clock
   * reminder out of the sidebar all day. Asking twice rather than changing `useUnreadBadge`
   * to return its count — the two answers are the same query against the same in-memory
   * indexes, and the hook that owns the OS badge should not also be the hook the sidebar
   * depends on for a label.
   */
  const inboxUnread = useWakingQuery(unreadCount, ['notification']).count;
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

  /** What the current sitting's opener asked to be told when the composer shuts. */
  const onComposerClosed = useRef<(() => void) | undefined>(undefined);

  const openCreate = useCallback(
    (seed?: IssueComposerSeed, options?: { onClosed?: () => void }) => {
      // Asking for a composer that is already up is asking for something you have. Starting a
      // new sitting here would throw away a half-written issue, so the request is dropped and
      // the dialog on screen keeps the floor. The caller is told, because a screen that opened
      // this on the user's behalf — `/new` — is otherwise left claiming a composer it did not
      // get.
      if (composerUp.current) return false;
      composerUp.current = true;
      currentSitting.current += 1;
      onComposerClosed.current = options?.onClosed;
      setSitting(currentSitting.current);
      setCreateSeed(seed);
      setCreateOpen(true);
      return true;
    },
    [],
  );

  const closeCreate = useCallback(
    (closing: number) => {
      // A create that resolved after the filer had already started the next issue. The
      // dialog they are looking at is not the one asking to close.
      if (closing !== currentSitting.current) return;
      composerUp.current = false;
      setCreateOpen(false);
      setCreateSeed(undefined);
      const closed = onComposerClosed.current;
      onComposerClosed.current = undefined;
      closed?.();
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
        /**
         * Two chords, on purpose, and both of them Linear's.
         *
         * `⌘.` is the one people arrive with and the one that works with a text field
         * focused; `[` is the one that ends up under the left hand of somebody navigating
         * with `j`/`k`, and it costs nothing because no other action in the product binds a
         * bracket. Neither is a component-owned handler: the sidebar is application chrome,
         * so the toggle is an action like any other and appears in the command menu and on
         * the shortcut sheet without either of them being told about it.
         */
        id: 'app.toggleSidebar',
        title: 'Toggle sidebar',
        keys: ['mod+period', '['],
        group: 'General',
        run: () => sidebar.toggleCollapsed(),
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
      {
        id: 'issue.createFullScreen',
        title: 'Create issue full screen',
        keys: ['v'],
        group: 'Issues',
        run: () => openCreate({ fullScreen: true }),
      },
      {
        id: 'issue.createFromTemplate',
        title: 'Create issue from template',
        keys: ['alt+c'],
        group: 'Issues',
        run: () => openCreate({ openTemplatePicker: true }),
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
        title: 'Go to my issues',
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
       *
       * A collapsed sidebar is the same fact arriving a second way: the whole `<nav>` is
       * unmounted rather than hidden, so the anchors are gone for exactly the same reason
       * and the pickers have to be withdrawn for exactly the same reason.
       */
      ...(onSettings || sidebar.collapsed
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
      ...(showCustomers && !onSettings && !sidebar.collapsed
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
      sidebar.collapsed,
      sidebar.toggleCollapsed,
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

  /**
   * Where a route change lands, for the people it currently lands nowhere for.
   *
   * `G I` used to change the entire contents of the pane and say nothing about it: no
   * announcement, and focus still on whatever the last screen had it on — so the next `J`
   * or `K` walked a list that was no longer there. Both halves are one problem, and both
   * halves are fixed here rather than in ninety screens.
   *
   * The pane takes focus itself (`tabIndex={-1}` below), not its first control. Focusing a
   * control would activate whatever is under Enter before the person has read the screen,
   * and this product's screens claim keys of their own the moment focus is inside them.
   * `preventScroll` because the browser's idea of bringing a focused element into view is
   * the opposite of the scroll restoration running in the same commit.
   */
  const viewRef = useRef<HTMLDivElement>(null);
  useScrollRestoration(viewRef, location.key);
  useEffect(() => {
    viewRef.current?.focus({ preventScroll: true });
  }, [pathname]);
  const screenName = useMemo(() => screenNameFor(pathname), [pathname]);

  /**
   * The sidebar's width, and what happens while it is being dragged.
   *
   * The listeners go on the window rather than on the handle, because a pointer moving
   * faster than the layout can follow leaves the handle behind — and a resize that stops
   * when the cursor outruns it is a resize that feels broken at exactly the speed people
   * actually drag. Pointer events rather than mouse events so a trackpad, a pen and a touch
   * screen are one code path.
   *
   * Nothing is written until the drag ends, and every write goes through `setWidth`, which
   * clamps: a sidebar dragged to four pixels is a sidebar nobody can get back without
   * knowing the shortcut.
   */
  const sidebarWidth = sidebar.width ?? DEFAULT_SIDEBAR_WIDTH;
  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // Or the drag selects the sidebar's text on its way past.
      event.preventDefault();
      const originX = event.clientX;
      const originWidth = sidebarWidth;
      const onMove = (move: PointerEvent) => sidebar.setWidth(originWidth + move.clientX - originX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [sidebar, sidebarWidth],
  );

  /**
   * The same resize from the keyboard.
   *
   * A `separator` with `aria-valuenow` that only a pointer can move is a widget that
   * announces itself as adjustable and then is not. This is the activation a native control
   * would have given the element rather than a shortcut — nothing here is reachable from
   * anywhere except this handle, and putting it in the registry would put "Sidebar wider" in
   * the command menu as a command that does nothing unless the handle happens to be focused.
   */
  const resizeByKey = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? RESIZE_STEP_COARSE_PX : RESIZE_STEP_PX;
      if (event.key === 'ArrowLeft') sidebar.setWidth(sidebarWidth - step);
      else if (event.key === 'ArrowRight') sidebar.setWidth(sidebarWidth + step);
      else if (event.key === 'Home') sidebar.setWidth(MIN_SIDEBAR_WIDTH);
      else if (event.key === 'End') sidebar.setWidth(MAX_SIDEBAR_WIDTH);
      else return;
      event.preventDefault();
    },
    [sidebar, sidebarWidth],
  );

  /*
   * One badge and one collapse control, rendered by the shell and handed to whichever
   * navigation is on screen.
   *
   * Both are facts about the application rather than about either navigation, and the badge
   * in particular was mounted inside the workspace `<nav>` — so "Offline", "Reconnecting" and
   * "Syncing 3" were invisible on all thirty-one settings screens, which are the screens
   * whose saves are single deliberate writes and therefore the worst ones to lose in silence.
   */
  const connectionIndicator = <ConnectionIndicator />;
  const collapseControl = (
    <IconButton
      aria-label="Collapse sidebar"
      tooltip="Collapse sidebar"
      keys="mod+period"
      size="sm"
      icon={<CollapseGlyph />}
      onClick={() => sidebar.toggleCollapsed()}
    />
  );

  const shellStyle = (
    sidebar.collapsed
      ? { '--sidebar-width': '0px' }
      : sidebar.width === null
        ? {}
        : { '--sidebar-width': `${sidebar.width}px` }
  ) as CSSProperties;

  return (
    <CreateIssueProvider value={{ open: openCreate }}>
      <div
        className={[styles.shell, sidebar.collapsed ? styles.shellCollapsed : null]
          .filter(Boolean)
          .join(' ')}
        style={shellStyle}
      >
        {/*
          What a screen change says out loud.

          Named, polite and permanently mounted: a live region inserted at the moment it has
          something to announce is a live region assistive technology has not been watching.
        */}
        <span className={styles.routeStatus} role="status" aria-live="polite">
          {screenName}
        </span>

        {sidebar.collapsed ? (
          /*
            The way back, once the sidebar is gone.

            Unmounting the navigation rather than hiding it is what keeps a closed sidebar
            genuinely closed — no tab stops, no links a screen reader still walks — and the
            cost of that is that the control which brings it back cannot live inside it. So
            it floats over the top-left of the pane, which is where the sidebar was.
          */
          <IconButton
            aria-label="Show sidebar"
            tooltip="Show sidebar"
            keys="mod+period"
            size="sm"
            className={styles.showSidebar}
            icon={<CollapseGlyph />}
            onClick={() => sidebar.toggleCollapsed()}
          />
        ) : null}

        {sidebar.collapsed ? null : onSettings ? (
          <SettingsNav
            showMemberSettings={showMemberSettings}
            showAdminSettings={showAdminSettings}
            workspaceName={workspace?.name ?? 'Polaris'}
            workspaceLogoUrl={workspace?.logoUrl}
            status={connectionIndicator}
            collapseControl={collapseControl}
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
              {connectionIndicator}
              {collapseControl}
              <Menu
                open={workspaceMenu.open}
                onClose={workspaceMenu.hide}
                trigger={workspaceMenu.ref}
                label="Workspace menu"
                items={workspaceItems}
              />
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...labelMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...userMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...issueMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...projectMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...teamMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...viewMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...documentMenu.props}
              >
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
              <button
                type="button"
                tabIndex={-1}
                className={styles.gotoTrigger}
                {...favoriteMenu.props}
              >
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
                  <button
                    type="button"
                    tabIndex={-1}
                    className={styles.gotoTrigger}
                    {...customerMenu.props}
                  >
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
                <span className={navStyles.navLabel}>My issues</span>
              </NavLink>
              <NavLink to="/inbox" className={navClass}>
                <NavGlyph name="inbox" />
                <span className={navStyles.navLabel}>Inbox</span>
                <NavCount value={inboxUnread} label="unread" />
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

            {viewerId !== null && <FavoritesSection userId={viewerId} sidebar={sidebar} />}

            <NavSection
              id="teams"
              title="Teams"
              open={sidebar.isOpen('teams', true)}
              onToggle={() => sidebar.toggleSection('teams', true)}
            >
              {/*
                A workspace with no teams in it is two different situations, and a sidebar
                that draws nothing cannot tell them apart. Until the first snapshot lands
                this list is empty because it has not arrived, not because it is empty —
                which in a local-first client is the ordinary case on a cold boot, and
                exactly the case `EmptyState` warns against painting as "nothing here".
              */}
              {teamTree.roots.length === 0 && syncStatus.phase !== 'ready' ? (
                <SkeletonRows count={3} height="var(--control-height-md)" />
              ) : (
                teamTree.roots.map((team) => (
                  <TeamNavItems
                    key={team.id}
                    team={team}
                    depth={0}
                    childrenByParent={teamTree.childrenByParent}
                    sidebar={sidebar}
                  />
                ))
              )}
            </NavSection>

            {views.length > 0 && (
              <NavSection
                id="views"
                title="Views"
                open={sidebar.isOpen('views', true)}
                onToggle={() => sidebar.toggleSection('views', true)}
              >
                {views.map((view) => (
                  <NavLink key={view.id} to={viewPath(view)} className={navClass}>
                    <NavGlyph name="view" />
                    <span className={navStyles.navLabel}>{view.name}</span>
                  </NavLink>
                ))}
              </NavSection>
            )}
          </nav>
        )}

        {sidebar.collapsed ? null : (
          /*
            The edge between the two panes, made draggable.

            A `separator` rather than a slider: it divides two regions and its value is the
            division, which is what the role is for. Focusable and arrow-operable because a
            widget that announces `aria-valuenow` and only answers a pointer has told an
            assistive-technology user about an adjustment they cannot make.

            It is drawn over the sidebar's own border rather than taking a grid column of its
            own, so the columns stay `var(--sidebar-width) 1fr` and the transition below has
            two values to move between rather than four.
          */
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuenow={sidebarWidth}
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            tabIndex={0}
            className={styles.resizeHandle}
            onPointerDown={startResize}
            onKeyDown={
              /* keymap-lint-allow: the arrow keys a separator widget owns natively */ resizeByKey
            }
          />
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
          <div key={pathname} ref={viewRef} tabIndex={-1} className={styles.view}>
            {children}
          </div>
        </main>

        {/* Renders nothing until the desktop shell says a build has finished downloading. */}
        <UpdateBanner />
        <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
        <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
        {/*
          Mounted whether or not it is open, and told which it is, the way `Peek` is mounted
          by the list. A dialog cannot animate its own removal from a tree it has already
          left, and unmounting on `createOpen` is what left the product's most-used modal
          hard-cutting while every other one fades.

          Still keyed by the sitting: asking for a new issue while one is on screen replaces
          the dialog rather than leaving the filed issue's title sitting in the field.
        */}
        <Fragment key={sitting}>
          {renderCreateIssue?.({
            open: createOpen,
            onClose: () => closeCreate(sitting),
            seed: createSeed,
          })}
        </Fragment>
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

/**
 * A team, and the screens inside it.
 *
 * A team was one link. Linear's is a disclosure, and the difference is not decoration: the
 * screens under a team are the ones somebody works in all day — the issue list, what is
 * active, the backlog, the cycle — and reaching any of them meant landing on the team's home
 * page first and finding the tab. So the row grew a chevron.
 *
 * Closed by default, unlike the three top-level sections, because a workspace with nine
 * teams expanded is a sidebar nobody can see the bottom of, which is the problem the
 * disclosure was added to solve rather than a state to start in.
 *
 * Every destination here is a route that exists — `/team/:key`, `/projects`, `/cycles`,
 * `/triage` in `App.tsx`, plus Active and Backlog, which are the same list under the URL's
 * own filter grammar and go through `teamIssuePaths` rather than inventing a second spelling
 * of it. Cycles and Triage are drawn only where the team runs them: a link to a cadence a
 * team has switched off is a link to a screen explaining that it is switched off.
 */
function TeamNavItems({
  team,
  depth,
  childrenByParent,
  sidebar,
}: {
  team: Team;
  depth: number;
  childrenByParent: ReadonlyMap<UUID, Team[]>;
  sidebar: SidebarChrome;
}) {
  const children = childrenByParent.get(team.id) ?? [];
  const sectionId = `team:${team.id}`;
  const open = sidebar.isOpen(sectionId, false);
  const triageWaiting = useLiveQuery(
    (store) => triageQueueCount(store, team.id),
    ['issue', 'workflowState'],
    [team.id],
  );
  const indent = (level: number) =>
    level > 0 ? { paddingInlineStart: `calc(var(--space-3) * ${level + 1})` } : undefined;

  return (
    <>
      <div className={styles.teamRow} style={indent(depth)}>
        <button
          type="button"
          className={styles.teamDisclosure}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${team.name}`}
          onClick={() => sidebar.toggleSection(sectionId, false)}
        >
          <NavChevron open={open} />
        </button>
        <NavLink
          to={`/team/${team.key}/home`}
          className={({ isActive }) => `${navClass({ isActive })} ${styles.teamLink ?? ''}`}
        >
          <span className={styles.teamKey}>{team.key}</span>
          <span className={navStyles.navLabel}>{team.name}</span>
        </NavLink>
      </div>
      {open ? (
        /* Named after the team, because these rows repeat their labels across every team in
           the sidebar: "Projects" under Engineering and "Projects" under Design are two
           different destinations wearing one word, and the group is what tells them apart to
           anybody not reading the indentation. */
        <div role="group" aria-label={team.name} className={navStyles.section}>
          <NavLink to={`/team/${team.key}`} end className={navClass} style={indent(depth + 1)}>
            <span className={navStyles.navLabel}>Issues</span>
          </NavLink>
          <TeamFilteredLink team={team} label="Active" depth={depth + 1} to={pathToActiveIssues} />
          <TeamFilteredLink
            team={team}
            label="Backlog"
            depth={depth + 1}
            to={pathToBacklogIssues}
          />
          <NavLink to={`/team/${team.key}/projects`} className={navClass} style={indent(depth + 1)}>
            <span className={navStyles.navLabel}>Projects</span>
          </NavLink>
          {team.cyclesEnabled ? (
            <NavLink to={`/team/${team.key}/cycles`} className={navClass} style={indent(depth + 1)}>
              <span className={navStyles.navLabel}>Cycles</span>
            </NavLink>
          ) : null}
          {team.triageEnabled || triageWaiting > 0 ? (
            <NavLink to={`/team/${team.key}/triage`} className={navClass} style={indent(depth + 1)}>
              <span className={navStyles.navLabel}>Triage</span>
              <NavCount value={triageWaiting} label="waiting" />
            </NavLink>
          ) : null}
        </div>
      ) : null}
      {children.map((child) => (
        <TeamNavItems
          key={child.id}
          team={child}
          depth={depth + 1}
          childrenByParent={childrenByParent}
          sidebar={sidebar}
        />
      ))}
    </>
  );
}

/**
 * Active and Backlog, which are the team's issue list under a filter rather than routes of
 * their own — the same URL grammar somebody would get by typing the filter into the bar, so
 * the row and the link they would share with a colleague are the same string.
 */
function TeamFilteredLink({
  team,
  label,
  depth,
  to,
}: {
  team: Team;
  label: string;
  depth: number;
  to: (store: Store, pathname: string) => string;
}) {
  const href = useLiveQuery((store) => to(store, `/team/${team.key}`), ['team'], [team.key, label]);
  return (
    <NavLink
      to={href}
      className={navClass}
      style={depth > 0 ? { paddingInlineStart: `calc(var(--space-3) * ${depth + 1})` } : undefined}
    >
      <span className={navStyles.navLabel}>{label}</span>
    </NavLink>
  );
}

/**
 * A count riding at the end of a nav row.
 *
 * Zero renders nothing rather than "0": a row that says there is nothing waiting is a row
 * that has to be read to learn that, and the absence already says it. The unit is in the
 * accessible name because "Inbox, 9" is ambiguous out loud and "Inbox, 9 unread" is not.
 */
function NavCount({ value, label }: { value: number; label: string }) {
  if (value <= 0) return null;
  return (
    <span className={navStyles.navCount} aria-label={`${value} ${label}`}>
      {value}
    </span>
  );
}

/** The sidebar toggle's glyph: a pane with its leading column marked. */
function CollapseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <path d="M6.5 3v10" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}

const FAVORITE_DRAG = 'text/polaris-favorite';

/**
 * The viewer's favourites: folders, loose rows, and the two ways of moving one.
 *
 * The section used to disappear entirely when there was nothing in it — and the only control
 * that could create a folder lived inside the block that guard hid, so `creating` could never
 * become true from an empty state and the folder feature was unreachable until a favourite
 * arrived by some other route. The header stays now, with a line saying what would be here.
 */
function FavoritesSection({ userId, sidebar }: { userId: UUID; sidebar: SidebarChrome }) {
  const engine = useEngine();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  /** Which container the pointer is currently over, `null` being the unfiled one. */
  const [dropTarget, setDropTarget] = useState<UUID | null | undefined>(undefined);
  const nav = useLiveQuery(
    (store) => favoriteNav(store, userId),
    ['favorite', 'view', 'team', 'issue', 'label'],
    [userId],
  );

  const open = sidebar.isOpen('favourites', true);
  const empty = nav.folders.length === 0 && nav.unfiled.length === 0;

  /**
   * Which favourite the keyboard is on.
   *
   * A ref rather than state: nothing renders differently for it — the focus ring already
   * says which row this is — and re-rendering the whole section on every arrow key through
   * the sidebar would be a re-render per keystroke for no visible change.
   */
  const focused = useRef<UUID | null>(null);

  const siblingsOf = useCallback(
    (id: UUID): readonly FavoriteLink[] => {
      const folder = nav.folders.find((row) => row.items.some((item) => item.id === id));
      return folder?.items ?? nav.unfiled;
    },
    [nav],
  );

  /**
   * Moving the focused favourite one place, from the keyboard.
   *
   * Within its own container rather than across the whole list, because that is the move the
   * user can see: a row leaving a folder is what dragging is for, and a keystroke that
   * silently refiled something would be a different command wearing the same key.
   */
  const nudge = useCallback(
    (direction: -1 | 1) => {
      const id = focused.current;
      if (id === null) return;
      const siblings = siblingsOf(id);
      const index = siblings.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= siblings.length) return;
      const afterId =
        direction === -1 ? (siblings[target - 1]?.id ?? null) : (siblings[target]?.id ?? null);
      const beforeId =
        direction === -1 ? (siblings[target]?.id ?? null) : (siblings[target + 1]?.id ?? null);
      void reorderFavorite(engine, id, afterId, beforeId);
    },
    [engine, siblingsOf],
  );

  useActions(
    [
      {
        id: 'favorite.moveUp',
        title: 'Move favourite up',
        keys: ['mod+ArrowUp'],
        group: 'Navigation',
        // Not `available`: the shortcut belongs on the sheet whether or not a favourite
        // happens to be focused right now, and "focus a favourite first" is the answer
        // somebody looking it up came for. See the note on the two predicates in keys/types.
        enabled: () => focused.current !== null,
        run: () => nudge(-1),
      },
      {
        id: 'favorite.moveDown',
        title: 'Move favourite down',
        keys: ['mod+ArrowDown'],
        group: 'Navigation',
        enabled: () => focused.current !== null,
        run: () => nudge(1),
      },
    ],
    [nudge],
  );

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
    setDropTarget(undefined);
    const id = event.dataTransfer.getData(FAVORITE_DRAG);
    if (id === '') return;
    void moveFavorite(engine, id, folderId);
  };

  /**
   * What a container does while something is over it.
   *
   * `dropEffect` is set on every `dragover` rather than once on `dragstart`, because the
   * browser resets it per event — without this the cursor shows the "no drop" glyph over a
   * target that will happily accept the row, which reads as the feature not working.
   */
  const dropProps = (folderId: UUID | null) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move' as const;
    },
    onDragEnter: () => setDropTarget(folderId),
    onDragLeave: () => setDropTarget((current) => (current === folderId ? undefined : current)),
    onDrop: onDropOn(folderId),
    ...(dropTarget === folderId ? { 'data-drop-active': '' } : null),
  });

  return (
    <NavSection
      id="favourites"
      title="Favourites"
      open={open}
      onToggle={() => sidebar.toggleSection('favourites', true)}
      action={
        <IconButton
          aria-label="New folder"
          tooltip="New folder"
          size="sm"
          icon={<PlusGlyph />}
          onClick={() => {
            if (!open) sidebar.toggleSection('favourites', true);
            setCreating(true);
          }}
        />
      }
    >
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

      {empty && !creating ? (
        <p className={styles.favoritesHint}>Star a view, team or issue to keep it here</p>
      ) : null}

      {nav.folders.map((folder) => (
        <div key={folder.id} className={styles.folder} {...dropProps(folder.id)}>
          <FolderHeader
            folder={folder}
            onRename={(name) => void renameFavoriteFolder(engine, folder.id, name)}
            onDelete={() => {
              void removeFavorite(engine, userId, 'folder', folder.id);
              // The rows that were in it are favourites in their own right and survive as
              // unfiled ones, so what the undo has to put back is the folder. It cannot
              // refile them: `createFavoriteFolder` resolves to nothing, so there is no id
              // to move them into until the server's delta arrives.
              offerUndo({
                label: `Deleted ${folder.name}`,
                undo: () => createFavoriteFolder(engine, userId, folder.name),
              });
            }}
          />
          {folder.items.map((item) => (
            <FavoriteItem key={item.id} item={item} focused={focused} />
          ))}
        </div>
      ))}

      {/*
        Where a favourite goes to leave a folder.

        It was a bare `<div>` whose only children were the unfiled rows, so with nothing
        unfiled it had no height and could not be hit — a row could be dragged into a folder
        and never dragged back out. It keeps a row's worth of height whether or not anything
        is in it, and says so when something is over it.
      */}
      <div
        role="group"
        aria-label="Unfiled favourites"
        className={styles.unfiled}
        {...dropProps(null)}
      >
        {nav.unfiled.map((item) => (
          <FavoriteItem key={item.id} item={item} focused={focused} />
        ))}
      </div>
    </NavSection>
  );
}

/**
 * A folder's name and the two things that can be done to it.
 *
 * Both used to be permanently visible text buttons beside a permanently live borderless
 * input: the name looked like static text, was a Tab stop per folder, renamed on blur after
 * any stray keystroke, and "Delete" was wired straight to the mutation with no confirmation
 * and no undo. So the name is a `<span>` until Rename is chosen, the actions are behind one
 * `…` revealed on hover or focus, and the delete asks first and offers the way back after.
 */
function FolderHeader({
  folder,
  onRename,
  onDelete,
}: {
  folder: FavoriteFolderNav;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const menu = useMenuTrigger();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [confirming, setConfirming] = useState(false);

  const commit = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === folder.name) {
      setName(folder.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div className={styles.folderHeader}>
      {renaming ? (
        <form
          className={styles.folderName}
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <input
            className={styles.folderInput}
            aria-label={`Rename ${folder.name}`}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
          />
        </form>
      ) : (
        <span className={styles.folderName}>{folder.name}</span>
      )}

      <IconButton
        aria-label={`${folder.name} folder actions`}
        tooltip="Folder actions"
        size="sm"
        className={styles.folderMenu}
        icon={<MoreGlyph />}
        {...menu.props}
      />
      <Menu
        open={menu.open}
        onClose={menu.hide}
        trigger={menu.ref}
        label={`${folder.name} folder actions`}
        items={[
          { id: 'rename', label: 'Rename', onSelect: () => setRenaming(true) },
          { id: 'delete', label: 'Delete', danger: true, onSelect: () => setConfirming(true) },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        title={`Delete ${folder.name}?`}
        consequence={
          folder.items.length === 0
            ? 'The folder goes. Nothing else changes.'
            : `The folder goes and its ${folder.items.length} favourites move back to the sidebar. Nothing is unfavourited.`
        }
        confirmLabel="Delete folder"
        destructive
        onConfirm={() => {
          setConfirming(false);
          onDelete();
        }}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

function FavoriteItem({
  item,
  focused,
}: {
  item: FavoriteLink;
  focused: { current: UUID | null };
}) {
  return (
    <NavLink
      to={item.to}
      className={navClass}
      draggable
      onFocus={() => {
        focused.current = item.id;
      }}
      onBlur={() => {
        if (focused.current === item.id) focused.current = null;
      }}
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
 * Moves a favourite in the sidebar's manual order.
 *
 * Here rather than beside `moveFavorite` in `features/view/mutations.ts` because that
 * function expresses one thing deliberately — which folder a favourite sits in — and returns
 * early when the folder has not changed, which is every keyboard reorder. `MoveFavoriteInput`
 * already carries `afterFavoriteId`, so the server needs nothing new; what is local is the
 * optimistic key, minted the same way `reorderIssue` mints one so the row moves on the
 * keystroke rather than a round trip later. A gap the local neighbours no longer straddle
 * mints nothing and the move is dropped rather than landing the row somewhere nobody asked
 * for — the server's delta is the tie-break.
 */
async function reorderFavorite(
  engine: SyncEngine,
  id: UUID,
  afterId: UUID | null,
  beforeId: UUID | null,
): Promise<void> {
  const before = engine.store.get('favorite', id);
  if (before === undefined) return;
  const lower = afterId === null ? '' : (engine.store.get('favorite', afterId)?.position ?? '');
  const upper = beforeId === null ? '' : (engine.store.get('favorite', beforeId)?.position ?? '');
  const position = orderKeyBetween(lower, upper);
  if (position === null || position === before.position) return;

  const after: Favorite = { ...before, position, updatedAt: new Date().toISOString() };
  try {
    await engine.mutate({
      mutation: MOVE_FAVORITE,
      variables: {
        input: {
          id,
          ...(before.folderId === undefined
            ? { clearFolder: true }
            : { folderId: before.folderId }),
          ...(afterId === null ? null : { afterFavoriteId: afterId }),
        },
      },
      optimistic: [{ type: 'favorite', id, before, after }],
    });
  } catch {
    // The optimistic row is rolled back by the engine; what is left to do is say so, because
    // a favourite that springs back to where it was with no explanation reads as a bug in
    // the keystroke rather than as a refusal.
    offerError({ title: 'Could not move that favourite' });
  }
}

/** The plus on the Favourites header. */
function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

/** The overflow affordance on a folder row. */
function MoreGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
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

/** What the badge currently says, or `null` for the states it stays quiet about. */
interface SyncReport {
  readonly text: string;
  readonly title: string;
  /** The tone class, or undefined for the neutral states. */
  readonly tone: string | undefined;
  /**
   * What went wrong, when something did.
   *
   * Present only for the failed phase, and its presence is what turns the badge into a
   * button. The message used to live in a `title` attribute — invisible to a keyboard, a
   * touch screen and a screen reader alike — beside a word, "Offline", that stated a problem
   * and offered nothing to do about it.
   */
  readonly error?: string;
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
    return {
      text: 'Offline',
      title: 'Offline',
      tone: styles.statusError,
      error: status.error,
    };
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
  const engine = useEngine();
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
      {...exitProps}
    >
      {shown.error === undefined ? (
        shown.text
      ) : (
        /*
          A failure is the one state here that is worth doing something about, so it is the
          one state that is a control.

          The reason goes in the accessible name rather than in a `title`, because `title` is
          a tooltip a mouse can find and nothing else can — and this is precisely the moment
          a person needs to know whether the network went or the server refused them. Reused
          as the visible tooltip too, so the two channels say the same sentence.
        */
        <button
          type="button"
          className={styles.statusRetry}
          aria-label={`Offline. ${shown.error}. Try connecting again`}
          title={shown.error}
          onClick={() => {
            // `start` re-opens the replica and reconnects the socket, and publishes its own
            // failure back into this status if it goes wrong again — so there is nothing to
            // report here that the badge will not say for itself a moment later.
            void engine.start().catch(() => undefined);
          }}
        >
          {shown.text}
        </button>
      )}
    </span>
  );
}
