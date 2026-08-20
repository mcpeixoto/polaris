package authz

import "github.com/google/uuid"

// Action names something a principal might be allowed to do. Actions are coarse on
// purpose: one per user-visible capability, not one per resolver.
type Action string

const (
	ActionWorkspaceUpdate Action = "workspace.update"
	ActionWorkspaceDelete Action = "workspace.delete"

	ActionTeamCreate Action = "team.create"
	ActionTeamUpdate Action = "team.update"
	ActionTeamDelete Action = "team.delete"
	ActionTeamJoin   Action = "team.join"

	ActionMemberInvite  Action = "member.invite"
	ActionMemberRemove  Action = "member.remove"
	ActionMemberSetRole Action = "member.set_role"
	ActionMemberSuspend Action = "member.suspend"

	ActionWorkflowStateManage Action = "workflow_state.manage"

	ActionIssueCreate  Action = "issue.create"
	ActionIssueUpdate  Action = "issue.update"
	ActionIssueDelete  Action = "issue.delete"
	ActionIssueArchive Action = "issue.archive"

	// Emptying the trash, which is the only irreversible write in the product.
	//
	// Deliberately workspace-level and not team-scoped, unlike every other issue action.
	// A team-scoped purge would let a team owner destroy their own team's history, and the
	// blast radius does not stop at the team: the issues going are linked from other teams'
	// boards, and those relations go with them. It is also the one action here whose answer
	// must not depend on the caller remembering to pass a team, because the failure mode of
	// getting that wrong is unrecoverable rather than merely wrong.
	ActionIssuePurge Action = "issue.purge"

	ActionCommentCreate Action = "comment.create"
	ActionCommentUpdate Action = "comment.update"
	ActionCommentDelete Action = "comment.delete"

	// Labels, views and templates each exist at two scopes, and they are two actions
	// rather than one action taking an optional team.
	//
	// The alternative — a single ActionLabelManage whose meaning depends on whether a team
	// id was passed — puts the most important part of the decision in the caller's
	// argument list, where forgetting it fails open. Two names cannot be confused, and
	// Can/CanInTeam stay disjoint.
	ActionWorkspaceLabelManage Action = "workspace_label.manage"
	ActionTeamLabelManage      Action = "team_label.manage"

	// A shared workspace view appears in everybody's sidebar, which is why it is an admin
	// action while a shared team view is not. A private view needs no action at all: it is
	// yours, and ownership is the whole test.
	ActionWorkspaceViewManage Action = "workspace_view.manage"
	ActionTeamViewManage      Action = "team_view.manage"

	ActionWorkspaceTemplateManage Action = "workspace_template.manage"
	ActionTeamTemplateManage      Action = "team_template.manage"

	// Projects span teams, so create/update/delete are workspace-level; the domain then
	// asks Visible against the project's team list. An admin bypasses that so they can
	// reach a project on private teams they are not in.
	ActionProjectCreate       Action = "project.create"
	ActionProjectUpdate       Action = "project.update"
	ActionProjectDelete       Action = "project.delete"
	ActionProjectStatusManage Action = "project_status.manage"

	// Personal keys, and only ever the caller's own — ownership is checked separately.
	// Guests are excluded because a key acts as its owner and a guest's access is meant to
	// be narrow and reviewable, which a long-lived token is not.
	ActionAPIKeyManage Action = "api_key.manage"

	// Outbound webhooks are a workspace-wide push of whatever they subscribe to, including
	// private-team data if scoped onto that team. Creating or reading one is therefore an
	// admin action: a member minting a URL that receives every issue is an exfiltration
	// path nobody would review.
	ActionWebhookManage Action = "webhook.manage"

	// Connecting GitHub for the workspace: inbound webhooks, branch format, commit linking.
	// Admin because the install covers every team and the commit-webhook secret is a
	// credential that would otherwise sit in a member's clipboard.
	ActionGitHubManage Action = "github.manage"

	// Connecting GitLab for the workspace: inbound webhooks, branch format, commit linking.
	// Admin because the install covers every team and the webhook token is a credential
	// that would otherwise sit in a member's clipboard.
	ActionGitLabManage Action = "gitlab.manage"

	// Connecting Sentry for the workspace: inbound webhooks that create issues.
	// Admin because the install covers every team and the webhook secret is a credential
	// that would otherwise sit in a member's clipboard.
	ActionSentryManage Action = "sentry.manage"

	// Third-party OAuth applications owned by this workspace. Admin because a client
	// secret is a workspace-wide credential, and every admin of the owning workspace is
	// meant to be able to manage the app.
	ActionOauthClientManage Action = "oauth_client.manage"
)

// AllActions exists so a test can assert that every action is classified.
//
// Go has no way to enumerate constants, so an action added without being listed here is
// invisible to that test — which is why the test also asserts the count, forcing whoever
// adds one to come back to this list rather than silently shipping an action that Can
// denies through its default branch and nobody can explain.
var AllActions = []Action{
	ActionWorkspaceUpdate, ActionWorkspaceDelete,
	ActionTeamCreate, ActionTeamUpdate, ActionTeamDelete, ActionTeamJoin,
	ActionMemberInvite, ActionMemberRemove, ActionMemberSetRole, ActionMemberSuspend,
	ActionWorkflowStateManage,
	ActionIssueCreate, ActionIssueUpdate, ActionIssueDelete, ActionIssueArchive, ActionIssuePurge,
	ActionCommentCreate, ActionCommentUpdate, ActionCommentDelete,
	ActionWorkspaceLabelManage, ActionTeamLabelManage,
	ActionWorkspaceViewManage, ActionTeamViewManage,
	ActionWorkspaceTemplateManage, ActionTeamTemplateManage,
	ActionProjectCreate, ActionProjectUpdate, ActionProjectDelete, ActionProjectStatusManage,
	ActionAPIKeyManage, ActionWebhookManage, ActionGitHubManage, ActionGitLabManage, ActionSentryManage, ActionOauthClientManage,
}

