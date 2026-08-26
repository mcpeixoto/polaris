/**
 * Routes.
 *
 * The same routes serve the web app and the Electron shell, so a deep link
 * (`polaris://issue/ENG-123`) maps one-to-one onto a path and the desktop app needs no
 * routing of its own — it translates the URL and hands it to the router here.
 */

import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';

import { Button, EmptyState } from '~/components';
import { useViewerRole } from '~/hooks/useViewer';
import { onDeepLink } from '~/platform/runtime';
import { hasServer } from '~/sync/endpoint';
import { LabelSettings } from '~/features/labels/LabelSettings';
import { ProjectLabelSettings } from '~/features/project-labels/ProjectLabelSettings';
import { InitiativeLabelSettings } from '~/features/initiative-labels/InitiativeLabelSettings';
import { ProjectStatusSettings } from '~/features/projects/ProjectStatusSettings';
import { ProjectUpdateSettings } from '~/views/ProjectUpdateSettings';
import { UndoToast } from '~/features/undo/UndoToast';
import { AcceptInvite } from '~/views/AcceptInvite';
import { AskFormPage } from '~/views/AskFormPage';
import { AskSettings } from '~/views/AskSettings';
import { ApiKeys } from '~/views/ApiKeys';
import { AuthorisedApps } from '~/views/AuthorisedApps';
import { Sessions } from '~/views/Sessions';
import { Webhooks } from '~/views/Webhooks';
import { OAuthApps } from '~/views/OAuthApps';
import { OAuthAuthorize } from '~/views/OAuthAuthorize';
import { GitHubSettings } from '~/views/GitHubSettings';
import { GitLabSettings } from '~/views/GitLabSettings';
import { SentrySettings } from '~/views/SentrySettings';
import { SlackSettings } from '~/views/SlackSettings';
import { ConnectServer } from '~/views/ConnectServer';
import { CreateIssueFromUrl } from '~/views/CreateIssueFromUrl';
import { CreateWorkspace } from '~/views/CreateWorkspace';
import { Drafts } from '~/views/Drafts';
import { ExportSettings } from '~/views/ExportSettings';
import { Inbox } from '~/views/Inbox';
import { Pulse } from '~/views/Pulse';
import { PulseSettings } from '~/views/PulseSettings';
import { CustomerRequestSettings } from '~/views/CustomerRequestSettings';
import { IssueDetail } from '~/views/IssueDetail';
import { IssueList } from '~/views/IssueList';
import { AdHocIssues } from '~/views/AdHocIssues';
import { LabelView } from '~/views/LabelView';
import { IntegrationDirectory } from '~/views/IntegrationDirectory';
import { MemberSettings } from '~/views/MemberSettings';
import { McpSettings } from '~/views/McpSettings';
import { MyIssues } from '~/views/MyIssues';
import { NotificationSettings } from '~/views/NotificationSettings';
import { Preferences } from '~/views/Preferences';
import { ProfileSettings } from '~/views/ProfileSettings';
import { WorkspaceSettings } from '~/views/WorkspaceSettings';
import { ProjectShell } from '~/views/ProjectShell';
import { ProjectOverview } from '~/views/ProjectOverview';
import { ProjectIssues } from '~/views/ProjectIssues';
import { ProjectAttachedView } from '~/views/ProjectAttachedView';
import { ProjectActivity } from '~/views/ProjectActivity';
import { Projects } from '~/views/Projects';
import { CycleDetail } from '~/views/CycleDetail';
import { Cycles } from '~/views/Cycles';
import { Triage } from '~/views/Triage';
import { UserView } from '~/views/UserView';
import { SavedView } from '~/views/SavedView';
import { Search } from '~/views/Search';
import { Templates } from '~/views/Templates';
import { TeamHome } from '~/views/TeamHome';
import { TeamSettings } from '~/views/TeamSettings';
import { Landing } from '~/views/Landing';
import { SignIn } from '~/views/SignIn';
import { SignUp } from '~/views/SignUp';
import { Archives } from '~/views/Archives';
import { Trash } from '~/views/Trash';
import { DeletedTeams } from '~/views/DeletedTeams';
import { AuditLog } from '~/views/AuditLog';
import { SlaSettings } from '~/views/SlaSettings';
import { DocumentDetail } from '~/views/DocumentDetail';
import { Documents } from '~/views/Documents';
import { Initiatives } from '~/views/Initiatives';
import { InitiativeShell } from '~/views/InitiativeShell';
import { InitiativeDetail } from '~/views/InitiativeDetail';
import { InitiativeActivity } from '~/views/InitiativeActivity';
import { Customers } from '~/views/Customers';
import { CustomerDetail } from '~/views/CustomerDetail';
import { Dashboards } from '~/views/Dashboards';
import { DashboardDetail } from '~/views/DashboardDetail';
import { CreateIssueModal } from '~/features/issue/CreateIssueModal';
import { CreateProjectModal } from '~/features/projects/CreateProjectModal';
import { CreateInitiativeModal } from '~/features/initiatives/CreateInitiativeModal';
import { CreateCustomerModal } from '~/features/customers/CreateCustomerModal';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import { CreateDashboardModal } from '~/features/dashboards/CreateDashboardModal';

