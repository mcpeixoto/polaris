package domain_test

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The invariant the whole change stream exists to hold:
//
//	a replica that applied every change from version N holds the same rows as a replica that
//	bootstrapped at version N.
//
// Everything else the sync engine promises is checkable only because this one is true. When it
// breaks there is no error anywhere — two clients simply disagree about a workspace, and which
// one is right depends on when each of them last reloaded.
//
// It broke on restore. A soft delete is an UPDATE, so Postgres kept every comment, label,
// relation and subscription; the delete reached clients as one change row for the issue, and
// the client's own cascade then dropped all of them (Store.forget in web/src/store/store.ts).
// That cascade is correct and is what keeps a delete cheap. The restore published one upsert,
// for the issue, and nothing brought the cascaded rows back — so the client that watched it
// happen ended up with an issue holding an empty thread and no links, while one that
// bootstrapped a second later had all of it.
//
// The test is the invariant rather than the symptom. It replays the stream into a replica,
// bootstraps a second one at the version the replay finished at, and compares them — so it
// keeps being the right test when somebody changes how restore is implemented.

// replayedTypes are the entity types this comparison covers.
//
// Not every type, and the gap is not this test's to close: StreamBootstrap ships workspaces,
// users, teams, memberships, statuses, issues, label applications, relations and comments,
// and nothing else. A workspace's labels, templates, views, favourites, view preferences,
// subscriptions and notifications reach a client only on the change stream, so comparing them
// here would fail on a pre-existing hole in the snapshot rather than on anything to do with
// restore. Those four types below are exactly the ones a delete's cascade destroys AND the
// bootstrap carries, which makes them the set where the two must agree.
var replayedTypes = []string{"issue", "comment", "issueLabel", "issueRelation"}

func TestRestoreIssue_LeavesAReplayedReplicaHoldingWhatABootstrapWouldGive(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	// Everything is written through the domain layer so that every row exists on the change
	// stream as well as in the table. A fixture insert would be invisible to the replay and
	// present in the snapshot, which would fail this test for the wrong reason.
	subject, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The one that gets deleted and brought back",
	})
	if err != nil {
		t.Fatalf("create subject: %v", err)
	}
	other, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Blocked by the subject",
	})
	if err != nil {
		t.Fatalf("create the far end: %v", err)
	}

	label, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "Regression"})
	if err != nil {
		t.Fatalf("create label: %v", err)
	}
	if _, _, err := svc.AddIssueLabel(ctx, p, subject.ID, label.ID); err != nil {
		t.Fatalf("apply label: %v", err)
	}
	for _, body := range []string{"This is wrong", "Agreed, reopening"} {
		if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
			IssueID: subject.ID, Body: body,
		}); err != nil {
			t.Fatalf("create comment: %v", err)
		}
	}
	if _, _, err := svc.CreateIssueRelation(ctx, p, subject.ID, other.ID, model.RelationBlocks); err != nil {
		t.Fatalf("create relation: %v", err)
	}

	// The sequence a client watches: delete, then undo.
	if _, err := svc.DeleteIssue(ctx, p, subject.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := svc.RestoreIssue(ctx, p, subject.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}

	online := replayReplica(t, ctx, svc, p)
	bootstrapped := bootstrapReplica(t, ctx, svc, p)

	for _, entityType := range replayedTypes {
		got := sortedIDs(online[entityType])
		want := sortedIDs(bootstrapped[entityType])
		if !slices.Equal(got, want) {
			t.Errorf("a client that stayed online holds different %s rows from one that "+
				"bootstrapped afterwards.\n  replayed:    %v\n  bootstrapped: %v\n\n"+
				"A delete tells a replica to forget the issue and everything hanging off it — one "+
				"change row, and the client cascades locally. The restore therefore owes those "+
				"rows back; sending only the issue leaves the thread empty and the links gone "+
				"until something forces a re-bootstrap, with nothing erroring in between.",
				entityType, got, want)
		}
	}

	// And the rows are actually there rather than both replicas being empty, which is the
	// way a comparison like this passes for the wrong reason.
	if len(online["comment"]) != 2 {
		t.Errorf("the replayed replica holds %d comments, want 2", len(online["comment"]))
	}
	if len(online["issueLabel"]) != 1 {
		t.Errorf("the replayed replica holds %d label applications, want 1", len(online["issueLabel"]))
	}
	if len(online["issueRelation"]) != 1 {
		t.Errorf("the replayed replica holds %d relations, want 1", len(online["issueRelation"]))
	}
}

