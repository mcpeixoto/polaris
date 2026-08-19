package domain

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type CreateProjectLabelInput struct {
	ParentID *uuid.UUID
	IsGroup  bool

	Name        string
	Description *string
	Color       *string

	AfterLabelID *uuid.UUID
}

type UpdateProjectLabelInput struct {
	ID           uuid.UUID
	Name         *string
	Description  *string
	Color        *string
	ParentID     *uuid.UUID
	ClearParent  bool
	AfterLabelID *uuid.UUID
}

func (s *Service) CreateProjectLabel(
	ctx context.Context, p *authz.Principal, in CreateProjectLabelInput,
) (model.ProjectLabel, int64, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return model.ProjectLabel{}, 0, platform.Validation("name", "a label needs a name")
	}

	var out model.ProjectLabel
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage project labels")
		}
		parent, err := s.resolveProjectLabelGroup(ctx, q, p, in.ParentID)
		if err != nil {
			return err
		}
		pos, err := projectLabelPosition(ctx, q, p.WorkspaceID, in.AfterLabelID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateProjectLabel(ctx, store.CreateProjectLabelParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			ParentID:    in.ParentID,
			IsGroup:     in.IsGroup,
			Name:        name,
			Description: in.Description,
			Color:       normaliseColor(in.Color),
			Position:    pos,
		})
		if err != nil {
			return projectLabelWrite{name: name, isGroup: in.IsGroup, parent: parent}.explain(err)
		}
		out = toProjectLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectLabel", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateProjectLabel(
	ctx context.Context, p *authz.Principal, in UpdateProjectLabelInput,
) (model.ProjectLabel, int64, error) {
	if in.ClearParent && in.ParentID != nil {
		return model.ProjectLabel{}, 0, platform.Validation("parentId", "cannot set and clear the group in one call")
	}
	var name *string
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if n == "" {
			return model.ProjectLabel{}, 0, platform.Validation("name", "a label needs a name")
		}
		name = &n
	}

	var out model.ProjectLabel
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage project labels")
		}
		existing, err := s.loadProjectLabel(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		parent, err := s.resolveProjectLabelGroup(ctx, q, p, in.ParentID)
		if err != nil {
			return err
		}
		var position *string
		if in.AfterLabelID != nil {
			pos, err := projectLabelPosition(ctx, q, p.WorkspaceID, in.AfterLabelID)
			if err != nil {
				return err
			}
			position = &pos
		}
		row, err := q.UpdateProjectLabel(ctx, store.UpdateProjectLabelParams{
			ID:          in.ID,
			Name:        name,
			Description: in.Description,
			Color:       normaliseColor(in.Color),
			Position:    position,
			ParentID:    in.ParentID,
			ClearParent: in.ClearParent,
		})
		if err != nil {
			n := existing.Name
			if name != nil {
				n = *name
			}
			return projectLabelWrite{name: n, isGroup: existing.IsGroup, parent: parent}.explain(err)
		}
		out = toProjectLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectLabel", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveProjectLabel(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	if !archived {
		return s.unarchiveProjectLabel(ctx, p, id)
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage project labels")
		}
		existing, err := s.loadProjectLabel(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.IsGroup {
			children, err := q.ListProjectLabelsInGroup(ctx, &id)
			if err != nil {
				return platform.Internal(err)
			}
			if len(children) > 0 {
				return platform.Validation("id", fmt.Sprintf(
					"this group still holds %d labels; move them out before archiving it", len(children)))
			}
		}
		applied, err := q.CountProjectsWithProjectLabel(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		if applied > 0 {
			return platform.Validation("id", fmt.Sprintf(
				"%d projects still carry this label; remove it from them first", applied))
		}
		if _, err := q.ArchiveProjectLabel(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project label")
			}
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectLabel", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return version, err
}

func (s *Service) unarchiveProjectLabel(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage project labels")
		}
		existing, err := q.GetArchivedProjectLabel(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project label")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project label")
		}
		if existing.ParentID != nil {
			parent, err := q.GetProjectLabel(ctx, *existing.ParentID)
			if err != nil || parent.ArchivedAt != nil {
				return platform.Validation("id", "the group is archived; restore it before restoring the labels inside it")
			}
		}
		row, err := q.UnarchiveProjectLabel(ctx, id)
		if err != nil {
			if store.IsUniqueViolation(err, "project_label_name_key") {
				return platform.Validation("name", fmt.Sprintf(
					"a label called %q already exists; rename it before restoring this one", existing.Name))
			}
			return platform.Internal(err)
		}
		out := toProjectLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectLabel", EntityID: id, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return version, err
}

