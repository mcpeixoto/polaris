/**
 * The application shell: sidebar, main pane, and the surfaces that float above both.
 *
 * The global actions are registered here because they are the ones that exist regardless
 * of what is on screen — open the command menu, show help, create an issue, navigate.
 * Screen-specific actions register themselves as their screen mounts, so the command menu
 * offers what is actually available rather than a fixed list that fails when chosen.
 */

import {
  useCallback,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import { useDesktopNotifications } from '~/features/inbox/desktop';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import { Menu } from '~/components';
import { gotoLabelItems, labelViewPath, userViewPath } from '~/features/labels/labelView';
import { personName } from '~/features/prefs/prefs';
import { CreateIssueProvider } from '~/features/issue/create-context';
import { type IssueComposerSeed } from '~/features/issue/create-url';
import {
  createFavoriteFolder,
  moveFavorite,
  removeFavorite,
  renameFavoriteFolder,
} from '~/features/view/mutations';
import type { Document, Favorite, Store, Team, UUID, View } from '~/store';

import { useWorkspaceSession } from './Boot';
import { useEngine, useQuery, useSyncStatus } from './context';
import { useActions } from './keymap';
import { CommandMenu } from './CommandMenu';
import { HelpOverlay } from './HelpOverlay';
import { pathToActiveIssues, pathToBacklogIssues } from './teamIssuePaths';
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

  const teams = useQuery(
    (store) => [...store.teams.values()].filter((team) => team.retiredAt === undefined),
    ['team'],
  );
  const teamTree = useMemo(() => buildTeamTree(teams), [teams]);
  const workspace = useQuery((store) => [...store.workspaces.values()][0], ['workspace']);
  const cyclesPath = useQuery((store) => pathToCycles(store), ['team', 'cycle']);
  const triagePath = useQuery((store) => pathToTriage(store), ['team']);
  const archivesPath = useQuery((store) => pathToArchives(store), ['team']);

  const viewerId = useViewerId();
  const viewer = useViewer();
  const engine = useEngine();
  useDesktopNotifications(engine, viewerId);
  const showCustomers =
    viewer !== null &&
    viewer.role !== 'guest' &&
    (workspace === undefined || workspace.customerRequestsEnabled);
  const showDashboards = showCustomers;
  const showPulse =
    (viewer === null || viewer.role !== 'guest') &&
    (workspace === undefined || workspace.pulseEnabled);
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
    setCreateOpen(false);
    setCreateSeed(undefined);
    setCreateProjectOpen(false);
    setCreateInitiativeOpen(false);
    setCreateCustomerOpen(false);
    setCreateCustomerRequestOpen(false);
    setCreateDashboardOpen(false);
  }, []);

  const openCreate = useCallback((seed?: IssueComposerSeed) => {
    setCreateSeed(seed);
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateSeed(undefined);
    if (pathname === '/new' || /\/team\/[^/]+\/new$/.test(pathname)) {
      void navigate('/');
    }
  }, [navigate, pathname]);

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
      ...(showCustomers
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
      ...(showDashboards
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
      ...(showCustomers
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
        id: 'nav.settings',
        title: 'Go to workspace settings',
        keys: ['g s'],
        group: 'Navigation',
        run: () => navigate('/settings/workspace'),
      },
      {
        id: 'nav.profile',
        title: 'Go to Profile',
        group: 'Navigation',
        run: () => navigate('/settings/profile'),
      },
      {
        id: 'nav.projectStatuses',
        title: 'Go to Project statuses',
        group: 'Navigation',
        run: () => navigate('/settings/project-statuses'),
      },
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
      {
        id: 'nav.customerRequests',
        title: 'Go to Customer requests',
        group: 'Navigation',
        run: () => navigate('/settings/customers'),
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
      {
        id: 'nav.initiatives',
        title: 'Go to Initiatives',
        group: 'Navigation',
        run: () => navigate('/initiatives'),
      },
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
      {
        id: 'nav.trash',
        title: 'Go to trash',
        group: 'Navigation',
        run: () => navigate('/settings/trash'),
      },
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
      showPulse,
      engine,
      pathname,
    ],
  );

  const workspaceItems = session.workspaces.map((item) => ({
    id: item.id,
    label: item.name,
    selected: item.id === session.currentId,
    onSelect: () => {
      if (item.id === session.currentId) return;
      void session.switchTo(item.id);
    },
  }));

  return (
    <CreateIssueProvider value={{ open: openCreate }}>
      <div className={styles.shell}>
        <nav className={styles.sidebar} aria-label="Workspace">
          <div className={styles.workspace}>
            <button
              type="button"
              className={styles.workspaceSwitch}
              {...workspaceMenu.props}
              aria-label="Switch workspace"
            >
              <span className={styles.workspaceMark} aria-hidden="true">
                {(workspace?.name ?? 'P').slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.workspaceName}>{workspace?.name ?? 'Polaris'}</span>
            </button>
            <ConnectionIndicator />
            <Menu
              open={workspaceMenu.open}
              onClose={workspaceMenu.hide}
              trigger={workspaceMenu.ref}
              label="Workspaces"
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
                label: item.groupName === undefined ? item.name : `${item.groupName}: ${item.name}`,
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

          <div className={styles.section}>
            <NavLink to="/my-issues" className={navClass}>
              <NavGlyph name="issues" />
              <span className={styles.navLabel}>My Issues</span>
            </NavLink>
            <NavLink to="/inbox" className={navClass}>
              <NavGlyph name="inbox" />
              <span className={styles.navLabel}>Inbox</span>
            </NavLink>
            {showPulse && (
              <NavLink to="/pulse" className={() => navClass({ isActive: onPulse })}>
                <NavGlyph name="pulse" />
                <span className={styles.navLabel}>Pulse</span>
              </NavLink>
            )}
            <NavLink to="/drafts" className={navClass}>
              <NavGlyph name="drafts" />
              <span className={styles.navLabel}>Drafts</span>
            </NavLink>
            <NavLink to="/search" className={navClass}>
              <NavGlyph name="search" />
              <span className={styles.navLabel}>Search</span>
            </NavLink>
            <NavLink to="/projects" className={() => navClass({ isActive: onProjects })}>
              <NavGlyph name="project" />
              <span className={styles.navLabel}>Projects</span>
            </NavLink>
            <NavLink to="/initiatives" className={() => navClass({ isActive: onInitiatives })}>
              <NavGlyph name="initiative" />
              <span className={styles.navLabel}>Initiatives</span>
            </NavLink>
            {showCustomers && (
              <NavLink to="/customers" className={() => navClass({ isActive: onCustomers })}>
                <NavGlyph name="customer" />
                <span className={styles.navLabel}>Customers</span>
              </NavLink>
            )}
            {showDashboards && (
              <NavLink to="/dashboards" className={() => navClass({ isActive: onDashboards })}>
                <NavGlyph name="dashboard" />
                <span className={styles.navLabel}>Dashboards</span>
              </NavLink>
            )}
            <NavLink to={cyclesPath} className={() => navClass({ isActive: onCycles })}>
              <NavGlyph name="cycle" />
              <span className={styles.navLabel}>Cycles</span>
            </NavLink>
          </div>

          {viewerId !== null && <FavoritesSection userId={viewerId} />}

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Teams</h2>
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
            <NavLink to="/settings/profile" className={navClass}>
              <NavGlyph name="members" />
              <span className={styles.navLabel}>Profile</span>
            </NavLink>
            <NavLink to="/settings/preferences" className={navClass}>
              <NavGlyph name="prefs" />
              <span className={styles.navLabel}>Preferences</span>
            </NavLink>
            <NavLink to="/settings/workspace" className={navClass}>
              <NavGlyph name="apps" />
              <span className={styles.navLabel}>Workspace</span>
            </NavLink>
            <NavLink to="/settings/members" className={navClass}>
              <NavGlyph name="members" />
              <span className={styles.navLabel}>Members</span>
            </NavLink>
            <NavLink to="/settings/labels" className={navClass}>
              <NavGlyph name="labels" />
              <span className={styles.navLabel}>Labels</span>
            </NavLink>
            <NavLink to="/settings/project-labels" className={navClass}>
              <NavGlyph name="labels" />
              <span className={styles.navLabel}>Project labels</span>
            </NavLink>
            <NavLink to="/settings/project-statuses" className={navClass}>
              <NavGlyph name="project" />
              <span className={styles.navLabel}>Project statuses</span>
            </NavLink>
            <NavLink to="/settings/project-updates" className={navClass}>
              <NavGlyph name="bell" />
              <span className={styles.navLabel}>Project updates</span>
            </NavLink>
            <NavLink to="/settings/pulse" className={navClass}>
              <NavGlyph name="pulse" />
              <span className={styles.navLabel}>Pulse</span>
            </NavLink>
            <NavLink to="/settings/customers" className={navClass}>
              <NavGlyph name="customer" />
              <span className={styles.navLabel}>Customer requests</span>
            </NavLink>
            <NavLink to="/settings/slas" className={navClass}>
              <NavGlyph name="bell" />
              <span className={styles.navLabel}>SLAs</span>
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
            <NavLink to="/settings/mcp" className={navClass}>
              <NavGlyph name="key" />
              <span className={styles.navLabel}>MCP</span>
            </NavLink>
            <NavLink to="/settings/asks" className={navClass}>
              <NavGlyph name="template" />
              <span className={styles.navLabel}>Asks</span>
            </NavLink>
            <NavLink to="/settings/oauth-apps" className={navClass}>
              <NavGlyph name="apps" />
              <span className={styles.navLabel}>OAuth apps</span>
            </NavLink>
            <NavLink to="/settings/integrations" className={navClass}>
              <NavGlyph name="apps" />
              <span className={styles.navLabel}>Integrations</span>
            </NavLink>
            <NavLink to="/settings/webhooks" className={navClass}>
              <NavGlyph name="webhook" />
              <span className={styles.navLabel}>Webhooks</span>
            </NavLink>
            <NavLink to="/settings/github" className={navClass}>
              <NavGlyph name="github" />
              <span className={styles.navLabel}>GitHub</span>
            </NavLink>
            <NavLink to="/settings/gitlab" className={navClass}>
              <NavGlyph name="gitlab" />
              <span className={styles.navLabel}>GitLab</span>
            </NavLink>
            <NavLink to="/settings/sentry" className={navClass}>
              <NavGlyph name="sentry" />
              <span className={styles.navLabel}>Sentry</span>
            </NavLink>
            <NavLink to="/settings/slack" className={navClass}>
              <NavGlyph name="slack" />
              <span className={styles.navLabel}>Slack</span>
            </NavLink>
            <NavLink to="/settings/export" className={navClass}>
              <NavGlyph name="export" />
              <span className={styles.navLabel}>Export</span>
            </NavLink>
            <NavLink to="/settings/trash" className={navClass}>
              <NavGlyph name="trash" />
              <span className={styles.navLabel}>Trash</span>
            </NavLink>
            <NavLink to="/settings/deleted-teams" className={navClass}>
              <NavGlyph name="trash" />
              <span className={styles.navLabel}>Deleted teams</span>
            </NavLink>
          </div>
        </nav>

        <main className={styles.main}>{children}</main>

        <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
        <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
        {createOpen && renderCreateIssue?.({ onClose: closeCreate, seed: createSeed })}
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
        <span className={styles.navLabel}>{team.name}</span>
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

// CSS-module lookups are `string | undefined` under noUncheckedIndexedAccess, so classes
// are composed by filtering rather than by interpolation — a missing class should drop
// out, not render the literal "undefined" into the DOM.
function navClass({ isActive }: { isActive: boolean }): string {
  return [styles.navItem, isActive ? styles.navItemActive : null].filter(Boolean).join(' ');
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
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Favourites
        <button type="button" className={styles.folderAction} onClick={() => setCreating(true)}>
          New folder
        </button>
      </h2>

      {creating ? (
        <form className={styles.folderCreate} onSubmit={submitFolder}>
          <input
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
      <span className={styles.navLabel}>{item.label}</span>
    </NavLink>
  );
}

type NavGlyphName =
  | 'issues'
  | 'inbox'
  | 'pulse'
  | 'drafts'
  | 'search'
  | 'project'
  | 'initiative'
  | 'customer'
  | 'dashboard'
  | 'cycle'
  | 'view'
  | 'members'
  | 'labels'
  | 'bell'
  | 'template'
  | 'key'
  | 'apps'
  | 'webhook'
  | 'github'
  | 'gitlab'
  | 'sentry'
  | 'slack'
  | 'export'
  | 'prefs'
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
          <path
            d="M2.5 8.5 4.2 3.8A1.5 1.5 0 0 1 5.6 3h4.8a1.5 1.5 0 0 1 1.4.8L13.5 8.5"
            {...stroke}
          />
          <path
            d="M2.5 8.5h2.6l.8 1.8h4.2l.8-1.8h2.6V12a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2.5 12V8.5Z"
            {...stroke}
          />
        </>
      );
    case 'pulse':
      return (
        <>
          <path d="M2.5 8h2.2l1.3-3.5 2.2 7 1.6-4.2H13.5" {...stroke} />
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
    case 'initiative':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" {...stroke} />
          <circle cx="8" cy="8" r="2" {...stroke} />
          <path d="M8 2.75v2M8 11.25v2M2.75 8h2M11.25 8h2" {...stroke} />
        </>
      );
    case 'customer':
      return (
        <>
          <rect x="2.5" y="4.5" width="11" height="9" rx="1.5" {...stroke} />
          <path d="M5.5 4.5V3.5A2.5 2.5 0 0 1 10.5 3.5V4.5M6 9.5h4" {...stroke} />
        </>
      );
    case 'dashboard':
      return (
        <>
          <rect x="2.5" y="2.5" width="4.75" height="4.75" rx="0.75" {...stroke} />
          <rect x="8.75" y="2.5" width="4.75" height="4.75" rx="0.75" {...stroke} />
          <rect x="2.5" y="8.75" width="4.75" height="4.75" rx="0.75" {...stroke} />
          <rect x="8.75" y="8.75" width="4.75" height="4.75" rx="0.75" {...stroke} />
        </>
      );
    case 'cycle':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" {...stroke} />
          <path d="M8 5.25V8l2 1.5" {...stroke} />
        </>
      );
    case 'drafts':
      return (
        <>
          <path
            d="M4.5 2.5h5.2L13.5 6.3V13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3.5 13V4A1.5 1.5 0 0 1 4.5 2.5Z"
            {...stroke}
          />
          <path d="M9.5 2.5V6h3.5M6 9h4M6 11.5h2.5" {...stroke} />
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
          <path
            d="M2.5 8.2 8.2 2.5h4.3A1 1 0 0 1 13.5 3.5v4.3L7.8 13.5a1 1 0 0 1-1.4 0L2.5 9.6a1 1 0 0 1 0-1.4Z"
            {...stroke}
          />
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
    case 'apps':
      return (
        <>
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" {...stroke} />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" {...stroke} />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" {...stroke} />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" {...stroke} />
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
    case 'github':
      return (
        <>
          <path d="M8 2.5v7" {...stroke} />
          <path d="M5 6.5 8 9.5l3-3" {...stroke} />
          <path d="M4.5 12.5h7" {...stroke} />
        </>
      );
    case 'gitlab':
      return (
        <>
          <path d="M2.5 10.5 5 4.5 8 10.5 11 4.5 13.5 10.5 8 13.5Z" {...stroke} />
        </>
      );
    case 'sentry':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" {...stroke} />
          <path d="M8 5.25V8.75M8 11v.01" {...stroke} />
        </>
      );
    case 'slack':
      return (
        <>
          <path d="M3.5 5.5h3v3h-3zM9.5 5.5h3v3h-3zM3.5 9.5h3v3h-3zM9.5 9.5h3v3h-3z" {...stroke} />
        </>
      );
    case 'export':
      return (
        <>
          <path d="M8 3.5v6.5M5.5 7.5 8 10l2.5-2.5" {...stroke} />
          <path d="M3.5 12.5h9" {...stroke} />
        </>
      );
    case 'prefs':
      return (
        <>
          <circle cx="5.5" cy="5" r="1.25" {...stroke} />
          <path d="M3 5h1.2M6.8 5H13" {...stroke} />
          <circle cx="10.5" cy="11" r="1.25" {...stroke} />
          <path d="M3 11h6.2M11.8 11H13" {...stroke} />
        </>
      );
    case 'trash':
      return (
        <>
          <path
            d="M3.5 5h9M6 5V3.5h4V5M5 5l.6 7.2A1 1 0 0 0 6.6 13h2.8a1 1 0 0 0 1-.8L11 5"
            {...stroke}
          />
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
    .sort((a, b) => a.position.localeCompare(b.position));

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
    .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
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
