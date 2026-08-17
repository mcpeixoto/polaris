package graph

import (
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// Three fields the schema declared and the resolvers did not fill, and the reads behind
// them.
//
// All three failed the same way and it is the way that is worth naming: the schema promised
// something, the query succeeded, and the answer was empty or absent. Nothing errored,
// nothing logged, and the only way to notice was to already know what the value should have
// been. These tests run through the executor rather than calling resolvers directly, because
// two of the three are decided by the selection set — a resolver called in Go sees no query
// and takes a different branch.

// TestTeamMembers_ResolveRatherThanComingBackEmpty is the first of them.
//
// `Team.members` has been in schema.graphql since the first commit and hydrateTeam left it
// nil, with a comment explaining that the domain layer exposed no membership listing and a
// resolver may not reach round it to the store. Both halves were true; the conclusion — that
// the field therefore stays empty — was not. The listing is domain.ListTeamMemberships now.
func TestTeamMembers_ResolveRatherThanComingBackEmpty(t *testing.T) {
	h := newHarness(t)

	// A second person, so an empty answer cannot pass by there being nobody to list.
	other := h.f.NewUser(t, "sam", "member", true)

	body := h.execute(t, `query { teams { id key members { id teamId userId role } } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("query failed: %v", errs)
	}

	teams := body["data"].(map[string]any)["teams"].([]any)
	if len(teams) != 1 {
		t.Fatalf("the fixture has one team and the query returned %d", len(teams))
	}
	members := teams[0].(map[string]any)["members"].([]any)
	if len(members) != 2 {
		t.Fatalf("Team.members returned %d rows for a team with two members.\n"+
			"An empty list here is what the field did for the whole of M0 and M1: the schema "+
			"declares [TeamMembership!]!, the query succeeds, and the client renders a team "+
			"nobody is in.", len(members))
	}

	byUser := map[string]string{}
	for _, m := range members {
		row := m.(map[string]any)
		byUser[row["userId"].(string)] = row["role"].(string)
		if row["teamId"].(string) != h.f.TeamID.String() {
			t.Errorf("a membership came back pointing at team %s, not the team it was read from",
				row["teamId"])
		}
	}
	if byUser[h.f.UserID.String()] != "OWNER" {
		t.Errorf("the fixture's owner has role %q; the wire spelling is SCREAMING_SNAKE and the "+
			"column holds lower case, so a missing conversion shows up exactly here",
			byUser[h.f.UserID.String()])
	}
	if byUser[other.String()] != "MEMBER" {
		t.Errorf("the member added for this test has role %q", byUser[other.String()])
	}
}

// TestTeamMembers_CostOneReadHoweverManyTeamsAreNamed is the batching half of the
// requirement, and it is the half that decays silently.
//
// A per-team read passes every assertion above: the members are all correct, and the only
// symptom is a query per team on a sidebar that names every team in the workspace. So this
// counts the scans Postgres performs on team_membership across one whole GraphQL operation
// over twelve teams, where the difference between right and wrong is one read versus twelve.
//
// The counter is pg_stat_user_tables, which each test's own database starts at zero and
// which settledMembershipScans forces every pooled backend to flush before reading. It fails
// rather than passes when the counter has not moved at all, because a statistics read that
// returns nothing would otherwise make this test pass by measuring nothing.
func TestTeamMembers_CostOneReadHoweverManyTeamsAreNamed(t *testing.T) {
	h := newHarness(t)

	const teams = 12
	for i := range teams {
		if _, _, err := h.svc.CreateTeam(h.ctx, principalOf(t, h), domain.CreateTeamInput{
			Key:  fmt.Sprintf("T%02d", i),
			Name: fmt.Sprintf("Team %d", i),
		}); err != nil {
			t.Fatalf("create team %d: %v", i, err)
		}
	}

	// The baseline is taken once the creation above has stopped moving the counter.
	// Reading it immediately would fold twelve CreateTeam calls into the measurement and
	// make the budget below meaningless.
	before := settledMembershipScans(t, h)

	body := h.execute(t, `query { teams { id members { userId } } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("query failed: %v", errs)
	}
	if got := len(body["data"].(map[string]any)["teams"].([]any)); got != teams+1 {
		t.Fatalf("the query returned %d teams, want %d", got, teams+1)
	}

	delta := settledMembershipScans(t, h) - before
	if delta == 0 {
		t.Fatalf("pg_stat_user_tables recorded no read of team_membership at all, so this test " +
			"measured nothing. It is the only assertion separating one batched read from one " +
			"read per team; fix the counter rather than deleting it.")
	}

	// Two rather than one: the statistics are per table rather than per statement and the
	// settling reads share the pool with the request, so the budget carries a little slack.
	// It is still nowhere near thirteen.
	if delta > 2 {
		t.Errorf("resolving members on %d teams read team_membership %d times.\n"+
			"Team.members must come from one memoised workspace-wide read — see "+
			"Loaders.allMemberships — because the sidebar names every team in the workspace "+
			"and a read per team is the N+1 the loaders exist to prevent.", teams+1, delta)
	}
}

// settledMembershipScans flushes every pooled backend's pending statistics and then reads
// the counter.
//
// A backend accumulates its statistics locally and reports them no more often than
// PGSTAT_MIN_INTERVAL, which is a second — so a read taken straight after a query sees
// whatever happened to have been flushed, which is usually nothing. Sleeping for it would
// make this test slow and still racy. pg_stat_force_next_flush makes the calling backend
// flush at the end of its current statement, so this takes every connection in the pool in
// turn and forces each one, which is what makes the number a measurement rather than a race.
func settledMembershipScans(t *testing.T, h *harness) int64 {
	t.Helper()

	pool := h.svc.DB().Pool()
	held := make([]*pgxpool.Conn, 0, pool.Config().MaxConns)
	// Held, not released between acquisitions: releasing would hand the same backend back
	// and leave the others unflushed.
	for range pool.Config().MaxConns {
		conn, err := pool.Acquire(h.ctx)
		if err != nil {
			t.Fatalf("acquire a connection to flush its statistics: %v", err)
		}
		held = append(held, conn)
		if _, err := conn.Exec(h.ctx, "SELECT pg_stat_force_next_flush()"); err != nil {
			t.Fatalf("force a statistics flush: %v", err)
		}
	}
	for _, conn := range held {
		conn.Release()
	}

	return membershipScans(t, h)
}

func membershipScans(t *testing.T, h *harness) int64 {
	t.Helper()
	var n *int64
	if err := h.svc.DB().Pool().QueryRow(h.ctx,
		`SELECT coalesce(seq_scan, 0) + coalesce(idx_scan, 0)
		 FROM pg_stat_user_tables WHERE relname = 'team_membership'`,
	).Scan(&n); err != nil {
		t.Fatalf("read table statistics: %v", err)
	}
	if n == nil {
		return 0
	}
	return *n
}

// TestCommentIssue_ResolvesFromASearchHit is the second field.
//
// A comment search result is a body and an id with no way home. Rendering "in ENG-142"
// against it meant a second round trip per hit for any caller without a local replica, which
// is every integration. The field is batched: one read for the distinct issues of the whole
// page, then those issues hydrated together, so asking for the issue's team as well does not
// multiply.
func TestCommentIssue_ResolvesFromASearchHit(t *testing.T) {
	h := newHarness(t)
	p := principalOf(t, h)

	first := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Login redirect"})
	second := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Empty state"})

	for _, target := range []*generated.IssuePayload{first, first, second} {
		if _, _, err := h.svc.CreateComment(h.ctx, p, domain.CreateCommentInput{
			IssueID: target.Issue.ID,
			Body:    "The peculiar thing about this",
		}); err != nil {
			t.Fatalf("create comment: %v", err)
		}
	}

	body := h.execute(t, `
		query {
			search(input: { query: "peculiar" }) {
				comments { id issueId issue { id identifier team { key } } }
			}
		}`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("search failed: %v", errs)
	}

	comments := body["data"].(map[string]any)["search"].(map[string]any)["comments"].([]any)
	if len(comments) != 3 {
		t.Fatalf("the search matched %d comments, want 3", len(comments))
	}

	identifiers := map[string]int{}
	for _, c := range comments {
		row := c.(map[string]any)
		issue, ok := row["issue"].(map[string]any)
		if !ok {
			t.Fatalf("Comment.issue came back null on a non-null field.\n" +
				"Every path that returns a comment has already read its issue to decide the " +
				"caller may see it, so this is not a permission answer — it is a field nothing " +
				"filled in.")
		}
		if issue["id"] != row["issueId"] {
			t.Errorf("comment %s says it is on issue %s and resolved to %s",
				row["id"], row["issueId"], issue["id"])
		}
		if team, ok := issue["team"].(map[string]any); !ok || team["key"] != "ENG" {
			t.Errorf("the issue behind a comment did not hydrate its own relations: %v", issue["team"])
		}
		identifiers[issue["identifier"].(string)]++
	}
	// Two hits share an issue, which is the case the deduplication exists for: three
	// comments must not become three reads of two issues.
	if identifiers["ENG-1"] != 2 || identifiers["ENG-2"] != 1 {
		t.Errorf("the hits resolved to %v, want two on ENG-1 and one on ENG-2", identifiers)
	}
}

// TestDeletedIssues_CarryWhenAndByWhom is the third, and it is the one the trash screen
// asked for in prose.
//
// web/src/views/Trash.tsx says out loud that it cannot show when an issue was deleted or by
// whom, orders the table by the server's own ordering because it has nothing else, and names
// the issue's *creator* with a sentence explaining that the person who deleted it is not
// recorded. deleted_at was on the row and reached no API; deleted_by did not exist.
func TestDeletedIssues_CarryWhenAndByWhom(t *testing.T) {
	h := newHarness(t)
	p := principalOf(t, h)

	issue := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "A mistake"})
	before := time.Now().Add(-time.Second)
	if _, err := h.svc.DeleteIssue(h.ctx, p, issue.Issue.ID); err != nil {
		t.Fatalf("delete issue: %v", err)
	}

	body := h.execute(t, `query { deletedIssues { id identifier deletedAt deletedBy } }`, nil)
	if errs, ok := body["errors"]; ok {
		t.Fatalf("deletedIssues failed: %v", errs)
	}
	rows := body["data"].(map[string]any)["deletedIssues"].([]any)
	if len(rows) != 1 {
		t.Fatalf("the trash holds %d issues, want 1", len(rows))
	}
	row := rows[0].(map[string]any)

	deletedBy, _ := row["deletedBy"].(string)
	if deletedBy != h.f.UserID.String() {
		t.Errorf("deletedBy is %v; the trash screen names the creator instead of the deleter "+
			"precisely because this was never recorded, and it says so in its own header comment",
			row["deletedBy"])
	}

	stamp, _ := row["deletedAt"].(string)
	if stamp == "" {
		t.Fatalf("deletedAt came back null on a row the trash listing returned, which is the " +
			"one read in the product where it is always set")
	}
	at, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		t.Fatalf("deletedAt %q is not a timestamp: %v", stamp, err)
	}
	if at.Before(before) || at.After(time.Now().Add(time.Second)) {
		t.Errorf("deletedAt is %s, which is not when the delete happened", at)
	}

	// And the field stays absent everywhere else, which is the other half of the contract:
	// every other read filters deleted rows out, so a non-null deletedAt anywhere else would
	// mean the API had just handed somebody a row out of the trash.
	live := h.createIssue(t, generated.CreateIssueInput{TeamID: h.f.TeamID, Title: "Still here"})
	body = h.execute(t, `query Read($id: UUID!) { issue(id: $id) { deletedAt deletedBy } }`,
		map[string]any{"id": live.Issue.ID.String()})
	if errs, ok := body["errors"]; ok {
		t.Fatalf("issue read failed: %v", errs)
	}
	issueRow := body["data"].(map[string]any)["issue"].(map[string]any)
	if issueRow["deletedAt"] != nil || issueRow["deletedBy"] != nil {
		t.Errorf("a live issue reports deletedAt=%v deletedBy=%v", issueRow["deletedAt"], issueRow["deletedBy"])
	}
}

// principalOf pulls the harness's principal back off its context, for the tests that need to
// call the domain layer directly to set a scene the API has no mutation for.
func principalOf(t *testing.T, h *harness) *authz.Principal {
	t.Helper()
	p, err := principalFrom(h.ctx)
	if err != nil {
		t.Fatalf("the harness context carries no principal: %v", err)
	}
	return p
}
