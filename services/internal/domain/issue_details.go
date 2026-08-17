package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The collections that hang off an issue — its labels, its children, its links and its
// watchers — read for a whole page of issues at once.
//
// Every one of these has a single-issue twin elsewhere in this package, and the twins are
// the right shape for the panel that opens one issue. They are the wrong shape for a list:
// the API resolves a query like `issues { labels { name } progress { percent } }` against
// the whole result set, and a per-issue read there is a query per visible row — five
// thousand of them on the seeded workspace the performance acceptance tests use. So each
// function here takes the ids and answers for all of them in one statement, keyed by issue,
// and the caller pays once per collection the query actually named rather than once per row.
//
// Two properties they all share, and both are load-bearing:
//
//   - Visibility is enforced inside the statement, against the principal's team set, not
//     afterwards in Go. These are reads by id, and an id the caller supplied must never be
//     able to confirm that an issue exists in a team they are not in — the same reason every
//     other read in this package answers not-found rather than forbidden. A caller passing
//     ids it got from a previous domain call loses nothing; a caller passing guesses learns
//     nothing.
//   - An id with nothing to show is absent from the map rather than present with an empty
//     slice. The GraphQL layer needs `[]` there and mints it; distinguishing "no rows" from
//     "not yours" is a decision for the layer that knows what null means on the wire.
//
// None of them takes a transaction. They are reads for a response that has already been
// written, so a consistent snapshot across the six of them would buy nothing a client could
// observe — it holds the whole answer for milliseconds and then the change stream corrects
// it anyway.