// replayReplica applies every change in the workspace to an in-memory store, the way a
// client that has been connected throughout would.
//
// The cascade below mirrors Store.forget in web/src/store/store.ts, and it has to: the whole
// question this test asks is what a real client ends up holding, and a replay that kept a
// deleted issue's comments would answer a question no client is asking. It is deliberately
// only the issue arm of that switch — the team arm is exercised by the membership tests, and
// modelling all of it here would be a second client rather than a test.
func replayReplica(t *testing.T, ctx context.Context, svc *domain.Service, p *authz.Principal) map[string]map[uuid.UUID]bool {
	t.Helper()

	rows := map[string]map[uuid.UUID]bool{}
	put := func(entityType string, id uuid.UUID) {
		if rows[entityType] == nil {
			rows[entityType] = map[uuid.UUID]bool{}
		}
		rows[entityType][id] = true
	}
	drop := func(entityType string, id uuid.UUID) {
		delete(rows[entityType], id)
	}

	// What each row belongs to, so the cascade can find it. A client keeps these as
	// indexes; a test keeps them as maps.
	commentIssue := map[uuid.UUID]uuid.UUID{}
	labelIssue := map[uuid.UUID]uuid.UUID{}
	relationEnds := map[uuid.UUID][2]uuid.UUID{}

	var after int64
	for {
		changes, err := svc.ReadChanges(ctx, p.WorkspaceID, after, 1<<62, 500)
		if err != nil {
			t.Fatalf("read changes after %d: %v", after, err)
		}
		if len(changes) == 0 {
			break
		}
		for _, c := range changes {
			after = c.Version
			if !c.Visible(p) {
				continue
			}
			switch c.Op {
			case "upsert":
				put(c.EntityType, c.EntityID)
				switch c.EntityType {
				case "comment":
					var row model.Comment
					decodePayload(t, c.Payload, &row)
					commentIssue[c.EntityID] = row.IssueID
				case "issueLabel":
					var row model.IssueLabel
					decodePayload(t, c.Payload, &row)
					labelIssue[c.EntityID] = row.IssueID
				case "issueRelation":
					var row model.IssueRelation
					decodePayload(t, c.Payload, &row)
					relationEnds[c.EntityID] = [2]uuid.UUID{row.IssueID, row.RelatedIssueID}
				}
			case "delete", "revoke":
				drop(c.EntityType, c.EntityID)
				if c.EntityType != "issue" {
					continue
				}
				// The client's cascade: losing an issue takes its comments, its label
				// applications and its links from both ends with it.
				for id, issueID := range commentIssue {
					if issueID == c.EntityID {
						drop("comment", id)
					}
				}
				for id, issueID := range labelIssue {
					if issueID == c.EntityID {
						drop("issueLabel", id)
					}
				}
				for id, ends := range relationEnds {
					if ends[0] == c.EntityID || ends[1] == c.EntityID {
						drop("issueRelation", id)
					}
				}
			}
		}
	}
	return rows
}

// bootstrapReplica is the same store, built the other way.
func bootstrapReplica(t *testing.T, ctx context.Context, svc *domain.Service, p *authz.Principal) map[string]map[uuid.UUID]bool {
	t.Helper()
	w := &collectingBootstrap{rows: map[string]map[uuid.UUID]bool{}}
	if err := svc.StreamBootstrap(ctx, p, w); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	return w.rows
}

