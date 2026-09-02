package graph

import (
	"os"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

// A narrow scope must not smuggle in broader effects.
//
// The create rules used to be prefix matches, so "issues:create" — a token that may file
// issues — also carried createIssueRelation and createIssueTemplate. Relations mutate the
// views of issues the token never created (blocks, duplicate, related), and a template is
// team-wide. The prefix was invisible because the only field anybody checked was the one
// the rule was written for.
func TestMutationScopes_CreateRulesMatchExactlyOneFieldEach(t *testing.T) {
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

	// scope → the one field allowed to carry it.
	narrow := map[string]string{
		"issues:create":   "createIssue",
		"comments:create": "createComment",
	}

	offenders := map[string][]string{}
	for _, field := range schema.Mutation.Fields {
		for _, scope := range mutationScopes(field.Name) {
			owner, isNarrow := narrow[scope]
			if !isNarrow || field.Name == owner {
				continue
			}
			offenders[scope] = append(offenders[scope], field.Name)
		}
	}

	for scope, fields := range offenders {
		sort.Strings(fields)
		t.Errorf("%s also grants %v — a token narrowed to %q may do things it never asked for",
			scope, fields, narrow[scope])
	}

	// And the rules still grant what they are for.
	for scope, owner := range narrow {
		got := mutationScopes(owner)
		if !slices.Contains(got, scope) {
			t.Errorf("mutationScopes(%q) = %v, want it to include %q", owner, got, scope)
		}
	}
}

// The two fields that were actually reachable through the prefix. Named individually so a
// failure says which door reopened rather than only that one did.
func TestMutationScopes_IssueSiblingsDoNotInheritIssuesCreate(t *testing.T) {
	t.Parallel()

	for _, field := range []string{"createIssueRelation", "createIssueTemplate"} {
		got := mutationScopes(field)
		if slices.Contains(got, "issues:create") {
			t.Errorf("mutationScopes(%q) = %v; a token that may only file issues must not reach this",
				field, got)
		}
		if len(got) == 0 || got[0] != "write" {
			t.Errorf("mutationScopes(%q) = %v, want write first", field, got)
		}
	}
}

// The case-insensitive match is still case-insensitive; only its width changed.
func TestMutationScopes_StillMatchesRegardlessOfCase(t *testing.T) {
	t.Parallel()

	if got := mutationScopes(strings.ToUpper("createIssue")); !slices.Contains(got, "issues:create") {
		t.Errorf("mutationScopes(CREATEISSUE) = %v, want it to include issues:create", got)
	}
}