import { getPrefs } from '~/features/prefs/prefs';
import { useQuery } from './context';
import { AppShell } from './AppShell';
import { Boot, rememberWorkspace } from './Boot';
import { KeymapProvider } from './keymap';
import { NotYet } from './NotYet';

export function App() {
  // Before the router, because there is nothing to route to.
  //
  // A desktop app with no server configured cannot sign in, cannot bootstrap and cannot
  // render a single screen that means anything — every one of them would fail on its first
  // request with a network error that says nothing about the actual problem. Asking the
  // question first is both simpler and the only honest thing to show. Always true on the
  // web, where the page was served by its own API.
  if (!hasServer()) return <ConnectServer />;

  return (
    <BrowserRouter>
      <KeymapProvider>
        <Boot
          renderSignedOut={({ onSignedIn }) => (
            <Routes>
              <Route path="/" element={<Landing />} />
              {/* Same page, bookmarkable even after a tester has a session — see
                  SignedInShell. Anonymous `/` is the marketing surface; authenticated `/`
                  is still the first team's issue list. */}
              <Route path="/welcome" element={<Landing />} />
              <Route path="/signin" element={<SignIn onSignedIn={onSignedIn} />} />
              <Route path="/signup" element={<SignUp onSignedIn={onSignedIn} />} />
              {/* The invitation link is followed from an email, so it has to survive
                  landing on a signed-out browser rather than bouncing to /signin and
                  losing the token. */}
              <Route
                path="/invite/:token"
                element={<AcceptInviteAndEnter onJoined={onSignedIn} />}
              />
              <Route path="/ask/:token" element={<AskFormPage />} />
              {/* Unknown paths stay on sign-in so a deep link like /team/ENG is still
                  the URL after the session is restored. */}
              <Route path="*" element={<SignIn onSignedIn={onSignedIn} />} />
            </Routes>
          )}
          renderNoWorkspace={({ onCreated }) => (
            <Routes>
              <Route
                path="/invite/:token"
                element={<AcceptInviteAndEnter onJoined={onCreated} />}
              />
              <Route path="/ask/:token" element={<AskFormPage />} />
              <Route path="*" element={<CreateWorkspace onCreated={onCreated} />} />
            </Routes>
          )}
        >
          <DeepLinks />
          <SignedInShell />
          {/*
            Mounted once, outside the routes, because an undo has to outlive the screen the
            action was taken on: deleting an issue from its own detail page navigates away,
            and a toast that unmounted with the page would take the only way back with it.
            Mounting a second one throws at startup — the keymap registry refuses the
            duplicate `undo.last` binding — which is the intended way to find out.
          */}
          <UndoToast />
        </Boot>
      </KeymapProvider>
    </BrowserRouter>
  );
}

/**
 * Workspace chrome, or the marketing page at `/welcome`.
 *
 * Authenticated `/` still honours Preferences (first team, My Issues, Inbox, Drafts).
 * `/welcome` is the way to look at the poster while signed in, without signing out.
 */
