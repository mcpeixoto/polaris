/**
 * Routes.
 *
 * The same routes serve the web app and the Electron shell, so a deep link
 * (`polaris://issue/ENG-123`) maps one-to-one onto a path and the desktop app needs no
 * routing of its own — it translates the URL and hands it to the router here.
 */

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';

import { onDeepLink } from '~/platform/runtime';
import { hasServer } from '~/sync/endpoint';
import { LabelSettings } from '~/features/labels/LabelSettings';
import { ProjectLabelSettings } from '~/features/project-labels/ProjectLabelSettings';
import { ProjectUpdateSettings } from '~/views/ProjectUpdateSettings';
import { UndoToast } from '~/features/undo/UndoToast';
import { AcceptInvite } from '~/views/AcceptInvite';
import { AskFormPage } from '~/views/AskFormPage';
import { AskSettings } from '~/views/AskSettings';
import { ApiKeys } from '~/views/ApiKeys';
import { Webhooks } from '~/views/Webhooks';
import { OAuthApps } from '~/views/OAuthApps';
import { OAuthAuthorize } from '~/views/OAuthAuthorize';
import { GitHubSettings } from '~/views/GitHubSettings';
import { GitLabSettings } from '~/views/GitLabSettings';
import { ConnectServer } from '~/views/ConnectServer';
import { CreateIssueFromUrl } from '~/views/CreateIssueFromUrl';
import { CreateWorkspace } from '~/views/CreateWorkspace';
import { Drafts } from '~/views/Drafts';
import { ExportSettings } from '~/views/ExportSettings';
import { Inbox } from '~/views/Inbox';
import { Pulse } from '~/views/Pulse';
import { IssueDetail } from '~/views/IssueDetail';
import { IssueList } from '~/views/IssueList';
import { MemberSettings } from '~/views/MemberSettings';
import { McpSettings } from '~/views/McpSettings';
import { MyIssues } from '~/views/MyIssues';
import { NotificationSettings } from '~/views/NotificationSettings';
import { Preferences } from '~/views/Preferences';
import { ProjectShell } from '~/views/ProjectShell';
import { ProjectOverview } from '~/views/ProjectOverview';
import { ProjectIssues } from '~/views/ProjectIssues';
import { ProjectAttachedView } from '~/views/ProjectAttachedView';
import { ProjectActivity } from '~/views/ProjectActivity';
import { Projects } from '~/views/Projects';
import { CycleDetail } from '~/views/CycleDetail';
import { Cycles } from '~/views/Cycles';
import { Triage } from '~/views/Triage';
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
import { SlaSettings } from '~/views/SlaSettings';
import { DocumentDetail } from '~/views/DocumentDetail';
import { Documents } from '~/views/Documents';
import { Initiatives } from '~/views/Initiatives';
import { InitiativeDetail } from '~/views/InitiativeDetail';
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
import { Boot } from './Boot';
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
              <Route path="/invite/:token" element={<AcceptInvite onAccepted={onSignedIn} />} />
              <Route path="/ask/:token" element={<AskFormPage />} />
              {/* Unknown paths stay on sign-in so a deep link like /team/ENG is still
                  the URL after the session is restored. */}
              <Route path="*" element={<SignIn onSignedIn={onSignedIn} />} />
            </Routes>
          )}
          renderNoWorkspace={({ onCreated }) => (
            <Routes>
              <Route path="/invite/:token" element={<AcceptInvite onAccepted={onCreated} />} />
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
        <Route path="/initiatives" element={<Initiatives />} />
        <Route path="/initiative/:initiativeId" element={<InitiativeDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customer/:customerId" element={<CustomerDetail />} />
        <Route path="/dashboards" element={<Dashboards />} />
        <Route path="/dashboard/:dashboardId" element={<DashboardDetail />} />
        <Route path="/view/:viewId" element={<SavedView />} />
        <Route path="/team/:teamKey" element={<IssueList />} />
        <Route path="/team/:teamKey/home" element={<TeamHome />} />
        <Route path="/team/:teamKey/new" element={<CreateIssueFromUrl />} />
        <Route path="/team/:teamKey/projects" element={<Projects />} />
        <Route path="/team/:teamKey/cycles" element={<Cycles />} />
        <Route path="/team/:teamKey/triage" element={<Triage />} />
        <Route path="/team/:teamKey/archives" element={<Archives />} />
        <Route path="/team/:teamKey/documents" element={<Documents />} />
        <Route path="/team/:teamKey/settings" element={<TeamSettings />} />
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
        <Route path="/settings/members" element={<MemberSettings />} />
        <Route path="/settings/labels" element={<LabelSettings />} />
        <Route path="/settings/project-labels" element={<ProjectLabelSettings />} />
        <Route path="/settings/project-updates" element={<ProjectUpdateSettings />} />
        <Route path="/settings/slas" element={<SlaSettings />} />
        <Route path="/settings/notifications" element={<NotificationSettings />} />
        <Route path="/settings/preferences" element={<Preferences />} />
        <Route path="/settings/templates" element={<Templates />} />
        <Route path="/settings/api-keys" element={<ApiKeys />} />
        <Route path="/settings/mcp" element={<McpSettings />} />
        <Route path="/settings/asks" element={<AskSettings />} />
        <Route path="/settings/oauth-apps" element={<OAuthApps />} />
        <Route path="/settings/webhooks" element={<Webhooks />} />
        <Route path="/settings/github" element={<GitHubSettings />} />
        <Route path="/settings/gitlab" element={<GitLabSettings />} />
        <Route path="/settings/export" element={<ExportSettings />} />
        <Route path="/settings/trash" element={<Trash />} />
        <Route path="/settings/deleted-teams" element={<DeletedTeams />} />
        {/* Unknown paths go somewhere useful rather than to a dead end. A stale
            bookmark to a renamed team should land the user in their own work. */}
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </AppShell>
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