func (s *Service) AddProjectLabel(
	ctx context.Context, p *authz.Principal, projectID, labelID uuid.UUID,
) (model.ProjectLabelLink, int64, error) {
	var out model.ProjectLabelLink
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		lbl, err := s.loadProjectLabel(ctx, q, p, labelID)
		if err != nil {
			if platform.CodeOf(err) == platform.CodeNotFound {
				return platform.Validation("labelId", "no such label")
			}
			return err
		}
		if lbl.IsGroup {
			return platform.Validation("labelId", "a group cannot be applied — choose one of its labels")
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.AddProjectLabelLink(ctx, store.AddProjectLabelLinkParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			ProjectID:   projectID,
			LabelID:     labelID,
			CreatedBy:   &p.UserID,
		})
		if err != nil {
			return explainProjectLabelApplyFailure(err, lbl)
		}
		out = toProjectLabelLink(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectLabelLink", EntityID: out.ID, Op: OpUpsert,
			Scope: scope, Payload: out,
		})
		return err
	})
	if err != nil {
		var conflict errProjectLabelGroupConflict
		if errors.As(err, &conflict) {
			return model.ProjectLabelLink{}, 0, s.explainProjectLabelGroupConflict(ctx, conflict)
		}
		return model.ProjectLabelLink{}, 0, err
	}
	return out, version, nil
}

func (s *Service) RemoveProjectLabel(
	ctx context.Context, p *authz.Principal, projectID, labelID uuid.UUID,
) (uuid.UUID, int64, error) {
	var removed uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		row, err := q.RemoveProjectLabelLink(ctx, store.RemoveProjectLabelLinkParams{
			ProjectID: projectID, LabelID: labelID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Validation("labelId", "that label is not on this project")
			}
			return platform.Internal(err)
		}
		removed = row.ID
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectLabelLink", EntityID: row.ID, Op: OpDelete,
			Scope: scope,
		})
		return err
	})
	return removed, version, err
}

func (s *Service) ListProjectLabels(ctx context.Context, p *authz.Principal) ([]model.ProjectLabel, error) {
	if !authz.Can(p, authz.ActionWorkspaceLabelManage) && len(p.Teams.IDs()) == 0 {
		return nil, platform.Forbidden("project labels")
	}
	rows, err := s.db.Queries().ListProjectLabelsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectLabel, 0, len(rows))
	for _, row := range rows {
		out = append(out, toProjectLabel(row))
	}
	return out, nil
}

func (s *Service) GetProjectLabel(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.ProjectLabel, error) {
	if !authz.Can(p, authz.ActionWorkspaceLabelManage) && len(p.Teams.IDs()) == 0 {
		return model.ProjectLabel{}, platform.Forbidden("project labels")
	}
	row, err := s.loadProjectLabel(ctx, s.db.Queries(), p, id)
	if err != nil {
		return model.ProjectLabel{}, err
	}
	return toProjectLabel(row), nil
}

func (s *Service) loadProjectLabel(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetProjectLabelRow, error) {
	row, err := q.GetProjectLabel(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetProjectLabelRow{}, platform.NotFound("project label")
		}
		return store.GetProjectLabelRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetProjectLabelRow{}, platform.NotFound("project label")
	}
	return row, nil
}

func (s *Service) resolveProjectLabelGroup(
	ctx context.Context, q *store.Queries, p *authz.Principal, parentID *uuid.UUID,
) (*store.GetProjectLabelRow, error) {
	if parentID == nil {
		return nil, nil
	}
	row, err := s.loadProjectLabel(ctx, q, p, *parentID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return nil, platform.Validation("parentId", "no such group")
		}
		return nil, err
	}
	return &row, nil
}

