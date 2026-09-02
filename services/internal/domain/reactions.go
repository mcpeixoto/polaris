package domain

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Emoji reactions on comments — feature 6.4's last piece.
//
// The rules that make this the simplest write in the product:
//
//   - You may only add or remove your OWN reaction. There is no "remove somebody else's",
//     not even for an admin: a reaction is a signature, and an admin who can delete the
//     comment can delete the reactions with it.
//   - Permission comes from the comment's issue, exactly as commenting does. Anybody who
//     can read a thread can react in it.
//   - Both writes are idempotent without a read. Add conflicts on the unique key and
//     writes nothing; remove finds no row and returns "already gone". Neither mints a
//     version for a no-op, so a retried mutation costs the workspace nothing.

const (
	// maxEmojiLength matches the column's CHECK. Long enough for a ZWJ sequence with skin
	// tones, short enough that the field cannot be used to carry a message.
	maxEmojiLength = 64

	// maxEmojiRunes is the second half of "this is one emoji, not a sentence". The byte
	// cap alone admits sixty-four ASCII characters; a single emoji, even a four-person
	// family with tones, is well under this.
	maxEmojiRunes = 16
)

// validateEmoji refuses anything that is not plausibly a single emoji.
//
// Deliberately shape-based rather than a Unicode-property test against an emoji table:
// that table is versioned, the client's picker is versioned separately, and the day they
// disagree the product refuses a character the user can see on their own keyboard. Bounding
// the length keeps the column from becoming a message field, which is the actual risk.
func validateEmoji(raw string) (string, error) {
	emoji := strings.TrimSpace(raw)
	if emoji == "" {
		return "", platform.Validation("emoji", "a reaction needs an emoji")
	}
	if len(emoji) > maxEmojiLength || utf8.RuneCountInString(emoji) > maxEmojiRunes {
		return "", platform.Validation("emoji", "that is not a single emoji")
	}
	if strings.ContainsAny(emoji, " \t\n\r") {
		// Whitespace inside means two things, and two things is a message.
		return "", platform.Validation("emoji", "that is not a single emoji")
	}
	return emoji, nil
}

// AddReaction puts the caller's emoji on a comment.
//
// Returns the reaction and the version it was written at. A reaction that was already there
// returns the existing row with version 0 — no write happened, so there is no delta for a
// client to wait on, and the same rule BulkUpdateIssues uses for an empty selection applies:
// version 0 means "stop holding your optimistic state, nothing is coming".
func (s *Service) AddReaction(
	ctx context.Context, p *authz.Principal, commentID uuid.UUID, emoji string,
) (model.Reaction, int64, error) {
	emoji, err := validateEmoji(emoji)
	if err != nil {
		return model.Reaction{}, 0, err
	}

	var out model.Reaction
	var version int64

	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		comment, issue, team, err := s.reactableComment(ctx, q, p, commentID)
		if err != nil {
			return err
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		rows, err := q.AddReaction(ctx, store.AddReactionParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			CommentID:   comment.ID,
			UserID:      p.UserID,
			Emoji:       emoji,
		})
		if err != nil {
			return platform.Internal(err)
		}
		if len(rows) == 0 {
			// Already there. The conflict IS the idempotency, so this is a success with
			// nothing to emit — but the caller still wants the row, so it is read back.
			existing, err := q.ListReactionsForComments(ctx, store.ListReactionsForCommentsParams{
				CommentIds:  []uuid.UUID{comment.ID},
				WorkspaceID: p.WorkspaceID,
				TeamIds:     p.Teams.IDs(),
			})
			if err != nil {
				return platform.Internal(err)
			}
			for _, row := range existing {
				if row.UserID == p.UserID && row.Emoji == emoji {
					out = toReaction(row)
					return nil
				}
			}
			// The row conflicted and then could not be found: a concurrent removal
			// between the two statements. Nothing is wrong and nothing is there.
			return platform.Conflict("that reaction was removed while it was being added")
		}
		out = toReaction(rows[0])

		// Scoped to the issue's team, like the comment it sits on: the scope on the change
		// row is the only thing the hub consults, and a reaction must never outlive the
		// visibility of what it reacts to.
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "reaction", EntityID: out.ID, Op: OpUpsert,
			TeamID: &issue.TeamID, Scope: authz.TeamScope(issue.TeamID, team.Private),
			Payload: out,
		})
		return err
	})
	if err != nil {
		return model.Reaction{}, 0, err
	}
	return out, version, nil
}