// Deliberately absent: notifications, subscriptions, favourites and view preferences.
//
// Every one of those is the caller's own row and nobody else's, so the test is ownership
// rather than role, and inventing an Action for them would suggest an admin could reach
// into somebody's inbox. Use OwnsResource.

// teamScoped actions are meaningless without a team, so Can always denies them and the
// caller must use CanInTeam.
//
// Keeping the two sets disjoint is what stops the mistake this file was first written
// with: gating CanInTeam behind Can, which rejected a team owner before the
// team-ownership branch could ever run, because Can had already demanded workspace admin.
var teamScoped = map[Action]bool{
	ActionTeamUpdate:          true,
	ActionTeamDelete:          true,
	ActionWorkflowStateManage: true,
	ActionIssueCreate:         true,
	ActionIssueUpdate:         true,
	ActionIssueDelete:         true,
	ActionIssueArchive:        true,
	ActionCommentCreate:       true,
	ActionCommentUpdate:       true,
	ActionCommentDelete:       true,
	ActionTeamLabelManage:     true,
	ActionTeamViewManage:      true,
	ActionTeamTemplateManage:  true,
}

// Can reports whether the principal may perform a workspace-level action.
//
// It denies every team-scoped action by construction. If you find yourself wanting
// Can(p, ActionIssueCreate), you are missing the team you are creating the issue in.
func Can(p *Principal, a Action) bool {
	if p == nil || teamScoped[a] {
		return false
	}

	switch a {
	case ActionWorkspaceUpdate, ActionWorkspaceDelete,
		ActionMemberInvite, ActionMemberRemove, ActionMemberSetRole, ActionMemberSuspend,
		ActionTeamCreate,
		// Emptying the trash destroys rows from every team at once and cannot be undone.
		ActionIssuePurge,
		// Workspace-wide labels, views and templates land in everybody's sidebar and
		// everybody's pickers. That reach is what makes them an admin action while their
		// team-scoped equivalents are not.
		ActionWorkspaceLabelManage, ActionWorkspaceViewManage, ActionWorkspaceTemplateManage,
		ActionProjectStatusManage,
		ActionWebhookManage, ActionGitHubManage, ActionGitLabManage, ActionSentryManage, ActionOauthClientManage:
		return p.Role.IsAdmin()

	case ActionTeamJoin, ActionAPIKeyManage, ActionProjectCreate, ActionProjectUpdate, ActionProjectDelete:
		// Guests cannot join teams on their own; they are added by an admin. Nor may they
		// mint API keys: a key acts as its owner and outlives the session, which is the
		// opposite of what a guest's access is meant to be. Projects are the same: a guest
		// is scoped to the issues they were invited to, not to shaping the workspace.
		return !p.IsGuest()
	}

	return false
}

// CanInTeam reports whether the principal may act inside a specific team.
//
// teamOwner says whether this principal holds the owner role on *this* team; the caller
// reads it from team_membership. Every team-scoped mutation goes through here, because
// reaching into a team you are not a member of is the most likely authorisation bug in a
// product that has private teams.
func CanInTeam(p *Principal, a Action, teamID uuid.UUID, teamOwner bool) bool {
	if p == nil || !teamScoped[a] {
		return false
	}

	// Configuration actions: workspace admins anywhere, team owners in their own team.
	switch a {
	case ActionTeamUpdate, ActionTeamDelete, ActionWorkflowStateManage:
		if p.Role.IsAdmin() {
			return true
		}
		return teamOwner && p.Teams.Has(teamID)
	}

	// Content actions: membership is the whole test. A guest's constraint is which teams
	// they can reach, not what they may do once inside one.
	return p.Teams.Has(teamID)
}

// CanEditOwnContent covers the "you may always edit what you wrote" rule that applies to
// comments regardless of role, plus the admin override that applies to deletion.
func CanEditOwnContent(p *Principal, authorID *uuid.UUID) bool {
	if p == nil {
		return false
	}
	if authorID != nil && *authorID == p.UserID {
		return true
	}
	return p.Role.IsAdmin()
}

// OwnsResource is the test for rows that belong to exactly one person: notifications,
// subscriptions, favourites, private views, view preferences, API keys.
//
// Deliberately without an admin override, unlike CanEditOwnContent. An admin needs to be
// able to delete somebody's comment, because a comment is visible to the team and can be
// abusive. An admin has no business in somebody's inbox, and a workspace where they do is
// one nobody should mark an issue as read in.
func OwnsResource(p *Principal, ownerID uuid.UUID) bool {
	return p != nil && p.UserID == ownerID
}

// CanRelateIssues answers whether a principal may link two issues that may live in
// different teams.
//
// Both sides are required, and that is the point: a relation is visible from both ends, so
// being able to create one from a team you can reach into a team you cannot would let you
// learn that an issue exists, and its identifier, purely by linking to it.
func CanRelateIssues(p *Principal, teamA, teamB uuid.UUID) bool {
	return CanInTeam(p, ActionIssueUpdate, teamA, false) &&
		CanInTeam(p, ActionIssueUpdate, teamB, false)
}
