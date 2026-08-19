/**
 * Routes.
 *
 * The same routes serve the web app and the Electron shell, so a deep link
 * (`polaris://issue/ENG-123`) maps one-to-one onto a path and the desktop app needs no
 * routing of its own — it translates the URL and hands it to the router here.
 */

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';

import { onDeepLink } from '~/platform/runtime';
import { hasServer } from '~/sync/endpoint';
import { LabelSettings } from '~/features/labels/LabelSettings';
import { UndoToast } from '~/features/undo/UndoToast';
import { AcceptInvite } from '~/views/AcceptInvite';
import { ApiKeys } from '~/views/ApiKeys';
import { ConnectServer } from '~/views/ConnectServer';
import { CreateWorkspace } from '~/views/CreateWorkspace';
import { Inbox } from '~/views/Inbox';
import { IssueDetail } from '~/views/IssueDetail';
import { IssueList } from '~/views/IssueList';
import { MemberSettings } from '~/views/MemberSettings';
import { MyIssues } from '~/views/MyIssues';
import { NotificationSettings } from '~/views/NotificationSettings';
import { ProjectDetail } from '~/views/ProjectDetail';
import { Projects } from '~/views/Projects';
import { CycleDetail } from '~/views/CycleDetail';
import { Cycles } from '~/views/Cycles';
import { Triage } from '~/views/Triage';
import { SavedView } from '~/views/SavedView';
import { Search } from '~/views/Search';
import { Templates } from '~/views/Templates';
import { SignIn } from '~/views/SignIn';
import { SignUp } from '~/views/SignUp';
import { TeamSettings } from '~/views/TeamSettings';
import { Trash } from '~/views/Trash';
import { CreateIssueModal } from '~/features/issue/CreateIssueModal';
import { CreateProjectModal } from '~/features/projects/CreateProjectModal';

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
              <Route path="/signup" element={<SignUp onSignedIn={onSignedIn} />} />
              {/* The invitation link is followed from an email, so it has to survive
                  landing on a signed-out browser rather than bouncing to /signin and
                  losing the token. */}
              <Route path="/invite/:token" element={<AcceptInvite onAccepted={onSignedIn} />} />
              <Route path="*" element={<SignIn onSignedIn={onSignedIn} />} />
            </Routes>
          )}
          renderNoWorkspace={({ onCreated }) => (
            <Routes>
              <Route path="/invite/:token" element={<AcceptInvite onAccepted={onCreated} />} />
              <Route path="*" element={<CreateWorkspace onCreated={onCreated} />} />
            </Routes>
          )}
        >
          <DeepLinks />
          <AppShell
            renderCreateIssue={({ onClose }) => <CreateIssueModal onClose={onClose} />}
            renderCreateProject={({ onClose }) => <CreateProjectModal onClose={onClose} />}
          >
            <Routes>
              <Route path="/" element={<FirstTeam />} />
              <Route path="/my-issues" element={<MyIssues />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/search" element={<Search />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/view/:viewId" element={<SavedView />} />
              <Route path="/team/:teamKey" element={<IssueList />} />
              <Route path="/team/:teamKey/projects" element={<Projects />} />
              <Route path="/team/:teamKey/cycles" element={<Cycles />} />
              <Route path="/team/:teamKey/triage" element={<Triage />} />
              <Route path="/team/:teamKey/settings" element={<TeamSettings />} />
              <Route path="/issue/:identifier" element={<IssueDetail />} />
              <Route path="/project/:projectId" element={<ProjectDetail />} />
              <Route path="/cycle/:cycleId" element={<CycleDetail />} />
              <Route path="/settings/members" element={<MemberSettings />} />
              <Route path="/settings/labels" element={<LabelSettings />} />
              <Route path="/settings/notifications" element={<NotificationSettings />} />
              <Route path="/settings/templates" element={<Templates />} />
              <Route path="/settings/api-keys" element={<ApiKeys />} />
              <Route path="/settings/trash" element={<Trash />} />
              {/* Unknown paths go somewhere useful rather than to a dead end. A stale
                  bookmark to a renamed team should land the user in their own work. */}
              <Route path="*" element={<FirstTeam />} />
            </Routes>
          </AppShell>
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
 * Sends the user to their first team's issue list.
 *
 * The landing page is a real list rather than an empty dashboard, because in M0 the issue
 * list IS the product and anything else is a screen to click through on the way to it.
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
