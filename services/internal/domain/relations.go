package domain

import (
	"bytes"
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Relations between issues.
//
// One row per link, and only ever one. "Blocked by" is a `blocks` row read from the far end
// rather than a second row, because two rows can disagree: an issue that blocks another
// without the other being blocked by it is a state no user can explain and no support
// engineer can repair.
//
// Two consequences run through this file. `related` has no direction, so it is stored with
// the smaller id first and the caller may pass either order — canonicalising is this layer's
// job, not the caller's. `blocks` and `duplicate` do have a direction, and reordering them
// would reverse their meaning, so they are written exactly as given.

// CreateIssueRelation links two issues.
func (s *Service) CreateIssueRelation(
	ctx context.Context, p *authz.Principal, issueID, relatedIssueID uuid.UUID, relType string,
) (model.IssueRelation, int64, error) {
	switch relType {
	case model.RelationBlocks, model.RelationRelated, model.RelationDuplicate:
	default:
		return model.IssueRelation{}, 0, platform.Validation("type",
			"a relation is one of blocks, related or duplicate")
	}
	// Checked here rather than left to issue_relation_not_self, because canonicalisation
	// below needs the two ids to have an order and two equal ids have none. The constraint
	// stays the backstop for anything that writes the table without coming through here.
	if issueID == relatedIssueID {
		return model.IssueRelation{}, 0, platform.Validation("relatedIssueId",
			"an issue cannot be linked to itself")
	}

	// `related` is symmetric, so it is stored smaller-id-first and the caller is free to
	// name the two issues in whichever order they were clicked. Without this the pair is
	// stored twice — once each way — the unique index cannot see the duplicate, and the
	// issue panel shows the same link twice with no way to tell them apart.
	//
	// bytes.Compare rather than a string compare because it is the same ordering Postgres
	// gives uuids, which is the ordering issue_relation_symmetric_canonical is written in.
	if relType == model.RelationRelated && bytes.Compare(issueID[:], relatedIssueID[:]) > 0 {
		issueID, relatedIssueID = relatedIssueID, issueID
	}

	var out model.IssueRelation
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		subject, err := q.GetIssue(ctx, issueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		object, err := q.GetIssue(ctx, relatedIssueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}

		// Both sides, always. A relation is visible from both ends, so being able to create
		// one from a team you can reach into a team you cannot is an oracle: the link tells
		// you the far issue exists and hands you its identifier. Answering exactly as a
		// missing issue does is what closes it — distinguishing "not there" from "not yours"
		// is the leak itself.
		if !authz.CanRelateIssues(p, subject.TeamID, object.TeamID) {
			return platform.NotFound("issue")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateIssueRelation(ctx, store.CreateIssueRelationParams{
			ID:             id,
			WorkspaceID:    p.WorkspaceID,
			IssueID:        issueID,
			RelatedIssueID: relatedIssueID,
			Type:           relType,
			CreatedBy:      &p.UserID,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "issue_relation_key") {
				// Reached by a client whose outbox replayed, and by two people linking the
				// same pair at once. Neither is a failure worth a stack trace.
				return platform.Validation("relatedIssueId", "these issues are already linked that way")
			}
			return platform.Internal(err)
		}
		out = toIssueRelation(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueRelation", EntityID: id, Op: OpUpsert,
			// No single team owns this row, so the denormalised team key is left unset and
			// the scope carries both. Naming one of the two here would suggest the other
			// side is somebody else's business.
			TeamID:  nil,
			Scope:   relationScope(row.TeamID, row.RelatedTeamID),
			Payload: out,
		})
		return err
	})
	return out, version, err
}

// DeleteIssueRelation removes a link. Returns the id so the caller can tell its client which
// row to forget.
func (s *Service) DeleteIssueRelation(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		rel, err := q.GetIssueRelation(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("relation")
			}
			return platform.Internal(err)
		}
		if rel.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("relation")
		}
		// Unlinking needs both ends for the same reason linking does: the row is about to
		// vanish from the other team's issue panel too.
		if !authz.CanRelateIssues(p, rel.TeamID, rel.RelatedTeamID) {
			return platform.NotFound("relation")
		}

		if _, err := q.DeleteIssueRelation(ctx, id); err != nil {
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issueRelation", EntityID: id, Op: OpDelete,
			TeamID: nil,
			// The scope is read from the row that was just deleted, which is the whole
			// reason the two team ids are denormalised onto it: by the time the hub reads
			// this change there is nothing left to look them up from.
			Scope: relationScope(rel.TeamID, rel.RelatedTeamID),
		})
		return err
	})
	return id, version, err
}

// ListIssueRelations returns the links where this issue is the subject: what it blocks, what
// it duplicates, what it is related to.
//
// Forward only. The direction of a row is part of its meaning — issueId blocks
// relatedIssueId — so handing back a row read from the far end would tell a caller that an
// issue blocks itself. The far end has its own listing.
func (s *Service) ListIssueRelations(
	ctx context.Context, p *authz.Principal, issueID uuid.UUID,
) ([]model.IssueRelation, error) {
	q := s.db.Queries()
	if err := s.requireIssueVisible(ctx, q, p, issueID); err != nil {
		return nil, err
	}
	rows, err := q.ListIssueRelations(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return toRelations(rows), nil
}

// ListIssuesBlocking returns the links where this issue is the one being blocked.
//
// The same rows as ListIssueRelations, read backwards, filtered to `blocks`. Reversing a
// `duplicate` row would read as "this issue is a duplicate of that one" backwards, and
// `related` is already listed from its canonical end, so `blocks` is the only type whose
// far-end reading is a thing the product has a name for.
func (s *Service) ListIssuesBlocking(
	ctx context.Context, p *authz.Principal, issueID uuid.UUID,
) ([]model.IssueRelation, error) {
	q := s.db.Queries()
	if err := s.requireIssueVisible(ctx, q, p, issueID); err != nil {
		return nil, err
	}
	rows, err := q.ListReverseIssueRelations(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.IssueRelation, 0, len(rows))
	for _, r := range rows {
		if r.Type != model.RelationBlocks {
			continue
		}
		out = append(out, toIssueRelation(r))
	}
	return out, nil
}

// relationScope covers both ends of a link.
//
// A team scope naming one side would mean the other side never sees the relation appear:
// the panel on the far issue stays empty until somebody reloads, and the two teams disagree
// about whether the link exists. A project scope is visible to a member of either team,
// which is exactly the rule the bootstrap query already applies to these rows.
func relationScope(teamA, teamB uuid.UUID) authz.Scope {
	if teamA == teamB {
		return authz.ProjectScope([]uuid.UUID{teamA})
	}
	return authz.ProjectScope([]uuid.UUID{teamA, teamB})
}

func toRelations(rows []store.IssueRelation) []model.IssueRelation {
	out := make([]model.IssueRelation, 0, len(rows))
	for _, r := range rows {
		out = append(out, toIssueRelation(r))
	}
	return out
}

// requireIssueVisible is the read-side gate the relation listings share.
//
// It answers not-found rather than forbidden, the same as GetIssue, because the two
// listings are reachable by id: telling somebody that an issue exists but is not theirs
// would let them enumerate a private team's issues one uuid at a time.
func (s *Service) requireIssueVisible(
	ctx context.Context, q *store.Queries, p *authz.Principal, issueID uuid.UUID,
) error {
	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("issue")
		}
		return platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
		return platform.NotFound("issue")
	}
	return nil
}
