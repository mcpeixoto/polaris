package graph

import (
	"context"
	"os"
	"sort"
	"testing"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// A Write-scoped key is what somebody picks when they mean "less than Admin".
//
// It did not mean that. Every mutation fell through mutationScopes' default to `write`, so
// the same key could invite people into the workspace, change roles, re-aim every webhook,
// and — the one that made the rest moot — mint a fresh API key with no scopes at all, which
// is the wildcard. Each case below was reachable with these exact scopes before
// adminMutations existed.
func TestEnforceOauthScopes_WriteCannotAdministerTheWorkspace(t *testing.T) {
	t.Parallel()

	refused := []string{
		// The escalation: an unscoped key is the wildcard, so a Write key that can call
		// this one field can grant itself everything the other entries refuse.
		"createApiKey",
		"revokeApiKey",
		"revokeAccountSession",
		"revokeOtherSessions",
		"createOauthClient",
		"rotateOauthClientSecret",
		"createOauthAuthorization",
		"inviteToWorkspace",
		"setUserRole",
		"suspendUser",
		"removeUser",
		"updateWorkspace",
		"createTeam",
		"addTeamMember",
		"purgeDeletedIssues",
		"createWebhook",
		"updateWebhook",
		"updateSentryConnection",
		"updateSlackConnection",
		"createGitHubConnection",
		"updateGitLabConnection",
	}
	for _, field := range refused {
		if _, err := runScopeCheck(t, []string{"read", "write"}, field); err == nil {
			t.Errorf("a write-scoped token was allowed to call %s; write must not administer the workspace", field)
		} else if platform.CodeOf(err) != platform.CodeForbidden {
			t.Errorf("%s refused with %s, want %s", field, platform.CodeOf(err), platform.CodeForbidden)
		}
	}
}

// The other half of the same claim: `write` still writes.
//
// A scope that refuses the day's work is a scope nobody sets, so the narrowing has to stop
// exactly at the administrative boundary. These are the fields an importer or a bot holds a
// Write key for.
func TestEnforceOauthScopes_WriteStillWrites(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"createIssue", "updateIssue", "archiveIssue", "deleteIssue",
		"createComment", "updateComment", "resolveComment",
		"createProject", "updateProject", "createLabel", "createView",
		"addIssueLabel", "bulkUpdateIssues", "createAttachment",
		// Team-scoped and owned by a team owner rather than a workspace admin. The role
		// check behind the resolver still decides who; the scope does not pre-empt it.
		"deleteTeam", "retireTeam", "updateGitHubTeamAutomation",
		// Self-service, not administration.
		"leaveWorkspace", "updateProfile", "markNotificationRead",
	}
	for _, field := range allowed {
		if _, err := runScopeCheck(t, []string{"read", "write"}, field); err != nil {
			t.Errorf("a write-scoped token was refused %s: %v", field, err)
		}
	}
}

// Admin and an unscoped key both keep everything they had.
//
// The compatibility statement in one test: nothing that already worked with `admin` stops
// working, and an API key created without scopes — the default, and what most self-hosted
// installs hold — is untouched, because HasScope answers true for an empty set.
func TestEnforceOauthScopes_AdminAndUnscopedKeepEverything(t *testing.T) {
	t.Parallel()

	for _, field := range []string{"createApiKey", "inviteToWorkspace", "createIssue"} {
		if _, err := runScopeCheck(t, []string{"admin"}, field); err != nil {
			t.Errorf("an admin-scoped token was refused %s: %v", field, err)
		}
		if _, err := runScopeCheck(t, nil, field); err != nil {
			t.Errorf("an unscoped token was refused %s: %v", field, err)
		}
	}
}

// A read key still reads, and still writes nothing.
func TestEnforceOauthScopes_ReadIsUnchanged(t *testing.T) {
	t.Parallel()

	if _, err := runScopeCheck(t, []string{"read"}, "createIssue"); err == nil {
		t.Error("a read-scoped token was allowed to create an issue")
	}
	ctx := authz.WithPrincipal(context.Background(), &authz.Principal{Scopes: []string{"read"}})
	ctx = graphql.WithFieldContext(ctx, &graphql.FieldContext{
		Object: "Query",
		Field:  graphql.CollectedField{Field: &ast.Field{Name: "issues"}},
	})
	if _, err := EnforceOauthScopes(ctx, func(context.Context) (any, error) { return "ok", nil }); err != nil {
		t.Errorf("a read-scoped token was refused a query: %v", err)
	}
}

// Every name in adminMutations must be a mutation the schema actually has.
//
// This is the failure mode the map cannot survive without a check. A misspelling is not a
// compile error and not a test failure anywhere else: the entry simply never matches, the
// field falls through to `write`, and the scope grants precisely what the line was written
// to refuse. The bug looks like a working restriction until somebody tries it.
func TestMutationScopes_AdminSetMatchesTheSchema(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("../../../schema/schema.graphql")
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	schema, gqlErr := gqlparser.LoadSchema(&ast.Source{Name: "schema.graphql", Input: string(raw)})
	if gqlErr != nil {
		t.Fatalf("parse schema: %v", gqlErr)
	}
	if schema.Mutation == nil {
		t.Fatal("the schema has no Mutation type")
	}

	missing := make([]string, 0)
	for name := range adminMutations {
		if schema.Mutation.Fields.ForName(name) == nil {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("adminMutations names fields the schema does not have: %v\n"+
			"An entry that matches nothing is not a restriction — the field falls through to\n"+
			"the `write` default and the scope grants exactly what the entry was meant to refuse.",
			missing)
	}

	for _, name := range []string{"createApiKey", "inviteToWorkspace", "createOauthClient"} {
		if got := mutationScopes(name); len(got) != 1 || got[0] != "admin" {
			t.Errorf("mutationScopes(%q) = %v, want [admin]", name, got)
		}
	}
	if got := mutationScopes("createIssue"); len(got) == 0 || got[0] != "write" {
		t.Errorf("mutationScopes(createIssue) = %v, want write first", got)
	}
}

// runScopeCheck drives EnforceOauthScopes exactly as gqlgen's AroundFields hook does.
func runScopeCheck(t *testing.T, scopes []string, field string) (any, error) {
	t.Helper()
	ctx := authz.WithPrincipal(context.Background(), &authz.Principal{Scopes: scopes})
	ctx = graphql.WithFieldContext(ctx, &graphql.FieldContext{
		Object: "Mutation",
		Field:  graphql.CollectedField{Field: &ast.Field{Name: field}},
	})
	return EnforceOauthScopes(ctx, func(context.Context) (any, error) { return "ok", nil })
}