function SignedInShell() {
  const { pathname } = useLocation();
  if (pathname === '/welcome') return <Landing />;
  if (pathname === '/oauth/authorize') return <OAuthAuthorize />;
  if (pathname.startsWith('/ask/')) return <AskFormPage />;
  // An invitation link is followed from an email, on whatever browser the email was opened
  // in — and that browser is very often already signed in to the workspace the person
  // already works in. Without this the link falls through to the catch-all below and lands
  // them silently back on their own issue list, invitation unspent and nothing said.
  if (pathname.startsWith('/invite/')) return <AcceptInviteHere />;

  return (
    <AppShell
      renderCreateIssue={({ onClose, seed }) => <CreateIssueModal onClose={onClose} seed={seed} />}
      renderCreateProject={({ onClose }) => <CreateProjectModal onClose={onClose} />}
      renderCreateInitiative={({ onClose }) => <CreateInitiativeModal onClose={onClose} />}
      renderCreateCustomer={({ onClose }) => <CreateCustomerModal onClose={onClose} />}
      renderCreateCustomerRequest={({ onClose }) => (
        <CreateCustomerRequestModal onClose={onClose} />
      )}
      renderCreateDashboard={({ onClose }) => <CreateDashboardModal onClose={onClose} />}
    >
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/my-issues" element={<MyIssues />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/pulse" element={<Pulse />} />
        <Route path="/search" element={<Search />} />
        <Route path="/drafts" element={<Drafts />} />
        <Route path="/new" element={<CreateIssueFromUrl />} />
        <Route path="/projects" element={<Projects />} />
        <Route
          path="/initiatives"
          element={
            <MembersOnly>
              <Initiatives />
            </MembersOnly>
          }
        />
        <Route
          path="/initiative/:initiativeId"
          element={
            <MembersOnly>
              <InitiativeShell />
            </MembersOnly>
          }
        >
          <Route index element={<InitiativeDetail />} />
          <Route path="activity" element={<InitiativeActivity />} />
        </Route>
        <Route path="/customers" element={<Customers />} />
        <Route path="/customer/:customerId" element={<CustomerDetail />} />
        <Route
          path="/dashboards"
          element={
            <MembersOnly>
              <Dashboards />
            </MembersOnly>
          }
        />
        <Route
          path="/dashboard/:dashboardId"
          element={
            <MembersOnly>
              <DashboardDetail />
            </MembersOnly>
          }
        />
        <Route path="/view/:viewId" element={<SavedView />} />
        <Route path="/label/:labelId" element={<LabelView />} />
        <Route path="/user/:userId" element={<UserView />} />
        <Route path="/team/:teamKey" element={<IssueList />} />
        <Route path="/team/:teamKey/home" element={<TeamHome />} />
        <Route path="/team/:teamKey/new" element={<CreateIssueFromUrl />} />
        <Route path="/team/:teamKey/projects" element={<Projects />} />
        <Route path="/team/:teamKey/cycles" element={<Cycles />} />
        <Route path="/team/:teamKey/triage" element={<Triage />} />
        <Route path="/team/:teamKey/archives" element={<Archives />} />
        <Route path="/team/:teamKey/documents" element={<Documents />} />
        <Route path="/team/:teamKey/settings" element={<TeamSettings />} />
        <Route path="/issues/:identifiers" element={<AdHocIssues />} />
        <Route path="/issue/:identifier" element={<IssueDetail />} />
        <Route path="/project/:projectId" element={<ProjectShell />}>
          <Route index element={<ProjectOverview />} />
          <Route path="issues" element={<ProjectIssues />} />
          <Route path="view/:viewId" element={<ProjectAttachedView />} />
          <Route path="activity" element={<ProjectActivity />} />
        </Route>
        <Route path="/project/:projectId/documents" element={<Documents />} />
        <Route path="/document/:documentId" element={<DocumentDetail />} />
        <Route path="/cycle/:cycleId" element={<CycleDetail />} />
        {/*
          The door into settings, and the only route here that belongs to no screen.

          It used to render the workspace general form, which is admin-only — so a member
          following `G S`, or the Settings entry in the workspace menu, arrived at "Only
          admins can open this". Profile is the one settings page every role has, including
          a guest, so that is where the mode opens.
        */}
        <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
        <Route
          path="/settings/workspace"
          element={
            <AdminOnly>
              <WorkspaceSettings />
            </AdminOnly>
          }
        />
        <Route path="/settings/profile" element={<ProfileSettings />} />
        <Route
          path="/settings/members"
          element={
            <MembersOnly>
              <MemberSettings />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/labels"
          element={
            <MembersOnly>
              <LabelSettings />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/project-labels"
          element={
            <AdminOnly>
              <ProjectLabelSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/initiative-labels"
          element={
            <AdminOnly>
              <InitiativeLabelSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/project-statuses"
          element={
            <AdminOnly>
              <ProjectStatusSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/project-updates"
          element={
            <AdminOnly>
              <ProjectUpdateSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/pulse"
          element={
            <AdminOnly>
              <PulseSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/customers"
          element={
            <AdminOnly>
              <CustomerRequestSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/slas"
          element={
            <AdminOnly>
              <SlaSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/audit-log"
          element={
            <AdminOnly>
              <AuditLog />
            </AdminOnly>
          }
        />
        <Route path="/settings/notifications" element={<NotificationSettings />} />
        <Route path="/settings/preferences" element={<Preferences />} />
        <Route
          path="/settings/templates"
          element={
            <MembersOnly>
              <Templates />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/api-keys"
          element={
            <MembersOnly>
              <ApiKeys />
            </MembersOnly>
          }
        />
        <Route path="/settings/sessions" element={<Sessions />} />
        <Route path="/settings/authorised-apps" element={<AuthorisedApps />} />
        <Route
          path="/settings/mcp"
          element={
            <MembersOnly>
              <McpSettings />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/asks"
          element={
            <MembersOnly>
              <AskSettings />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/oauth-apps"
          element={
            <AdminOnly>
              <OAuthApps />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/integrations"
          element={
            <MembersOnly>
              <IntegrationDirectory />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/webhooks"
          element={
            <AdminOnly>
              <Webhooks />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/github"
          element={
            <AdminOnly>
              <GitHubSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/gitlab"
          element={
            <AdminOnly>
              <GitLabSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/sentry"
          element={
            <AdminOnly>
              <SentrySettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/slack"
          element={
            <AdminOnly>
              <SlackSettings />
            </AdminOnly>
          }
        />
        <Route
          path="/settings/export"
          element={
            <MembersOnly>
              <ExportSettings />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/trash"
          element={
            <MembersOnly>
              <Trash />
            </MembersOnly>
          }
        />
        <Route
          path="/settings/deleted-teams"
          element={
            <MembersOnly>
              <DeletedTeams />
            </MembersOnly>
          }
        />
        {/* Unknown paths go somewhere useful rather than to a dead end. A stale
            bookmark to a renamed team should land the user in their own work. */}
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </AppShell>
  );
}

/**
 * A screen the workspace has and a guest does not.
 *
 * A guest is team-scoped: no workspace-wide surfaces — initiatives, dashboards, customers,
 * Pulse — and no settings beyond their own account. See
 * `docs/01-features/17-admin-security-permissions.md`, "Guests".
 *
 * The role is asked of the session and never of the replica. A guest's replica carries no
 * `user` rows at all — the directory is workspace-scoped and `sync.go` does not hand it to
 * guests — so `useViewer()` is permanently null for exactly the person these gates exist
 * to exclude, and the three leaks fixed before this one were all that null being read as
 * "not a guest". `useViewerRole` answers from the session query, which answers for
 * everybody.
 *
 * `null` renders the screen rather than redirecting: it means the session has not answered
 * yet, and bouncing a member off Settings for the width of one round trip would be a bug
 * of its own. The nav that points here reads the same unknown the other way, as closed, so
 * nothing offers the door until the answer is in — this is the second lock on a URL typed
 * by hand, and the server is the third.
 */
function MembersOnly({ children }: { children: ReactNode }) {
  const role = useViewerRole();
  if (role === 'guest') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * A workspace administration screen, which a plain member does not get either.
 *
 * `MembersOnly` was the only wrapper here, so every Administration route was open to
 * anybody who was not a guest — and the sidebar named them all, because `showAdminSettings`
 * in `AppShell` was assigned `notGuest`. The role table in
 * `docs/01-features/17-admin-security-permissions.md` gives Member "no workspace
 * administration pages", and the server agrees: everything behind these routes answers to
 * `Role.IsAdmin()`. Reached as a member, `/settings/webhooks` drew a page shell, a New
 * webhook button and "Webhooks could not be fetched. Only admins can read them."
 *
 * Which routes are wrapped is decided by what the server does, not by which sidebar block a
 * screen sits in. Members, Labels, Templates, API keys, MCP, Asks, Integrations, Export,
 * Trash and Deleted teams all carry something a non-admin may actually do, and stay on
 * `MembersOnly`.
 *
 * The two refusals differ because the two audiences do. A guest is sent home, as every
 * other guest gate here does: they have no business knowing the page exists. A member is
 * told, in place — they can see the entry in a colleague's screen share and type the
 * address, and bouncing them to the issue list silently reads as a broken link rather than
 * an answer.
 *
 * `null` — the session has not answered — renders the screen, for the same reason
 * `MembersOnly` does: bouncing an admin off their own settings for the width of one round
 * trip would be a bug of its own, and the nav reads the same unknown the other way, as
 * closed. The server is the lock; this is the sign on the door.
 */
function AdminOnly({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const role = useViewerRole();
  if (role === 'guest') return <Navigate to="/" replace />;
  if (role === 'member') {
    return (
      <EmptyState
        title="Only admins can open this"
        description="This is a workspace administration page. Ask an admin of this workspace if something here needs changing."
        action={
          <Button onClick={() => void navigate('/settings/profile')}>Your own settings</Button>
        }
      />
    );
  }
  return <>{children}</>;
}

/**
 * An invitation followed by somebody who is not in a workspace yet — no account at all, or
 * an account with nothing in it.
 *
 * The boot sequence carries on in place from here; there is no replica to tear down. What
 * this adds is leaving the URL behind, which is not optional: the shell that is about to
 * mount has its own `/invite/:token` route, and a token still sitting in the address bar
 * would render the join screen a second time, on top of a workspace that had just been
 * joined and an invitation that had just been spent.
 */
function AcceptInviteAndEnter({ onJoined }: { onJoined: (workspaceId?: string) => void }) {
  const navigate = useNavigate();
  return (
    <AcceptInvite
      onAccepted={(workspaceId) => {
        void navigate('/', { replace: true });
        onJoined(workspaceId);
      }}
    />
  );
}

/**
 * An invitation followed by somebody who is already inside a workspace.
 *
 * Outside `AppShell`, because joining is not something done from within a workspace — the
 * sidebar behind it would be the *other* one's.
 *
 * Accepting reloads rather than swapping the workspace in place. Everything on this screen
 * belongs to the workspace being left — the replica, the engine, the keymap, the remembered
 * route — and reopening from boot is the only way to be sure none of it is carried across.
 * Remembering the new workspace first is what makes that load land in the one just joined
 * instead of dropping the person back where they started.
 */
function AcceptInviteHere() {
  return (
    <Routes>
      <Route
        path="/invite/:token"
        element={
          <AcceptInvite
            onAccepted={(workspaceId) => {
              if (workspaceId !== undefined) rememberWorkspace(workspaceId);
              location.assign('/');
            }}
          />
        }
      />
    </Routes>
  );
}

/**
 * Sends the user to the view they asked to land on.
 *
 * The default is still the first team's issue list — that is the product — but Preferences
 * can point launch at My Issues, Inbox or Drafts instead. A missing team still falls
 * through to the empty-state rather than inventing a dashboard.
 */
function HomeRedirect() {
  const prefs = getPrefs();
  if (prefs.homeView === 'my-issues') return <Navigate to="/my-issues" replace />;
  if (prefs.homeView === 'inbox') return <Navigate to="/inbox" replace />;
  if (prefs.homeView === 'drafts') return <Navigate to="/drafts" replace />;
  return <FirstTeam />;
}

/**
 * Sends the user to their first team's issue list.
 *
 * Authenticated `/` is a real list rather than an empty dashboard, because the issue list
 * IS the product and anything else is a screen to click through on the way to it. The
 * marketing page lives on anonymous `/` and on `/welcome`.
 */
function FirstTeam() {
  const teams = useQuery(
    (store) => [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
  );
  const first = teams[0];
  if (!first) return <NotYet feature="A team" milestone="create one in settings" />;
  return <Navigate to={`/team/${first.key}`} replace />;
}

/**
 * Routes deep links from the desktop shell.
 *
 * A no-op subscription on the web, where the browser handles the URL itself. Mounted
 * inside the router because it needs `useNavigate`, and inside Boot because a deep link
 * that arrives before the workspace is open has nowhere to navigate to.
 */
function DeepLinks() {
  const navigate = useNavigate();
  useEffect(() => onDeepLink((route) => void navigate(route)), [navigate]);
  return null;
}
