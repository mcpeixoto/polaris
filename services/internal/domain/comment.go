package domain

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const maxCommentLength = 1 << 18 // 256 KiB

const maxQuoteLength = 16384

type CreateCommentInput struct {
	IssueID     uuid.UUID
	Body        string
	ParentID    *uuid.UUID
	AnchorStart *int
	AnchorEnd   *int
	Quote       *string
}

func (s *Service) CreateComment(ctx context.Context, p *authz.Principal, in CreateCommentInput) (model.Comment, int64, error) {
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" {
		return model.Comment{}, 0, platform.Validation("body", "a comment needs some text")
	}
	if len(in.Body) > maxCommentLength {
		return model.Comment{}, 0, platform.Validation("body", "comment is too long")
	}

	var out model.Comment
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		issue, err := q.GetIssue(ctx, in.IssueID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionCommentCreate)
		if err != nil {
			return err
		}

		if in.ParentID != nil {
			parent, err := q.GetComment(ctx, *in.ParentID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.Validation("parentId", "no such comment")
				}
				return platform.Internal(err)
			}
			if parent.IssueID != in.IssueID {
				return platform.Validation("parentId", "that comment is on a different issue")
			}
			// Threading is one level deep. A reply to a reply attaches to the thread
			// root, which is what the UI renders anyway and what keeps fetching a thread
			// a single index scan instead of a recursive walk.
			if parent.ParentID != nil {
				in.ParentID = parent.ParentID
			}
		}

		quote, start, end, err := validateAnchor(in)
		if err != nil {
			return err
		}
		if in.ParentID != nil && quote != nil {
			return platform.Validation("anchorStart", "a reply cannot pin itself to the description")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateComment(ctx, store.CreateCommentParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			IssueID:     in.IssueID,
			ParentID:    in.ParentID,
			Body:        in.Body,
			ActorType:   string(p.Actor().Type),
			ActorID:     p.Actor().ID,
			AnchorStart: int32FromInt(start),
			AnchorEnd:   int32FromInt(end),
			Quote:       quote,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toComment(row)

		// No ChangedFields: an empty list is what tells the notification engine this is a
		// new comment rather than an edit of one, which is the difference between telling
		// the thread something was said and telling it twice.
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "comment", EntityID: id, Op: OpUpsert, TeamID: &issue.TeamID,
			Scope: authz.TeamScope(issue.TeamID, team.Private), Payload: out,
		})
		if err != nil {
			return err
		}

		// Saying something subscribes you to the answer, and being named in it subscribes
		// you to the thread. Neither resurrects an explicit unsubscribe.
		if err := s.SubscribeOnAction(ctx, q, p, in.IssueID, p.UserID, model.SubscribedCommented); err != nil {
			return err
		}
		for _, mentioned := range notify.ParseMentions(in.Body) {
			if err := s.SubscribeOnAction(ctx, q, p, in.IssueID, mentioned, model.SubscribedMentioned); err != nil {
				return err
			}
		}

		if v, err := s.unsnooze(ctx, q, p, team, issue); err != nil {
			return err
		} else if v != 0 {
			version = v
		}
		return nil
	})
	return out, version, err
}

func (s *Service) UpdateComment(ctx context.Context, p *authz.Principal, id uuid.UUID, body string) (model.Comment, int64, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return model.Comment{}, 0, platform.Validation("body", "a comment needs some text")
	}
	if len(body) > maxCommentLength {
		return model.Comment{}, 0, platform.Validation("body", "comment is too long")
	}

	var out model.Comment
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetComment(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("comment")
			}
			return platform.Internal(err)
		}
		issue, err := q.GetIssue(ctx, existing.IssueID)
		if err != nil {
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionCommentUpdate)
		if err != nil {
			return err
		}
		// Editing is author-only. An admin may remove a comment but may not rewrite
		// somebody's words under their name.
		if existing.ActorID == nil || *existing.ActorID != p.UserID {
			return platform.Forbidden("you can only edit your own comments")
		}

		row, err := q.UpdateCommentBody(ctx, store.UpdateCommentBodyParams{ID: id, Body: body})
		if err != nil {
			return platform.Internal(err)
		}
		out = toComment(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "comment", EntityID: id, Op: OpUpsert, TeamID: &issue.TeamID,
			Scope: authz.TeamScope(issue.TeamID, team.Private), Payload: out,
			// An edit, not a new comment. Somebody named in the rewritten text is told;
			// the rest of the thread is not told again that a comment exists.
			ChangedFields: []string{notify.FieldBody},
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteComment(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetComment(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("comment")
			}
			return platform.Internal(err)
		}
		issue, err := q.GetIssue(ctx, existing.IssueID)
		if err != nil {
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionCommentDelete)
		if err != nil {
			return err
		}
		if !authz.CanEditOwnContent(p, existing.ActorID) {
			return platform.Forbidden("you can only delete your own comments")
		}

		if err := q.SoftDeleteComment(ctx, id); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "comment", EntityID: id, Op: OpDelete, TeamID: &issue.TeamID,
			Scope:         authz.TeamScope(issue.TeamID, team.Private),
			ChangedFields: []string{notify.FieldDeleted},
		})
		return err
	})
	return version, err
}