func projectLabelPosition(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, after *uuid.UUID,
) (string, error) {
	if after == nil {
		last, err := q.GetLastProjectLabelPosition(ctx, workspaceID)
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}
	anchor, err := q.GetProjectLabel(ctx, *after)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("afterLabelId", "no such label")
		}
		return "", platform.Internal(err)
	}
	if anchor.WorkspaceID != workspaceID {
		return "", platform.Validation("afterLabelId", "no such label")
	}
	next, err := q.GetProjectLabelPositionAfter(ctx, store.GetProjectLabelPositionAfterParams{
		WorkspaceID: workspaceID, Position: anchor.Position,
	})
	if err != nil && !store.IsNotFound(err) {
		return "", platform.Internal(err)
	}
	upper := ""
	if err == nil {
		upper = next
	}
	return fractional.Between(anchor.Position, upper)
}

type projectLabelWrite struct {
	name    string
	isGroup bool
	parent  *store.GetProjectLabelRow
}

func (w projectLabelWrite) explain(err error) error {
	switch {
	case store.IsUniqueViolation(err, "project_label_name_key"):
		return platform.Validation("name", fmt.Sprintf("a label called %q already exists in this workspace", w.name))
	case store.IsUniqueViolation(err, "project_label_link_one_per_group"):
		group := "that group"
		if w.parent != nil {
			group = fmt.Sprintf("%q", w.parent.Name)
		}
		return platform.Validation("parentId", fmt.Sprintf(
			"moving %q into %s would leave a project carrying two labels from that group; remove one first",
			w.name, group))
	default:
		return platform.Internal(err)
	}
}

type errProjectLabelGroupConflict struct {
	GroupID uuid.UUID
	LabelID uuid.UUID
}

func (e errProjectLabelGroupConflict) Error() string {
	return fmt.Sprintf("project already carries a label from group %s", e.GroupID)
}

func explainProjectLabelApplyFailure(err error, lbl store.GetProjectLabelRow) error {
	if store.IsUniqueViolation(err, "project_label_link_one_per_group") && lbl.ParentID != nil {
		return errProjectLabelGroupConflict{GroupID: *lbl.ParentID, LabelID: lbl.ID}
	}
	return platform.Internal(err)
}

func (s *Service) explainProjectLabelGroupConflict(
	ctx context.Context, conflict errProjectLabelGroupConflict,
) error {
	q := s.db.Queries()
	group, err := q.GetProjectLabel(ctx, conflict.GroupID)
	if err != nil {
		return platform.Validation("labelId", "this project already carries a label from that group")
	}
	return platform.Validation("labelId", fmt.Sprintf(
		"this project already carries a label from %q — remove it before applying another", group.Name))
}

func toProjectLabel[R projectLabelRow](r R) model.ProjectLabel {
	row := store.GetProjectLabelRow(r)
	return model.ProjectLabel{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		ParentID:    row.ParentID,
		IsGroup:     row.IsGroup,
		Name:        row.Name,
		Description: row.Description,
		Color:       row.Color,
		Position:    row.Position,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
		ArchivedAt:  row.ArchivedAt,
	}
}

type projectLabelRow interface {
	store.CreateProjectLabelRow | store.GetProjectLabelRow | store.UpdateProjectLabelRow |
		store.ArchiveProjectLabelRow | store.UnarchiveProjectLabelRow | store.GetArchivedProjectLabelRow |
		store.ListProjectLabelsInWorkspaceRow | store.ListProjectLabelsInGroupRow
}

func toProjectLabelLink(row store.ProjectLabelLink) model.ProjectLabelLink {
	return model.ProjectLabelLink{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		ProjectID:   row.ProjectID,
		LabelID:     row.LabelID,
		GroupID:     row.GroupID,
		CreatedBy:   row.CreatedBy,
		CreatedAt:   row.CreatedAt,
	}
}
