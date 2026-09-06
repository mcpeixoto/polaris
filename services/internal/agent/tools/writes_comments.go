package tools

import (
	"context"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

var commentWriteTools = []Tool{
	{
		Name:        "create_comment",
		Description: "Comment on an issue.",
		InputSchema: objectSchema(map[string]any{
			"id":   stringSchema("Issue UUID or ENG-123 identifier"),
			"body": map[string]any{"type": "string"},
		}, []string{"id", "body"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := svc.GetIssueByRef(ctx, p, strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			row, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
				IssueID: issue.ID,
				Body:    strArg(args, "body"),
			})
			if err != nil {
				return nil, err
			}
			return map[string]any{"id": row.ID.String(), "issueId": row.IssueID.String(), "body": row.Body}, nil
		},
	},
	{
		Name: "update_comment",
		// Comments have no identifier, so a UUID is the only ref there is. list_comments
		// is where one comes from.
		Description: "Edit a comment. The id is the comment's UUID, from list_comments.",
		InputSchema: objectSchema(map[string]any{
			"id":   stringSchema("Comment UUID"),
			"body": map[string]any{"type": "string"},
		}, []string{"id", "body"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			id, err := commentID(args)
			if err != nil {
				return nil, err
			}
			row, _, err := svc.UpdateComment(ctx, p, id, strArg(args, "body"))
			if err != nil {
				return nil, err
			}
			return commentJSON(row), nil
		},
	},
	{
		Name:        "delete_comment",
		Description: "Delete a comment. The id is the comment's UUID, from list_comments.",
		InputSchema: objectSchema(map[string]any{
			"id": stringSchema("Comment UUID"),
		}, []string{"id"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			id, err := commentID(args)
			if err != nil {
				return nil, err
			}
			if _, err := svc.DeleteComment(ctx, p, id); err != nil {
				return nil, err
			}
			return map[string]any{"id": id.String(), "deleted": true}, nil
		},
	},
	{
		Name:        "add_reaction",
		Description: "React to a comment with a single emoji.",
		InputSchema: objectSchema(map[string]any{
			"id":    stringSchema("Comment UUID"),
			"emoji": stringSchema("One emoji"),
		}, []string{"id", "emoji"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			id, err := commentID(args)
			if err != nil {
				return nil, err
			}
			row, _, err := svc.AddReaction(ctx, p, id, strArg(args, "emoji"))
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"id":        row.ID.String(),
				"commentId": row.CommentID.String(),
				"userId":    row.UserID.String(),
				"emoji":     row.Emoji,
			}, nil
		},
	},
}

// writeTools is the write half of the catalogue, in the order clients see it. The three
// pre-existing verbs keep their positions at the head of each group: a tool list is cached
// by clients and reordering it for no reason invalidates those caches.
var writeTools = func() []Tool {
	out := make([]Tool, 0, len(issueWriteTools)+len(projectWriteTools)+len(commentWriteTools))
	out = append(out, issueWriteTools...)
	out = append(out, commentWriteTools...)
	out = append(out, projectWriteTools...)
	return out
}()