// ResolveComment marks a thread resolved or reopens it. Resolution lives on the thread
// root; passing a reply resolves the thread it belongs to.
func (s *Service) ResolveComment(ctx context.Context, p *authz.Principal, id uuid.UUID, resolved bool) (model.Comment, int64, error) {
	var out model.Comment
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetComment(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("comment")
			}
			return platform.Internal(err)
		}
		if existing.ParentID != nil {
			id = *existing.ParentID
		}
		issue, err := q.GetIssue(ctx, existing.IssueID)
		if err != nil {
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, issue.TeamID, authz.ActionCommentUpdate)
		if err != nil {
			return err
		}

		var (
			at *time.Time
			by *uuid.UUID
		)
		if resolved {
			now := time.Now()
			at, by = &now, &p.UserID
		}
		row, err := q.SetCommentResolution(ctx, store.SetCommentResolutionParams{
			ID: id, ResolvedAt: at, ResolvedBy: by,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toComment(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "comment", EntityID: id, Op: OpUpsert, TeamID: &issue.TeamID,
			Scope: authz.TeamScope(issue.TeamID, team.Private), Payload: out,
			ChangedFields: []string{notify.FieldResolved},
		})
		return err
	})
	return out, version, err
}

func validateAnchor(in CreateCommentInput) (*string, *int, *int, error) {
	hasStart := in.AnchorStart != nil
	hasEnd := in.AnchorEnd != nil
	quote := strings.TrimSpace(ptrString(in.Quote))
	hasQuote := quote != ""
	if !hasStart && !hasEnd && !hasQuote {
		return nil, nil, nil, nil
	}
	if !hasStart || !hasEnd || !hasQuote {
		return nil, nil, nil, platform.Validation("quote", "an inline comment needs a span and the selected text")
	}
	start, end := *in.AnchorStart, *in.AnchorEnd
	if start < 0 || end <= start {
		return nil, nil, nil, platform.Validation("anchorStart", "the span has to run forwards from a non-negative offset")
	}
	if len(quote) > maxQuoteLength {
		return nil, nil, nil, platform.Validation("quote", "the selected text is too long to pin")
	}
	return &quote, &start, &end, nil
}

func ptrString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (s *Service) ListComments(ctx context.Context, p *authz.Principal, issueID uuid.UUID) ([]model.Comment, error) {
	q := s.db.Queries()
	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("issue")
		}
		return nil, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
		return nil, platform.NotFound("issue")
	}

	rows, err := q.ListCommentsForIssue(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Comment, 0, len(rows))
	for _, r := range rows {
		out = append(out, toComment(r))
	}
	return out, nil
}

// ListIssueHistory returns the activity feed for an issue.
func (s *Service) ListIssueHistory(ctx context.Context, p *authz.Principal, issueID uuid.UUID) ([]model.IssueHistoryEntry, error) {
	q := s.db.Queries()
	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("issue")
		}
		return nil, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
		return nil, platform.NotFound("issue")
	}

	rows, err := q.ListIssueHistory(ctx, issueID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.IssueHistoryEntry, 0, len(rows))
	for _, r := range rows {
		e := model.IssueHistoryEntry{
			ID:        r.ID,
			IssueID:   r.IssueID,
			Actor:     model.Actor{Type: r.ActorType, ID: r.ActorID},
			Kind:      r.Kind,
			CreatedAt: r.CreatedAt,
		}
		// The stored values are already JSON; hand them through as raw messages so a
		// string stays a string and a uuid stays a uuid on the wire.
		if len(r.FromValue) > 0 {
			e.FromValue = r.FromValue
		}
		if len(r.ToValue) > 0 {
			e.ToValue = r.ToValue
		}
		out = append(out, e)
	}
	return out, nil
}