// SubIssuesFor returns each parent's children and its progress rollup, from one read.
//
// One call for both because they come from the same rows and disagree about archiving on
// purpose. The rollup counts every child, archived included, so that archiving a stray
// sub-issue cannot silently move a parent from "3 of 5" to "3 of 4" with nothing on screen
// to explain the change. The list leaves archived children out, because a client never holds
// an archived issue and a row it cannot open is worse than a row it cannot see.
func (s *Service) SubIssuesFor(
	ctx context.Context, p *authz.Principal, parentIDs []uuid.UUID,
) (map[uuid.UUID]SubIssues, error) {
	out := make(map[uuid.UUID]SubIssues, len(parentIDs))
	if len(parentIDs) == 0 {
		return out, nil
	}

	q := s.db.Queries()
	rows, err := q.ListChildIssuesForParents(ctx, store.ListChildIssuesForParentsParams{
		ParentIds:   parentIDs,
		WorkspaceID: p.WorkspaceID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	if len(rows) == 0 {
		return out, nil
	}

	keys, err := s.teamKeys(ctx, p.WorkspaceID)
	if err != nil {
		return nil, err
	}

	// Grouped in two passes rather than one, because the two answers are drawn from
	// different subsets of the same rows: everything counts towards the rollup, only what
	// the reader can open goes in the list.
	byParent := make(map[uuid.UUID][]store.Issue, len(parentIDs))
	for _, r := range rows {
		if r.ParentID == nil {
			continue
		}
		byParent[*r.ParentID] = append(byParent[*r.ParentID], r)
	}

	for parentID, children := range byParent {
		visible := make([]model.Issue, 0, len(children))
		for _, c := range children {
			if c.ArchivedAt != nil {
				continue
			}
			// A cross-team sub-issue is the normal case — a platform task under a product
			// feature — so some of a parent's children can legitimately be in a team this
			// reader is not in. They still count.
			if !authz.Visible(p, authz.TeamScope(c.TeamID, false)) {
				continue
			}
			visible = append(visible, toIssue(c, keys[c.TeamID]))
		}
		out[parentID] = SubIssues{Children: visible, Progress: rollUpProgress(children)}
	}
	return out, nil
}

// SubIssues is one parent's children, as both a list and a rollup. See SubIssuesFor for why
// the two differ.
type SubIssues struct {
	Children []model.Issue
	Progress *model.IssueProgress
}

// IssuesByID reads a scattered set of issues, dropping the ones the caller cannot see.
//
// Dropping rather than failing, because the caller is resolving a reference — a parent, a
// relation's far end — and a link into a team you are not in is a normal state of a
// cross-team workspace, not an error. What the reader gets is the same thing they would get
// if the link did not exist, which is the only answer that does not leak its existence.
func (s *Service) IssuesByID(
	ctx context.Context, p *authz.Principal, ids []uuid.UUID,
) (map[uuid.UUID]model.Issue, error) {
	out := make(map[uuid.UUID]model.Issue, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListIssuesByIDs(ctx, store.ListIssuesByIDsParams{
		Ids:         ids,
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	if len(rows) == 0 {
		return out, nil
	}

	keys, err := s.teamKeys(ctx, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = toIssue(r, keys[r.TeamID])
	}
	return out, nil
}

// ListIssueLabelsForIssues is ListIssueLabels for a page of issues.
func (s *Service) ListIssueLabelsForIssues(
	ctx context.Context, p *authz.Principal, issueIDs []uuid.UUID,
) (map[uuid.UUID][]model.IssueLabel, error) {
	out := make(map[uuid.UUID][]model.IssueLabel, len(issueIDs))
	if len(issueIDs) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListIssueLabelsForIssues(ctx, store.ListIssueLabelsForIssuesParams{
		IssueIds:    issueIDs,
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, r := range rows {
		out[r.IssueID] = append(out[r.IssueID], toIssueLabel(r))
	}
	return out, nil
}

// ListRelationsForIssues is ListIssueRelations for a page of issues: the forward direction,
// what each issue blocks, duplicates or is related to.
func (s *Service) ListRelationsForIssues(
	ctx context.Context, p *authz.Principal, issueIDs []uuid.UUID,
) (map[uuid.UUID][]model.IssueRelation, error) {
	out := make(map[uuid.UUID][]model.IssueRelation, len(issueIDs))
	if len(issueIDs) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListIssueRelationsForIssues(ctx, store.ListIssueRelationsForIssuesParams{
		IssueIds:    issueIDs,
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, r := range rows {
		out[r.IssueID] = append(out[r.IssueID], toIssueRelation(r))
	}
	return out, nil
}

// ListBlockersForIssues is ListIssuesBlocking for a page of issues: the same rows read from
// the far end, filtered to `blocks`.
//
// Only `blocks` survives the reverse reading, for the reason ListIssuesBlocking gives:
// `duplicate` read backwards says the opposite of what it means, and `related` is symmetric
// and already listed from its canonical end.
func (s *Service) ListBlockersForIssues(
	ctx context.Context, p *authz.Principal, issueIDs []uuid.UUID,
) (map[uuid.UUID][]model.IssueRelation, error) {
	out := make(map[uuid.UUID][]model.IssueRelation, len(issueIDs))
	if len(issueIDs) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListReverseIssueRelationsForIssues(ctx, store.ListReverseIssueRelationsForIssuesParams{
		IssueIds:    issueIDs,
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, r := range rows {
		if r.Type != model.RelationBlocks {
			continue
		}
		out[r.RelatedIssueID] = append(out[r.RelatedIssueID], toIssueRelation(r))
	}
	return out, nil
}

// ListSubscribersForIssues returns who is watching each issue, unsubscribes included.
//
// Included because unsubscribing is a row rather than a deleted one — see the field's
// comment on model.IssueSubscription — and a reader asking "am I watching this" has to be
// able to tell "no, I turned it off" from "not yet", or the control renders as the latter
// and the next comment quietly turns it back on.
func (s *Service) ListSubscribersForIssues(
	ctx context.Context, p *authz.Principal, issueIDs []uuid.UUID,
) (map[uuid.UUID][]model.IssueSubscription, error) {
	out := make(map[uuid.UUID][]model.IssueSubscription, len(issueIDs))
	if len(issueIDs) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListIssueSubscriptionsForIssues(ctx, store.ListIssueSubscriptionsForIssuesParams{
		IssueIds:    issueIDs,
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, r := range rows {
		out[r.IssueID] = append(out[r.IssueID], toIssueSubscription(r))
	}
	return out, nil
}

// teamKeys maps every team in the workspace to its key.
//
// One read for a whole batch, because an issue's identifier (ENG-123) is derived from its
// team's key rather than stored — see the comment on domain.toIssue — and a batch that
// spans teams would otherwise look the key up per row. The listing is unfiltered on
// purpose: it is used to name issues the caller has already been allowed to see, and a key
// is a three-letter prefix rather than something to hide.
func (s *Service) teamKeys(ctx context.Context, workspaceID uuid.UUID) (map[uuid.UUID]string, error) {
	teams, err := s.db.Queries().ListTeamsInWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	keys := make(map[uuid.UUID]string, len(teams))
	for _, t := range teams {
		keys[t.ID] = t.Key
	}
	return keys, nil
}