type collectingBootstrap struct {
	rows map[string]map[uuid.UUID]bool
}

func (w *collectingBootstrap) Meta(int64, int) error { return nil }

func (w *collectingBootstrap) Entity(entityType string, id uuid.UUID, _ any) error {
	if w.rows[entityType] == nil {
		w.rows[entityType] = map[uuid.UUID]bool{}
	}
	w.rows[entityType][id] = true
	return nil
}

func decodePayload(t *testing.T, raw json.RawMessage, into any) {
	t.Helper()
	if len(raw) == 0 {
		t.Fatalf("an upsert carried no payload; there is nothing for a client to store")
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("decode change payload %s: %v", raw, err)
	}
}

func sortedIDs(set map[uuid.UUID]bool) []string {
	out := make([]string, 0, len(set))
	for id := range set {
		out = append(out, id.String())
	}
	sort.Strings(out)
	return out
}

// The archived case, which is the other half and is deliberately not symmetrical.
//
// An issue archived before it was deleted comes back archived, and a bootstrap excludes
// archived issues — so a replica must NOT hold it, and the restore publishes a delete rather
// than an upsert. That reads like a bug and is the opposite: it is what makes the two
// replicas agree. The contents are not republished either, for the same reason — they would
// be rows pointing at an issue no replica holds, and the snapshot's own joins exclude every
// one of them while the issue is archived.
func TestRestoreIssue_ArchivedThenDeletedStaysOutOfBothReplicas(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Archived, then deleted, then restored",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "Said before any of it happened",
	}); err != nil {
		t.Fatalf("create comment: %v", err)
	}

	if _, err := svc.ArchiveIssue(ctx, p, issue.ID, true); err != nil {
		t.Fatalf("archive: %v", err)
	}
	if _, err := svc.DeleteIssue(ctx, p, issue.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := svc.RestoreIssue(ctx, p, issue.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}

	online := replayReplica(t, ctx, svc, p)
	bootstrapped := bootstrapReplica(t, ctx, svc, p)

	for _, entityType := range replayedTypes {
		got := sortedIDs(online[entityType])
		want := sortedIDs(bootstrapped[entityType])
		if !slices.Equal(got, want) {
			t.Errorf("the two replicas disagree about %s after archive-delete-restore\n"+
				"  replayed:     %v\n  bootstrapped: %v", entityType, got, want)
		}
	}
	if online["issue"][issue.ID] {
		t.Errorf("a replayed replica holds an archived issue. Archived work is never cached — " +
			"the bootstrap excludes it — so restoring one has to reach clients as a delete, or " +
			"the row appears and then vanishes on the next reload for no reason a user can see.")
	}

	// The row is still in the database, which is the point of a restore. It is simply not
	// on any client, exactly as an archived issue never is.
	var archived, deleted *string
	if err := db.Pool().QueryRow(ctx,
		`SELECT archived_at::text, deleted_at::text FROM issue WHERE id = $1`, issue.ID,
	).Scan(&archived, &deleted); err != nil {
		t.Fatalf("read the restored row: %v", err)
	}
	if deleted != nil {
		t.Errorf("the issue is still soft-deleted after a restore that reported success")
	}
	if archived == nil {
		t.Errorf("the restore cleared archived_at; a restore undoes the delete and nothing else")
	}
}

