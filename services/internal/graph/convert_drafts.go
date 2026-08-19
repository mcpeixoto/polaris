package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toDraft(d model.Draft) generated.Draft {
	return generated.Draft{
		ID:          d.ID,
		WorkspaceID: d.WorkspaceID,
		UserID:      d.UserID,
		Kind:        draftKindToWire(d.Kind),
		Payload:     d.Payload,
		CreatedAt:   d.CreatedAt,
		UpdatedAt:   d.UpdatedAt,
	}
}

func toDrafts(rows []model.Draft) []generated.Draft {
	out := make([]generated.Draft, 0, len(rows))
	for _, d := range rows {
		out = append(out, toDraft(d))
	}
	return out
}

func draftKindToWire(kind string) generated.DraftKind {
	switch kind {
	case "comment":
		return generated.DraftKindComment
	default:
		return generated.DraftKindIssue
	}
}

func draftKindFromWire(kind generated.DraftKind) string {
	if kind == generated.DraftKindComment {
		return "comment"
	}
	return "issue"
}
