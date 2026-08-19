package domain

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const maxDocumentTitleLength = 512

type CreateDocumentInput struct {
	TeamID    uuid.UUID
	ProjectID *uuid.UUID
	Title     string
	Body      string
}

type UpdateDocumentInput struct {
	ID    uuid.UUID
	Title *string
	Body  *string
}

// CreateDocument saves markdown attached to a team or a project.
//
// Project documents still carry team_id — denormalised from the project's first team — so
// sync scope, webhooks and private-team visibility stay one code path.
func (s *Service) CreateDocument(
	ctx context.Context, p *authz.Principal, in CreateDocumentInput,
) (model.Document, int64, error) {
	title, err := documentTitle(in.Title)
	if err != nil {
		return model.Document{}, 0, err
	}
	body := in.Body
	if len(body) > maxDescriptionLength {
		return model.Document{}, 0, platform.Validation("body", "that body is too long")
	}

	var out model.Document
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		teamID, projectID, scope, err := s.resolveDocumentParent(ctx, q, p, in.TeamID, in.ProjectID, authz.ActionIssueCreate)
		if err != nil {
			return err
		}

		sortOrder, err := nextDocumentSort(ctx, q, teamID, projectID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateDocument(ctx, store.CreateDocumentParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      teamID,
			ProjectID:   projectID,
			Title:       title,
			Body:        body,
			SortOrder:   sortOrder,
			CreatorID:   &creator,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toDocument(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "document", EntityID: id, Op: OpUpsert,
			TeamID: &teamID, Scope: scope, Payload: out,
		})
		return err
	})
	if err != nil {
		return model.Document{}, 0, err
	}
	return out, version, nil
}

// UpdateDocument edits title and/or body. Any workspace member who can see the document
// may edit it, matching issue descriptions.
func (s *Service) UpdateDocument(
	ctx context.Context, p *authz.Principal, in UpdateDocumentInput,
) (model.Document, int64, error) {
	if in.Title == nil && in.Body == nil {
		return model.Document{}, 0, platform.Validation("input", "nothing to update")
	}

	var out model.Document
	var version int64
	var changed []string
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, scope, err := s.requireDocumentWrite(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("document")
		}

		title := existing.Title
		if in.Title != nil {
			parsed, err := documentTitle(*in.Title)
			if err != nil {
				return err
			}
			title = parsed
			changed = append(changed, "title")
		}
		body := existing.Body
		if in.Body != nil {
			if len(*in.Body) > maxDescriptionLength {
				return platform.Validation("body", "that body is too long")
			}
			body = *in.Body
			changed = append(changed, "body")
		}

		updater := p.UserID
		row, err := q.UpdateDocument(ctx, store.UpdateDocumentParams{
			ID:        in.ID,
			Title:     title,
			Body:      body,
			UpdatedBy: &updater,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toDocument(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "document", EntityID: in.ID, Op: OpUpsert,
			TeamID: &existing.TeamID, Scope: scope, Payload: out, ChangedFields: changed,
		})
		return err
	})
	if err != nil {
		return model.Document{}, 0, err
	}
	return out, version, nil
}

// ArchiveDocument moves a document off the live list, or brings it back.
func (s *Service) ArchiveDocument(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, scope, err := s.requireDocumentWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("document")
		}

		op := OpUpsert
		var doc model.Document
		if archived {
			op = OpDelete
			if err := q.ArchiveDocument(ctx, id); err != nil {
				return platform.Internal(err)
			}
			doc = toDocument(existing)
		} else {
			row, err := q.UnarchiveDocument(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("document")
				}
				return platform.Internal(err)
			}
			doc = toDocument(row)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "document", EntityID: id, Op: op,
			TeamID: &existing.TeamID, Scope: scope, Payload: doc,
		})
		return err
	})
	return version, err
}

// DeleteDocument soft-deletes, leaving a recovery window like issues.
func (s *Service) DeleteDocument(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, scope, err := s.requireDocumentWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("document")
		}

		row, err := q.SoftDeleteDocument(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("document")
			}
			return platform.Internal(err)
		}
		doc := toDocument(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "document", EntityID: id, Op: OpDelete,
			TeamID: &existing.TeamID, Scope: scope, Payload: doc,
		})
		return err
	})
	return version, err
}