// RemoveReaction takes the caller's own emoji off a comment.
//
// Returns the id of the row that disappeared. A reaction that was not there returns the nil
// uuid and version 0 rather than an error: removing something already gone is the outcome
// the caller asked for, and a retried mutation must not fail.
func (s *Service) RemoveReaction(
	ctx context.Context, p *authz.Principal, commentID uuid.UUID, emoji string,
) (uuid.UUID, int64, error) {
	emoji, err := validateEmoji(emoji)
	if err != nil {
		return uuid.Nil, 0, err
	}

	var removed uuid.UUID
	var version int64

	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, issue, team, err := s.reactableComment(ctx, q, p, commentID)
		if err != nil {
			return err
		}

		row, err := q.RemoveReaction(ctx, store.RemoveReactionParams{
			CommentID: commentID,
			UserID:    p.UserID,
			Emoji:     emoji,
		})
		if err != nil {
			if store.IsNotFound(err) {
				// Already gone. Not an error, and deliberately not a version either.
				return nil
			}
			return platform.Internal(err)
		}
		removed = row.ID

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "reaction", EntityID: row.ID, Op: OpDelete,
			TeamID: &issue.TeamID, Scope: authz.TeamScope(issue.TeamID, team.Private),
		})
		return err
	})
	return removed, version, err
}

// ListReactionsForComments returns each comment's reactions, oldest first.
//
// Batched from the start rather than per comment: a thread is a page of comments, and the
// three collections on Issue that were written per row are the reason this one was not.
func (s *Service) ListReactionsForComments(
	ctx context.Context, p *authz.Principal, commentIDs []uuid.UUID,
) (map[uuid.UUID][]model.Reaction, error) {
	out := make(map[uuid.UUID][]model.Reaction, len(commentIDs))
	if len(commentIDs) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListReactionsForComments(ctx, store.ListReactionsForCommentsParams{
		CommentIds:  commentIDs,
		WorkspaceID: p.WorkspaceID,
		TeamIds:     p.Teams.IDs(),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, row := range rows {
		out[row.CommentID] = append(out[row.CommentID], toReaction(row))
	}
	return out, nil
}

// reactableComment resolves a comment the caller may react to, and the issue and team the
// change row's scope comes from.
//
// A comment the caller cannot see answers not-found, identically to one that does not
// exist — the same rule every other read in this layer follows, so the API is not an
// oracle for the existence of other teams' threads.
func (s *Service) reactableComment(
	ctx context.Context, q *store.Queries, p *authz.Principal, commentID uuid.UUID,
) (store.Comment, store.GetIssueRow, store.Team, error) {
	comment, err := q.GetComment(ctx, commentID)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Comment{}, store.GetIssueRow{}, store.Team{}, platform.NotFound("comment")
		}
		return store.Comment{}, store.GetIssueRow{}, store.Team{}, platform.Internal(err)
	}
	if comment.WorkspaceID != p.WorkspaceID {
		return store.Comment{}, store.GetIssueRow{}, store.Team{}, platform.NotFound("comment")
	}

	issue, err := q.GetIssue(ctx, comment.IssueID)
	if err != nil {
		return store.Comment{}, store.GetIssueRow{}, store.Team{}, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, issue.TeamID)
	if err != nil {
		return store.Comment{}, store.GetIssueRow{}, store.Team{}, platform.Internal(err)
	}
	// Reading the thread is the whole test: reacting is not an edit of anything, so it
	// needs no permission a reader does not already have.
	if !authz.Visible(p, authz.TeamScope(issue.TeamID, team.Private)) {
		return store.Comment{}, store.GetIssueRow{}, store.Team{}, platform.NotFound("comment")
	}
	return comment, issue, team, nil
}

func toReaction(r store.Reaction) model.Reaction {
	return model.Reaction{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		CommentID:   r.CommentID,
		UserID:      r.UserID,
		Emoji:       r.Emoji,
		CreatedAt:   r.CreatedAt,
	}
}
