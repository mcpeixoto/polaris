package graph_test

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

// The client's offline outbox and the server's idempotency table are one mechanism with a
// part on each side, and these tests are what stop the two halves drifting apart.
//
// `SyncEngine.drainOutbox` re-sends a queued mutation with the *original* (clientId, opId)
// — deliberately, and it says so in a comment — so that the server can recognise a retry
// and answer with the result the first attempt earned. That only works if three things
// agree, and nothing in the type system relates them:
//
//  1. the schema field declares `clientId`/`opId` and carries `@idempotent`,
//  2. the resolver actually passes the pair to `idempotent(...)`,
//  3. the client's document declares the variables and passes them to the field.
//
// Miss any one and the pair is sent, ignored, and the write runs again. createRecurringIssue
// missed all three and duplicated a schedule *and* its first occurrence on every reload
// taken while the op was in flight (#107). An audit afterwards found twenty more creates in
// the same state — createView, createProjectStatus, createWorkflowState and the rest — none
// of which anything would have caught, because a mutation with no key is not an error
// anywhere: it succeeds, twice.
//
// Point 3 lives in web/src/sync/idempotency.test.ts, because that is where the documents
// are. The two below cover points 1 and 2.
//
// The demand below is scoped to `create*` deliberately, and the scope is a judgement rather
// than an oversight. A replayed create is the case where the damage is permanent and
// invisible: a second row, indistinguishable from an intended one, that no later delta
// retracts. A replayed update writes values the caller already chose — running it twice
// lands on the same state, and the only thing lost is that the version returned came from
// the second write rather than the first. A replayed delete answers "not found" for
// something that did succeed, which the client shows as a failure and the delta stream then
// corrects. Both are worth closing, and roughly sixty of them are still open; neither is
// worth a check that would fail the build for a mutation nobody can be harmed by.

// notReplayProtected names the `create*` mutations that deliberately carry no idempotency
// key, each with the reason.
//
// The bar for an entry is high and it is not "this one seemed unlikely to be retried".
// domain.Idempotent stores the resolver's whole result as JSON for twenty-four hours so a
// replay can return it, and that is the wrong place for a value the product shows once and
// then only ever holds hashed. Every entry here is on that list; nothing else belongs.
//
// A create that writes an ordinary workspace row and returns it does not get an exemption.
var notReplayProtected = map[string]string{
	"createApiKey": "the response carries the personal API token in clear, once. " +
		"Recording it for a day so a retry can repeat it is exactly what hashing the column avoids",
	"createWebhook": "same: the response carries the signing secret, which the schema says " +
		"exists in the create response and in the delivery path's column and nowhere a listing can see",
	"createOauthClient": "same: the response carries the client secret",
	"createOauthAuthorization": "not a workspace row at all. It mints a single-use " +
		"authorization code onto a redirect URI, and replaying a code that has already been " +
		"exchanged hands the caller a URI the token endpoint will refuse",
}

// Every create is replay-protected, or is named above with a reason.
//
// Stated over the schema rather than over a list of mutations, so it needs no maintenance:
// a `create*` field added tomorrow is in scope the moment it is written, and the build fails
// until somebody has either wired the key or argued for the exemption in review. That is the
// only shape of check that survives an API this size — the fault it prevents is one of
// omission, and a list somebody has to remember to extend has the same failure mode as the
// thing it is guarding.
func TestIdempotency_EveryCreateMutationTakesAReplayKey(t *testing.T) {
	mutation := mutationType(t)

	creates := 0
	for _, field := range mutation.Fields {
		if !strings.HasPrefix(field.Name, "create") {
			continue
		}
		creates++

		if reason, exempt := notReplayProtected[field.Name]; exempt {
			if field.Directives.ForName("idempotent") != nil {
				t.Errorf("%s carries @idempotent and is also listed in notReplayProtected (%q). "+
					"Pick one: remove the entry, or the directive.", field.Name, reason)
			}
			continue
		}

		hasKey := field.Arguments.ForName("clientId") != nil && field.Arguments.ForName("opId") != nil
		if field.Directives.ForName("idempotent") == nil || !hasKey {
			t.Errorf("%s creates a row and takes no idempotency key: %s.\n"+
				"The client's outbox replays a queued mutation with the (clientId, opId) it used "+
				"the first time, so a create with no key writes a second row on any reload, lost "+
				"response or offline drain taken while the op is in flight — and the duplicate is "+
				"indistinguishable afterwards from something a person meant to create.\n"+
				"Declare `clientId: UUID, opId: UUID` and `@idempotent` in schema/schema.graphql "+
				"and wrap the resolver's call in idempotent(...) — see createRecurringIssue — or "+
				"add %s to notReplayProtected with the reason it cannot hold a key.",
				field.Name, declaration(field), field.Name)
		}
	}

	// A guard on the guard: a rename of the type or a change to how the schema is loaded
	// would otherwise leave this test passing by looking at nothing at all.
	if creates < 20 {
		t.Fatalf("the schema's Mutation type has %d create* fields, which is far too few to be "+
			"the real one. This test measured nothing.", creates)
	}
}

