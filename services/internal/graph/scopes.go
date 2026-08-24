package graph

import (
	"context"
	"strings"

	"github.com/99designs/gqlgen/graphql"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// EnforceOauthScopes refuses a GraphQL field the caller's token was not granted.
//
// Session cookies and unscoped API keys carry an empty scope list and pass. OAuth access
// tokens always carry at least `read`. `admin` is the wildcard. Writes need `write`, except
// the documented create-only scopes that can mint issues or comments without it, and except
// the administrative mutations in adminMutations, which need `admin`.
func EnforceOauthScopes(ctx context.Context, next graphql.Resolver) (any, error) {
	fc := graphql.GetFieldContext(ctx)
	if fc == nil || (fc.Object != "Query" && fc.Object != "Mutation") {
		return next(ctx)
	}

	p, ok := authz.PrincipalFrom(ctx)
	if !ok || p.HasScope("admin") || len(p.Scopes) == 0 {
		return next(ctx)
	}

	if fc.Object == "Query" {
		if !p.HasScope("read") {
			return nil, PresentError(ctx, platform.Forbidden("this token does not have the read scope"))
		}
		return next(ctx)
	}

	need := mutationScopes(fc.Field.Name)
	for _, scope := range need {
		if p.HasScope(scope) {
			return next(ctx)
		}
	}
	return nil, PresentError(ctx, platform.Forbidden("this token does not have the "+need[0]+" scope"))
}

// The mutations `write` must NOT reach.
//
// The key dialog offers Read, Write and Admin and the scope doc calls `admin` "full
// admin-level access", both of which promise that Write is the narrower of the two. Before
// this map it was not: every mutation defaulted to `write`, so a Write-scoped key could
// invite people, change roles, mint OAuth clients and rewrite every integration.
//
// The worst of it was not any single verb but createApiKey. A Write key could mint a key
// with no scopes at all, and an unscoped key is the wildcard — so the scope system was
// bypassable in one call by the credential it was supposed to be narrowing. A restriction
// that can uninstall itself is decoration.
//
// Three things are here and nothing else is:
//
//   - Workspace administration — membership, roles, teams, the workspace record, emptying
//     the trash, and the workspace-wide project statuses and SLA rules. These are the
//     mutations authz.Can() already answers with Role.IsAdmin().
//   - Credentials, both the minting and the revoking. Minting is the escalation above;
//     revoking is its mirror, because a token that can drop its owner's sessions and keys
//     is a lockout, not a narrowed key.
//   - Integration configuration. These rows hold signing secrets and point a copy of the
//     workspace's activity at a URL somebody chose; re-aiming a webhook is exfiltration
//     with a config change for a cover story.
//
// Deliberately NOT here: the team-scoped verbs a team owner performs without being a
// workspace admin — deleteTeam, retireTeam, the GitHub/GitLab team automations — and the
// label, view and template mutations, whose admin-only variants are the workspace-scoped
// ones and cannot be told apart by field name. A Write key belonging to an admin can still
// create a workspace-wide label. The role check behind the resolver is unchanged and still
// refuses everyone else; what is not claimed is that `write` is free of every admin-only
// effect, only that it no longer administers the workspace, its credentials or its
// integrations.
//
// TestMutationScopes_AdminSetMatchesTheSchema checks every name here against the live
// schema, because a misspelling would silently fall through to `write` and grant exactly
// what the entry was written to refuse.
var adminMutations = map[string]bool{
	// Workspace administration.
	"updateWorkspace":      true,
	"inviteToWorkspace":    true,
	"revokeInvite":         true,
	"removeUser":           true,
	"setUserRole":          true,
	"suspendUser":          true,
	"createTeam":           true,
	"addTeamMember":        true,
	"removeTeamMember":     true,
	"purgeDeletedIssues":   true,
	"createProjectStatus":  true,
	"updateProjectStatus":  true,
	"archiveProjectStatus": true,
	"createSlaRule":        true,
	"updateSlaRule":        true,
	"deleteSlaRule":        true,

	// Credentials.
	"createApiKey":             true,
	"revokeApiKey":             true,
	"revokeAccountSession":     true,
	"revokeOtherSessions":      true,
	"revokeAuthorisedOauthApp": true,
	"createOauthAuthorization": true,
	"createOauthClient":        true,
	"updateOauthClient":        true,
	"deleteOauthClient":        true,
	"rotateOauthClientSecret":  true,

	// Integration configuration.
	"createWebhook":          true,
	"updateWebhook":          true,
	"deleteWebhook":          true,
	"createGitHubConnection": true,
	"updateGitHubConnection": true,
	"deleteGitHubConnection": true,
	"createGitLabConnection": true,
	"updateGitLabConnection": true,
	"deleteGitLabConnection": true,
	"createSentryConnection": true,
	"updateSentryConnection": true,
	"deleteSentryConnection": true,
	"createSlackConnection":  true,
	"updateSlackConnection":  true,
	"deleteSlackConnection":  true,
}

func mutationScopes(field string) []string {
	if adminMutations[field] {
		return []string{"admin"}
	}
	name := strings.ToLower(field)
	switch {
	case strings.HasPrefix(name, "createissue") || name == "createissue":
		return []string{"write", "issues:create"}
	case strings.HasPrefix(name, "createcomment"):
		return []string{"write", "comments:create"}
	case strings.Contains(name, "timeschedule"):
		return []string{"write", "timeSchedule:write"}
	case strings.Contains(name, "customer"):
		return []string{"write", "customer:write"}
	case strings.Contains(name, "initiative"):
		return []string{"write", "initiative:write"}
	default:
		return []string{"write"}
	}
}
