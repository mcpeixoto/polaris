package domain

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Saved drafts. Local composer restore lives on the device; this is the kind that
// survives logout and other browsers, listed on the Drafts page.
//
// They are not replicated. A draft is ScopeUser by construction — the listing query is
// (workspace, user) and update/delete restate the same pair — so putting them on the
// change stream would wake every socket in the workspace for a row only one of them may
// see. Invites and webhooks already live in this on-demand bucket.

const (
	draftKindIssue   = "issue"
	draftKindComment = "comment"

	// Six months from last edit, matching the documented retention. Listings hide older
	// rows as well, so a missed prune cannot resurrect something the product promised
	// was gone.
	DraftRetention = 180 * 24 * time.Hour

	// Bound the payload. An issue description can be long; a megabyte of abandoned
	// markdown in a personal table is still a way to fill the disk.
	maxDraftPayloadBytes = 256 << 10
)

type CreateDraftInput struct {
	ID      *uuid.UUID
	Kind    string
	Payload json.RawMessage
}

type UpdateDraftInput struct {
	ID      uuid.UUID
	Payload json.RawMessage
}

func (s *Service) CreateDraft(
	ctx context.Context, p *authz.Principal, in CreateDraftInput,
) (model.Draft, int64, error) {
	kind, err := normaliseDraftKind(in.Kind)
	if err != nil {
		return model.Draft{}, 0, err
	}
	payload, err := normaliseDraftPayload(kind, in.Payload)
	if err != nil {
		return model.Draft{}, 0, err
	}

	id := uuid.Nil
	if in.ID != nil {
		id = *in.ID
	}
	if id == uuid.Nil {
		generated, err := uuid.NewV7()
		if err != nil {
			return model.Draft{}, 0, platform.Internal(err)
		}
		id = generated
	}

	var out model.Draft
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.CreateDraft(ctx, store.CreateDraftParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			Kind:        kind,
			Payload:     payload,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = draftFromRow(row)
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	return out, version, err
}

func (s *Service) UpdateDraft(
	ctx context.Context, p *authz.Principal, in UpdateDraftInput,
) (model.Draft, int64, error) {
	existing, err := s.db.Queries().GetDraft(ctx, store.GetDraftParams{
		ID:          in.ID,
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return model.Draft{}, 0, platform.NotFound("draft")
		}
		return model.Draft{}, 0, platform.Internal(err)
	}

	payload, err := normaliseDraftPayload(existing.Kind, in.Payload)
	if err != nil {
		return model.Draft{}, 0, err
	}

	var out model.Draft
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.UpdateDraftPayload(ctx, store.UpdateDraftPayloadParams{
			Payload:     payload,
			ID:          in.ID,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("draft")
			}
			return platform.Internal(err)
		}
		out = draftFromRow(row)
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	return out, version, err
}

func (s *Service) DeleteDraft(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		deleted, err := q.DeleteDraft(ctx, store.DeleteDraftParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("draft")
			}
			return platform.Internal(err)
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id = deleted
		return nil
	})
	return id, version, err
}

func (s *Service) ListDrafts(ctx context.Context, p *authz.Principal) ([]model.Draft, error) {
	rows, err := s.db.Queries().ListDraftsForUser(ctx, store.ListDraftsForUserParams{
		WorkspaceID: p.WorkspaceID,
		UserID:      p.UserID,
		Since:       time.Now().Add(-DraftRetention),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Draft, 0, len(rows))
	for _, row := range rows {
		out = append(out, draftFromRow(row))
	}
	return out, nil
}

// PruneDrafts deletes drafts past the retention window. Run nightly.
func (s *Service) PruneDrafts(ctx context.Context) (int64, error) {
	n, err := s.db.Queries().PruneDrafts(ctx, time.Now().Add(-DraftRetention))
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n, nil
}

func normaliseDraftKind(kind string) (string, error) {
	switch kind {
	case draftKindIssue, draftKindComment, "ISSUE", "COMMENT":
		if kind == "ISSUE" {
			return draftKindIssue, nil
		}
		if kind == "COMMENT" {
			return draftKindComment, nil
		}
		return kind, nil
	default:
		return "", platform.Validation("kind", "a draft is an issue or a comment")
	}
}

func normaliseDraftPayload(kind string, raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) > maxDraftPayloadBytes {
		return nil, platform.Validation("payload", "that draft is too large to keep")
	}
	if len(raw) == 0 {
		return nil, platform.Validation("payload", "a draft needs something in it")
	}

	var bag map[string]any
	if err := json.Unmarshal(raw, &bag); err != nil {
		return nil, platform.Validation("payload", "a draft is a JSON object")
	}

	switch kind {
	case draftKindIssue:
		title, _ := bag["title"].(string)
		description, _ := bag["description"].(string)
		if strings.TrimSpace(title) == "" && strings.TrimSpace(description) == "" {
			return nil, platform.Validation("payload", "an issue draft needs a title or a description")
		}
	case draftKindComment:
		body, _ := bag["body"].(string)
		issueID, _ := bag["issueId"].(string)
		if strings.TrimSpace(body) == "" {
			return nil, platform.Validation("payload", "a comment draft needs a body")
		}
		if strings.TrimSpace(issueID) == "" {
			return nil, platform.Validation("payload", "a comment draft has to name the issue it belongs to")
		}
	}

	// Re-encode so the stored bytes are compact and key-order is the encoder's, not
	// whatever the client happened to send. Two clients saving the same draft then
	// produce the same row rather than a whitespace fight.
	out, err := json.Marshal(bag)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return out, nil
}

func draftFromRow(row store.Draft) model.Draft {
	return model.Draft{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		UserID:      row.UserID,
		Kind:        row.Kind,
		Payload:     row.Payload,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