// Declaring @idempotent and not asking for the key is the failure the directive cannot
// catch by itself.
//
// gqlgen refuses to execute a field whose directive has no implementation, so a *missing*
// implementation is loud. The directive's own implementation is a pass-through — the replay
// has to happen in the resolver, where the result is still the typed payload that gets
// stored — so a field can carry the marker, take the arguments, ignore them, and behave
// exactly as if it had none of it. Every symptom of that is identical to having no key: the
// mutation succeeds, and it succeeds again.
func TestIdempotency_EveryMarkedMutationActuallyAsksForTheKey(t *testing.T) {
	mutation := mutationType(t)

	// `go test` runs in the package's own directory, which is where gqlgen writes it.
	source, err := os.ReadFile("schema.resolvers.go")
	if err != nil {
		t.Fatalf("read the resolvers: %v", err)
	}
	bodies := resolverBodies(string(source))

	marked := 0
	for _, field := range mutation.Fields {
		if field.Directives.ForName("idempotent") == nil {
			continue
		}
		marked++

		if field.Arguments.ForName("clientId") == nil || field.Arguments.ForName("opId") == nil {
			t.Errorf("%s carries @idempotent and does not declare both clientId and opId, so "+
				"there is no key for the resolver to read: %s", field.Name, declaration(field))
			continue
		}

		body, found := bodies[field.Name]
		if !found {
			t.Errorf("no resolver found for %s. gqlgen writes `// X is the resolver for the %s "+
				"field.` above each one; if that comment has been edited away this test cannot "+
				"find the body it needs to check.", field.Name, field.Name)
			continue
		}
		if !strings.Contains(body, "idempotent(ctx") {
			t.Errorf("%s declares @idempotent and its resolver never calls idempotent(...), so "+
				"the (clientId, opId) the client sends is read by nothing and a retry writes "+
				"again. The directive is a marker; domain.Idempotent is the mechanism, and it "+
				"has to be reached from the resolver because the result it stores is the typed "+
				"payload. See createRecurringIssue for the shape.", field.Name)
		}
	}

	if marked < 90 {
		t.Fatalf("only %d mutations carry @idempotent, which is far fewer than the schema has. "+
			"This test measured nothing.", marked)
	}
}

// Every exemption names a field that exists.
//
// Without this, deleting or renaming a mutation leaves a stale excuse behind — and the next
// mutation to be given that name inherits an exemption nobody argued for.
func TestIdempotency_EveryExemptionNamesALiveMutation(t *testing.T) {
	mutation := mutationType(t)

	names := make([]string, 0, len(notReplayProtected))
	for name := range notReplayProtected {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		if mutation.Fields.ForName(name) == nil {
			t.Errorf("notReplayProtected exempts %q and schema/schema.graphql has no such "+
				"mutation. Remove the entry rather than leaving it to be inherited by whatever "+
				"is named that next.", name)
		}
		if strings.TrimSpace(notReplayProtected[name]) == "" {
			t.Errorf("the exemption for %q has no reason written against it", name)
		}
	}
}

func mutationType(t *testing.T) *ast.Definition {
	t.Helper()

	raw, err := os.ReadFile("../../../schema/schema.graphql")
	if err != nil {
		t.Fatalf("read the schema: %v", err)
	}
	schema, gqlErr := gqlparser.LoadSchema(&ast.Source{Name: "schema.graphql", Input: string(raw)})
	if gqlErr != nil {
		t.Fatalf("parse the schema: %v", gqlErr)
	}
	if schema.Mutation == nil {
		t.Fatal("the schema has no Mutation type")
	}
	return schema.Mutation
}

// declaration renders a field the way the schema spells it, so a failure can be pasted
// straight into schema.graphql rather than looked up.
func declaration(field *ast.FieldDefinition) string {
	args := make([]string, 0, len(field.Arguments))
	for _, arg := range field.Arguments {
		args = append(args, arg.Name+": "+arg.Type.String())
	}
	return field.Name + "(" + strings.Join(args, ", ") + "): " + field.Type.String()
}

// resolverBodies maps a schema field name to the text of the mutation resolver that serves
// it, keyed by the comment gqlgen writes above every generated stub.
//
// The comment is the only place the two spellings meet: gqlgen upper-cases acronyms, so
// `createApiKey` is served by `CreateAPIKey` and `setIssueSla` by `SetIssueSLA`, and a rule
// that guessed the Go name from the field name would quietly skip exactly those.
var resolverHeader = regexp.MustCompile(
	`(?m)^// ([A-Za-z0-9_]+) is the resolver for the ([a-zA-Z0-9_]+) field\.\n` +
		`func \(r \*mutationResolver\) `)

func resolverBodies(source string) map[string]string {
	headers := resolverHeader.FindAllStringSubmatchIndex(source, -1)
	bodies := make(map[string]string, len(headers))
	for i, at := range headers {
		end := len(source)
		if i+1 < len(headers) {
			end = headers[i+1][0]
		}
		field := source[at[4]:at[5]]
		bodies[field] = source[at[0]:end]
	}
	return bodies
}
