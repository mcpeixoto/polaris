package domain_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// `related` is symmetric and CreateIssueRelation canonicalises it smaller-uuid-first, so
// reading forward only meant the issue with the LARGER uuid listed the link nowhere. Half
// of every "related to" was invisible from one of its two ends, and which half depended on
// a uuid comparison no user can see or predict.
//
// The test creates the link both ways round so it cannot pass by luck of the ordering.
func TestRelations_ARelatedLinkIsVisibleFromBothEnds(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a := f.NewIssue(t, "One")
	b := f.NewIssue(t, "Two")

	if _, _, err := svc.CreateIssueRelation(ctx, p, a, b, model.RelationRelated); err != nil {
		t.Fatalf("create the relation: %v", err)
	}

	byIssue, err := svc.ListRelationsForIssues(ctx, p, []uuid.UUID{a, b})
	if err != nil {
		t.Fatalf("list relations: %v", err)
	}

	for _, side := range []struct {
		name string
		self uuid.UUID
		far  uuid.UUID
	}{{"a", a, b}, {"b", b, a}} {
		rels := byIssue[side.self]
		if len(rels) != 1 {
			t.Errorf("issue %s lists %d relations, want 1 — the symmetric link is invisible from this end",
				side.name, len(rels))
			continue
		}
		// Presented from the reader's end whichever way the row was stored.
		if rels[0].IssueID != side.self {
			t.Errorf("issue %s: relation.issueId = %s, want its own id", side.name, rels[0].IssueID)
		}
		if rels[0].RelatedIssueID != side.far {
			t.Errorf("issue %s: relation.relatedIssueId = %s, want the far issue %s",
				side.name, rels[0].RelatedIssueID, side.far)
		}
		if rels[0].Type != model.RelationRelated {
			t.Errorf("issue %s: type = %q", side.name, rels[0].Type)
		}
	}

	// Both ends name the same row, so a client holding it from one end does not gain a
	// second copy from the other.
	if byIssue[a][0].ID != byIssue[b][0].ID {
		t.Errorf("the two ends report different relation ids (%s, %s); it is one link",
			byIssue[a][0].ID, byIssue[b][0].ID)
	}
}

// Only `related` is read backwards. `blocks` read from the far end is "blocked by" and has
// its own field; reporting it in `relations` too would double every blocker on the screen.
func TestRelations_BlocksIsNotReadBackwardsIntoRelations(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	blocker := f.NewIssue(t, "The blocker")
	blocked := f.NewIssue(t, "The blocked one")

	if _, _, err := svc.CreateIssueRelation(ctx, p, blocker, blocked, model.RelationBlocks); err != nil {
		t.Fatalf("create the relation: %v", err)
	}

	byIssue, err := svc.ListRelationsForIssues(ctx, p, []uuid.UUID{blocker, blocked})
	if err != nil {
		t.Fatalf("list relations: %v", err)
	}
	if len(byIssue[blocker]) != 1 {
		t.Fatalf("the blocker lists %d relations, want 1", len(byIssue[blocker]))
	}
	if len(byIssue[blocked]) != 0 {
		t.Fatalf("the blocked issue lists %d relations; `blocks` belongs in blockedBy, not here",
			len(byIssue[blocked]))
	}

	blockers, err := svc.ListBlockersForIssues(ctx, p, []uuid.UUID{blocked})
	if err != nil {
		t.Fatalf("list blockers: %v", err)
	}
	if len(blockers[blocked]) != 1 {
		t.Fatalf("the blocked issue has %d blockers, want 1", len(blockers[blocked]))
	}
}

// F4 — the batched relation reads had no archived/deleted predicate, so an issue in the
// trash surfaced as a live relation on the issue-detail screen. The single-issue variant
// has always filtered exactly this way, and the bootstrap stream does too: a client that
// holds a relation the snapshot excludes is holding a chip nobody can open.
func TestRelations_ARelationToADeletedIssueIsNotListed(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	live := f.NewIssue(t, "Alive")
	doomed := f.NewIssue(t, "About to go")

	if _, _, err := svc.CreateIssueRelation(ctx, p, live, doomed, model.RelationRelated); err != nil {
		t.Fatalf("create the relation: %v", err)
	}
	byIssue, err := svc.ListRelationsForIssues(ctx, p, []uuid.UUID{live})
	if err != nil {
		t.Fatalf("list relations: %v", err)
	}
	if len(byIssue[live]) != 1 {
		t.Fatalf("expected the relation before the delete, got %d", len(byIssue[live]))
	}

	if _, err := svc.DeleteIssue(ctx, p, doomed); err != nil {
		t.Fatalf("delete the far issue: %v", err)
	}

	byIssue, err = svc.ListRelationsForIssues(ctx, p, []uuid.UUID{live})
	if err != nil {
		t.Fatalf("list relations after the delete: %v", err)
	}
	if len(byIssue[live]) != 0 {
		t.Fatalf("a relation to a deleted issue is still listed: %+v", byIssue[live])
	}
}

func TestRelations_ARelationToAnArchivedIssueIsNotListed(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	live := f.NewIssue(t, "Alive")
	shelved := f.NewIssue(t, "About to be archived")

	if _, _, err := svc.CreateIssueRelation(ctx, p, live, shelved, model.RelationRelated); err != nil {
		t.Fatalf("create the relation: %v", err)
	}
	if _, err := svc.ArchiveIssue(ctx, p, shelved, true); err != nil {
		t.Fatalf("archive the far issue: %v", err)
	}

	byIssue, err := svc.ListRelationsForIssues(ctx, p, []uuid.UUID{live})
	if err != nil {
		t.Fatalf("list relations: %v", err)
	}
	if len(byIssue[live]) != 0 {
		t.Fatalf("a relation to an archived issue is still listed: %+v", byIssue[live])
	}
}
