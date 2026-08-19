package graph_test

import (
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Acceptance test 9 in docs/07-milestones/00-milestone-0.md:
//
//	Every M0 mutation is reachable from a personal API key over POST /graphql with the
//	same result as the UI. There is no endpoint the web app uses that the API does not
//	expose.
//
// That promise is the load-bearing architectural constraint of the whole product — the
// integrations, the agents and the mobile clients all sit on the same API the web app
// uses — and it is exactly the kind of promise that erodes one convenient shortcut at a
// time. This test makes the erosion fail the build.
//
// It works by reflection over the domain API rather than by a hand-maintained list,
// because a hand-maintained list is itself something somebody has to remember to update,
// which is the failure being prevented.

// notInTheAPI names domain methods that deliberately have no GraphQL mutation, each with
// the reason. Anything not listed here and not in the schema fails the test.
//
// Adding an entry is a decision that should be argued for in review, which is the point
// of making it a visible edit to this map rather than a silent omission.
var notInTheAPI = map[string]string{
	// Auth is REST, not GraphQL: sign-in has to set an HttpOnly cookie, and a GraphQL
	// mutation that sets cookies as a side effect is both surprising and impossible to
	// express in the schema.
	"Register":        "POST /auth/register",
	"Login":           "POST /auth/login",
	"RefreshSession":  "POST /auth/refresh",
	"RevokeSession":   "POST /auth/logout",
	"CreateWorkspace": "POST /auth/workspaces — there is no workspace to scope it to yet",
	"AcceptInvite":    "POST /auth/invites/accept — same reason",

	// Server-side only. No caller outside the process should be able to invoke these.
	"PruneChangeLog":            "worker cron",
	"PruneIdempotencyKeys":      "worker cron",
	"PruneExpiredSessions":      "worker cron",
	"PruneWebhookDeliveries":    "worker cron",
	"EnsureChangeLogPartitions": "worker cron",
	"RevokeAllSessions":         "reached through account settings, which is M1",
	// The retention sweep. Deliberately not reachable by a caller: its cutoff is
	// IssueRestoreWindow and nothing else, and a mutation that let somebody choose it would
	// be a way to defeat the recovery window the trash exists to be. What a caller can do —
	// empty their own workspace's trash, admin-only — is purgeDeletedIssues.
	"PurgeExpiredIssues": "worker cron",

	// Not a mutation at all — it matches the "Resolve" verb but reads a principal. It is
	// called by the auth middleware and the socket handshake, never by a caller.
	"ResolvePrincipal": "a read; the verb prefix is a false positive",

	// M1 scope. Listed so the omission is a decision rather than an oversight.
	"InviteToWorkspace": "M1: the invite UI ships with member management",
	"RevokeInvite":      "M1",
}

// mutatingPrefixes are the verbs that mark a domain method as a write.
var mutatingPrefixes = []string{
	"Create", "Update", "Delete", "Archive", "Set", "Add", "Remove",
	"Suspend", "Resolve", "Accept", "Decline", "Snooze", "Mark", "Revoke", "Invite", "Register", "Login",
	"Prune", "Ensure", "Refresh", "Purge", "Restore", "Retire", "Unretire",
}

func TestAPIParity_EveryDomainMutationIsReachableOverGraphQL(t *testing.T) {
	schema := loadSchema(t)

	mutationFields := map[string]bool{}
	if schema.Mutation != nil {
		for _, f := range schema.Mutation.Fields {
			mutationFields[strings.ToLower(f.Name)] = true
		}
	}
	if len(mutationFields) == 0 {
		t.Fatal("the schema declares no mutations at all")
	}

	svcType := reflect.TypeOf(&domain.Service{})
	var missing []string

	for i := range svcType.NumMethod() {
		name := svcType.Method(i).Name
		if !isMutating(name) {
			continue
		}
		if reason, ok := notInTheAPI[name]; ok {
			if reason == "" {
				t.Errorf("%s is excluded from the API with no reason given", name)
			}
			continue
		}
		if !mutationFields[strings.ToLower(name)] {
			missing = append(missing, name)
		}
	}

	for _, name := range missing {
		t.Errorf(
			"domain.Service.%s writes data but has no GraphQL mutation.\n"+
				"Every mutation the product performs must be reachable from the public API — that is\n"+
				"what stops integrations and agents becoming second-class. Either add a field to\n"+
				"schema/schema.graphql, or add %s to notInTheAPI with the reason it is exempt.",
			name, name)
	}
}

// TestAPIParity_NoOrphanedMutations catches the other direction: a schema field with
// nothing behind it. gqlgen would fail to build in that case, but only once somebody
// regenerates — this fails immediately and says why.
func TestAPIParity_EverySchemaMutationHasADomainMethod(t *testing.T) {
	schema := loadSchema(t)
	if schema.Mutation == nil {
		t.Fatal("the schema declares no Mutation type")
	}

	svcType := reflect.TypeOf(&domain.Service{})
	methods := map[string]bool{}
	for i := range svcType.NumMethod() {
		methods[strings.ToLower(svcType.Method(i).Name)] = true
	}

	// Schema fields whose resolver legitimately composes several domain calls rather than
	// mapping one-to-one.
	composite := map[string]string{
		"archiveworkflowstate": "domain.ArchiveWorkflowState",
	}

	for _, f := range schema.Mutation.Fields {
		name := strings.ToLower(f.Name)
		if methods[name] || composite[name] != "" {
			continue
		}
		t.Errorf("schema mutation %q has no matching domain.Service method — the field would resolve to nothing", f.Name)
	}
}

// TestAPIParity_MutationsCarryIdempotencyKeys asserts that every mutation a syncing client
// issues accepts clientId and opId.
//
// Without them a dropped response makes the client's outbox replay a write that already
// happened, and the user gets a duplicate they cannot account for. Workspace-configuration
// mutations are exempt: they are made by a person clicking a button in settings, not by a
// queue that replays.
func TestAPIParity_ClientMutationsAcceptIdempotencyKeys(t *testing.T) {
	schema := loadSchema(t)
	if schema.Mutation == nil {
		t.Fatal("the schema declares no Mutation type")
	}

	// The mutations a client queues in its offline outbox.
	needsKeys := map[string]bool{
		"createIssue": true, "updateIssue": true, "archiveIssue": true, "deleteIssue": true,
		"createComment": true, "updateComment": true, "resolveComment": true, "deleteComment": true,
	}

	for _, f := range schema.Mutation.Fields {
		if !needsKeys[f.Name] {
			continue
		}
		args := map[string]bool{}
		for _, a := range f.Arguments {
			args[a.Name] = true
		}
		if !args["clientId"] || !args["opId"] {
			t.Errorf("mutation %q is queued by the client but does not accept clientId and opId; "+
				"a retry after a dropped response would apply it twice", f.Name)
		}

		hasDirective := false
		for _, d := range f.Directives {
			if d.Name == "idempotent" {
				hasDirective = true
			}
		}
		if !hasDirective {
			t.Errorf("mutation %q should carry @idempotent so the schema itself documents that it is safe to retry", f.Name)
		}
	}
}

func loadSchema(t *testing.T) *ast.Schema {
	t.Helper()

	// Read from the repository rather than from a generated copy, so this asserts against
	// the contract as published.
	raw, err := os.ReadFile("../../../schema/schema.graphql")
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	schema, gqlErr := gqlparser.LoadSchema(&ast.Source{Name: "schema.graphql", Input: string(raw)})
	if gqlErr != nil {
		t.Fatalf("parse schema: %v", gqlErr)
	}
	return schema
}

func isMutating(name string) bool {
	for _, prefix := range mutatingPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}