// GetDocument loads one row when the caller may see it.
func (s *Service) GetDocument(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Document, error) {
	row, err := s.db.Queries().GetDocument(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Document{}, platform.NotFound("document")
		}
		return model.Document{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return model.Document{}, platform.NotFound("document")
	}
	if row.ArchivedAt != nil {
		return model.Document{}, platform.NotFound("document")
	}
	scope, err := s.documentScope(ctx, s.db.Queries(), row)
	if err != nil {
		return model.Document{}, err
	}
	if !authz.Visible(p, scope) {
		return model.Document{}, platform.NotFound("document")
	}
	return toDocument(row), nil
}

func (s *Service) resolveDocumentParent(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	teamID uuid.UUID, projectID *uuid.UUID, action authz.Action,
) (uuid.UUID, *uuid.UUID, authz.Scope, error) {
	if projectID != nil {
		_, scope, err := s.requireProjectWrite(ctx, q, p, *projectID, authz.ActionProjectUpdate)
		if err != nil {
			return uuid.Nil, nil, authz.Scope{}, err
		}
		teamIDs, err := q.ListProjectTeamIDs(ctx, *projectID)
		if err != nil {
			return uuid.Nil, nil, authz.Scope{}, platform.Internal(err)
		}
		if len(teamIDs) == 0 {
			return uuid.Nil, nil, authz.Scope{}, platform.Validation("projectId", "that project has no team")
		}
		teamID := teamIDs[0]
		if !authz.CanInTeam(p, action, teamID, false) {
			return uuid.Nil, nil, authz.Scope{}, platform.Forbidden("document")
		}
		pid := *projectID
		return teamID, &pid, scope, nil
	}

	team, err := s.requireTeamAccess(ctx, q, p, teamID, action)
	if err != nil {
		return uuid.Nil, nil, authz.Scope{}, err
	}
	return teamID, nil, authz.TeamScope(teamID, team.Private), nil
}

func (s *Service) requireDocumentWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Document, authz.Scope, error) {
	row, err := q.GetDocumentForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Document{}, authz.Scope{}, platform.NotFound("document")
		}
		return store.Document{}, authz.Scope{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return store.Document{}, authz.Scope{}, platform.NotFound("document")
	}
	scope, err := s.documentScope(ctx, q, row)
	if err != nil {
		return store.Document{}, authz.Scope{}, err
	}
	if !authz.Visible(p, scope) {
		return store.Document{}, authz.Scope{}, platform.NotFound("document")
	}
	if !authz.CanInTeam(p, authz.ActionIssueUpdate, row.TeamID, false) {
		return store.Document{}, authz.Scope{}, platform.Forbidden("document")
	}
	return row, scope, nil
}

func (s *Service) documentScope(ctx context.Context, q *store.Queries, row store.Document) (authz.Scope, error) {
	if row.ProjectID != nil {
		return s.projectScope(ctx, q, *row.ProjectID)
	}
	team, err := q.GetTeam(ctx, row.TeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return authz.Scope{}, platform.NotFound("team")
		}
		return authz.Scope{}, platform.Internal(err)
	}
	return authz.TeamScope(row.TeamID, team.Private), nil
}

func nextDocumentSort(ctx context.Context, q *store.Queries, teamID uuid.UUID, projectID *uuid.UUID) (string, error) {
	if projectID != nil {
		last, err := q.LastDocumentSortOrderForProject(ctx, projectID)
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}
	last, err := q.LastDocumentSortOrderForTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func documentTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if title == "" {
		return "", platform.Validation("title", "a document needs a title")
	}
	if len(title) > maxDocumentTitleLength {
		return "", platform.Validation("title", "that title is too long")
	}
	return title, nil
}

func toDocument(d store.Document) model.Document {
	out := model.Document{
		ID:          d.ID,
		WorkspaceID: d.WorkspaceID,
		TeamID:      d.TeamID,
		ProjectID:   d.ProjectID,
		Title:       d.Title,
		Body:        d.Body,
		SortOrder:   d.SortOrder,
		CreatorID:   d.CreatorID,
		UpdatedBy:   d.UpdatedBy,
		CreatedAt:   d.CreatedAt,
		UpdatedAt:   d.UpdatedAt,
		ArchivedAt:  d.ArchivedAt,
		DeletedAt:   d.DeletedAt,
	}
	return out
}