// Republishing an issue's contents must not put anything in anybody's inbox.
//
// This is the trap the republication walks straight into if the change rows are not labelled
// carefully, and it is invisible from the server: the rows reach the replicas correctly, the
// restore looks right on screen, and everybody who was ever mentioned in the thread gets an
// email about a comment written weeks ago.
//
// The notification engine decides what a change means from ChangedFields. An empty list means
// "created", which would tell the whole thread that each comment was said again and tell
// everybody watching the far end of a link that their issue has just been blocked. FieldBody
// — the honest-looking label for a comment — re-fires every mention in it, deliberately, so
// that editing a comment notifies somebody newly named. Neither is what a restore is. The
// republished rows carry FieldDeleted, which is what actually moved.
func TestRestoreIssue_RepublishesWithoutNotifyingAnybody(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	alice := f.Principal()

	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	carolID := f.NewUser(t, "carol", "member", true)
	carol := f.PrincipalFor(carolID, authz.RoleMember, f.TeamID)

	subject, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The one with a thread on it",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	blocked, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Waiting on it",
	})
	if err != nil {
		t.Fatalf("create the blocked issue: %v", err)
	}

	// Carol watches the blocked issue, so a republished `blocks` relation read as a new one
	// would reach her. Bob is named in a comment, so a republished comment read as an edit
	// would reach him.
	if _, _, err := svc.SetIssueSubscription(ctx, carol, blocked.ID, true); err != nil {
		t.Fatalf("subscribe carol: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, alice, domain.CreateCommentInput{
		// The real mention syntax: an id, not a display name. A bare "@bob" parses as
		// nothing at all, which would make the assertion below pass by never firing.
		IssueID: subject.ID,
		Body:    fmt.Sprintf("@[bob](user:%s) could you look at this", bobID),
	}); err != nil {
		t.Fatalf("create comment: %v", err)
	}
	if _, _, err := svc.CreateIssueRelation(ctx, alice, subject.ID, blocked.ID, model.RelationBlocks); err != nil {
		t.Fatalf("create relation: %v", err)
	}

	// Everything said and done so far is legitimately notifiable, and is delivered and read
	// before the part under test begins.
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out the setup: %v", err)
	}
	baselineBob := inboxFingerprint(t, svc, bob)
	baselineCarol := inboxFingerprint(t, svc, carol)
	// Both baselines must be non-empty, or the comparisons below are two assertions that
	// nothing changed about nothing.
	if len(baselineBob) == 0 || len(baselineCarol) == 0 {
		t.Fatalf("the scene did not produce the notifications it is built to produce: "+
			"mentioned user has %v, watcher has %v", baselineBob, baselineCarol)
	}

	if _, err := svc.DeleteIssue(ctx, alice, subject.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, _, err := svc.RestoreIssue(ctx, alice, subject.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out the restore: %v", err)
	}

	if got := inboxFingerprint(t, svc, bob); !slices.Equal(got, baselineBob) {
		t.Errorf("restoring an issue moved the mentioned user's inbox.\n  before: %v\n  after:  %v\n\n"+
			"The comments came back on the stream labelled as writes to their body, which is what "+
			"re-fires a mention — right for an edit somebody made, and a notification about a "+
			"month-old comment for an undo they had nothing to do with.", baselineBob, got)
	}
	if got := inboxFingerprint(t, svc, carol); !slices.Equal(got, baselineCarol) {
		t.Errorf("restoring an issue moved a watcher of the blocked issue's inbox.\n  before: %v\n  after:  %v\n\n"+
			"The relation came back labelled as a create, which reads as a new blocker.",
			baselineCarol, got)
	}
}

// inboxFingerprint is what somebody would actually notice: which rows are there, what each
// one says, and how many events it has collapsed.
//
// A count of rows is not enough, and that is the trap. Notifications coalesce on
// (user, groupKey), so a re-fired mention lands on the row that is already there — the
// inbox stays one row long while its count goes up, its version moves and the digest mails
// it again. Comparing the whole shape is what catches that.
func inboxFingerprint(t *testing.T, svc *domain.Service, p *authz.Principal) []string {
	t.Helper()
	rows := inbox(t, svc, p)
	out := make([]string, 0, len(rows))
	for _, n := range rows {
		out = append(out, fmt.Sprintf("%s/%s/count=%d/v=%d", n.ID, n.Type, n.Count, n.ChangeVersion))
	}
	sort.Strings(out)
	return out
}
