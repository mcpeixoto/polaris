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

type CreateInitiativeLabelInput struct {
	ParentID *uuid.UUID
	IsGroup  bool

	Name        string
	Description *string
	Color       *string

	AfterLabelID *uuid.UUID
}

type UpdateInitiativeLabelInput struct {
	ID           uuid.UUID
	Name         *string
	Description  *string
	Color        *string
	ParentID     *uuid.UUID
	ClearParent  bool
	AfterLabelID *uuid.UUID
}

func (s *Service) CreateInitiativeLabel(
	ctx context.Context, p *authz.Principal, in CreateInitiativeLabelInput,
) (model.InitiativeLabel, int64, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return model.InitiativeLabel{}, 0, platform.Validation("name", "a label needs a name")
	}

	var out model.InitiativeLabel
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage initiative labels")
		}
		parent, err := s.resolveInitiativeLabelGroup(ctx, q, p, in.ParentID)
		if err != nil {
			return err
		}
		pos, err := initiativeLabelPosition(ctx, q, p.WorkspaceID, in.AfterLabelID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateInitiativeLabel(ctx, store.CreateInitiativeLabelParams{
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
			return initiativeLabelWrite{name: name, isGroup: in.IsGroup, parent: parent}.explain(err)
		}
		out = toInitiativeLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeLabel", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateInitiativeLabel(
	ctx context.Context, p *authz.Principal, in UpdateInitiativeLabelInput,
) (model.InitiativeLabel, int64, error) {
	if in.ClearParent && in.ParentID != nil {
		return model.InitiativeLabel{}, 0, platform.Validation("parentId", "cannot set and clear the group in one call")
	}
	var name *string
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if n == "" {
			return model.InitiativeLabel{}, 0, platform.Validation("name", "a label needs a name")
		}
		name = &n
	}

	var out model.InitiativeLabel
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage initiative labels")
		}
		existing, err := s.loadInitiativeLabel(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		parent, err := s.resolveInitiativeLabelGroup(ctx, q, p, in.ParentID)
		if err != nil {
			return err
		}
		var position *string
		if in.AfterLabelID != nil {
			pos, err := initiativeLabelPosition(ctx, q, p.WorkspaceID, in.AfterLabelID)
			if err != nil {
				return err
			}
			position = &pos
		}
		row, err := q.UpdateInitiativeLabel(ctx, store.UpdateInitiativeLabelParams{
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
			return initiativeLabelWrite{name: n, isGroup: existing.IsGroup, parent: parent}.explain(err)
		}
		out = toInitiativeLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeLabel", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveInitiativeLabel(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	if !archived {
		return s.unarchiveInitiativeLabel(ctx, p, id)
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage initiative labels")
		}
		existing, err := s.loadInitiativeLabel(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.IsGroup {
			children, err := q.ListInitiativeLabelsInGroup(ctx, &id)
			if err != nil {
				return platform.Internal(err)
			}
			if len(children) > 0 {
				return platform.Validation("id", fmt.Sprintf(
					"this group still holds %d labels; move them out before archiving it", len(children)))
			}
		}
		applied, err := q.CountInitiativesWithInitiativeLabel(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		if applied > 0 {
			return platform.Validation("id", fmt.Sprintf(
				"%d initiatives still carry this label; remove it from them first", applied))
		}
		if _, err := q.ArchiveInitiativeLabel(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative label")
			}
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeLabel", EntityID: id, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return version, err
}

func (s *Service) unarchiveInitiativeLabel(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if !authz.Can(p, authz.ActionWorkspaceLabelManage) {
			return platform.Forbidden("only an admin can manage initiative labels")
		}
		existing, err := q.GetArchivedInitiativeLabel(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative label")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("initiative label")
		}
		if existing.ParentID != nil {
			parent, err := q.GetInitiativeLabel(ctx, *existing.ParentID)
			if err != nil || parent.ArchivedAt != nil {
				return platform.Validation("id", "the group is archived; restore it before restoring the labels inside it")
			}
		}
		row, err := q.UnarchiveInitiativeLabel(ctx, id)
		if err != nil {
			if store.IsUniqueViolation(err, "initiative_label_name_key") {
				return platform.Validation("name", fmt.Sprintf(
					"a label called %q already exists; rename it before restoring this one", existing.Name))
			}
			return platform.Internal(err)
		}
		out := toInitiativeLabel(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeLabel", EntityID: id, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return version, err
}

func (s *Service) AddInitiativeLabel(
	ctx context.Context, p *authz.Principal, initiativeID, labelID uuid.UUID,
) (model.InitiativeLabelLink, int64, error) {
	var out model.InitiativeLabelLink
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireInitiativeWrite(ctx, q, p, initiativeID)
		if err != nil {
			return err
		}
		lbl, err := s.loadInitiativeLabel(ctx, q, p, labelID)
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
		row, err := q.AddInitiativeLabelLink(ctx, store.AddInitiativeLabelLinkParams{
			ID:           id,
			WorkspaceID:  p.WorkspaceID,
			InitiativeID: initiativeID,
			LabelID:      labelID,
			CreatedBy:    &p.UserID,
		})
		if err != nil {
			return explainInitiativeLabelApplyFailure(err, lbl)
		}
		out = toInitiativeLabelLink(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeLabelLink", EntityID: out.ID, Op: OpUpsert,
			Scope: scope, Payload: out,
		})
		return err
	})
	if err != nil {
		var conflict errInitiativeLabelGroupConflict
		if errors.As(err, &conflict) {
			return model.InitiativeLabelLink{}, 0, s.explainInitiativeLabelGroupConflict(ctx, conflict)
		}
		return model.InitiativeLabelLink{}, 0, err
	}
	return out, version, nil
}

func (s *Service) RemoveInitiativeLabel(
	ctx context.Context, p *authz.Principal, initiativeID, labelID uuid.UUID,
) (uuid.UUID, int64, error) {
	var removed uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireInitiativeWrite(ctx, q, p, initiativeID)
		if err != nil {
			return err
		}
		row, err := q.RemoveInitiativeLabelLink(ctx, store.RemoveInitiativeLabelLinkParams{
			InitiativeID: initiativeID, LabelID: labelID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Validation("labelId", "that label is not on this initiative")
			}
			return platform.Internal(err)
		}
		removed = row.ID
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeLabelLink", EntityID: row.ID, Op: OpDelete,
			Scope: scope,
		})
		return err
	})
	return removed, version, err
}

func (s *Service) ListInitiativeLabels(ctx context.Context, p *authz.Principal) ([]model.InitiativeLabel, error) {
	if !authz.Can(p, authz.ActionWorkspaceLabelManage) && len(p.Teams.IDs()) == 0 {
		return nil, platform.Forbidden("initiative labels")
	}
	rows, err := s.db.Queries().ListInitiativeLabelsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.InitiativeLabel, 0, len(rows))
	for _, row := range rows {
		out = append(out, toInitiativeLabel(row))
	}
	return out, nil
}

func (s *Service) GetInitiativeLabel(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.InitiativeLabel, error) {
	if !authz.Can(p, authz.ActionWorkspaceLabelManage) && len(p.Teams.IDs()) == 0 {
		return model.InitiativeLabel{}, platform.Forbidden("initiative labels")
	}
	row, err := s.loadInitiativeLabel(ctx, s.db.Queries(), p, id)
	if err != nil {
		return model.InitiativeLabel{}, err
	}
	return toInitiativeLabel(row), nil
}

func (s *Service) loadInitiativeLabel(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetInitiativeLabelRow, error) {
	row, err := q.GetInitiativeLabel(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetInitiativeLabelRow{}, platform.NotFound("initiative label")
		}
		return store.GetInitiativeLabelRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetInitiativeLabelRow{}, platform.NotFound("initiative label")
	}
	return row, nil
}

func (s *Service) resolveInitiativeLabelGroup(
	ctx context.Context, q *store.Queries, p *authz.Principal, parentID *uuid.UUID,
) (*store.GetInitiativeLabelRow, error) {
	if parentID == nil {
		return nil, nil
	}
	row, err := s.loadInitiativeLabel(ctx, q, p, *parentID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return nil, platform.Validation("parentId", "no such group")
		}
		return nil, err
	}
	if !row.IsGroup {
		return nil, platform.Validation("parentId", "that label is not a group")
	}
	return &row, nil
}

func initiativeLabelPosition(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, after *uuid.UUID,
) (string, error) {
	if after == nil {
		last, err := q.GetLastInitiativeLabelPosition(ctx, workspaceID)
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}
	anchor, err := q.GetInitiativeLabel(ctx, *after)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("afterLabelId", "no such label")
		}
		return "", platform.Internal(err)
	}
	if anchor.WorkspaceID != workspaceID {
		return "", platform.Validation("afterLabelId", "no such label")
	}
	next, err := q.GetInitiativeLabelPositionAfter(ctx, store.GetInitiativeLabelPositionAfterParams{
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

type initiativeLabelWrite struct {
	name    string
	isGroup bool
	parent  *store.GetInitiativeLabelRow
}

func (w initiativeLabelWrite) explain(err error) error {
	switch {
	case store.IsUniqueViolation(err, "initiative_label_name_key"):
		return platform.Validation("name", fmt.Sprintf("a label called %q already exists in this workspace", w.name))
	case store.IsUniqueViolation(err, "initiative_label_link_one_per_group"):
		group := "that group"
		if w.parent != nil {
			group = fmt.Sprintf("%q", w.parent.Name)
		}
		return platform.Validation("parentId", fmt.Sprintf(
			"moving %q into %s would leave an initiative carrying two labels from that group; remove one first",
			w.name, group))
	default:
		return platform.Internal(err)
	}
}

type errInitiativeLabelGroupConflict struct {
	GroupID uuid.UUID
	LabelID uuid.UUID
}

func (e errInitiativeLabelGroupConflict) Error() string {
	return fmt.Sprintf("initiative already carries a label from group %s", e.GroupID)
}

func explainInitiativeLabelApplyFailure(err error, lbl store.GetInitiativeLabelRow) error {
	if store.IsUniqueViolation(err, "initiative_label_link_one_per_group") && lbl.ParentID != nil {
		return errInitiativeLabelGroupConflict{GroupID: *lbl.ParentID, LabelID: lbl.ID}
	}
	return platform.Internal(err)
}

func (s *Service) explainInitiativeLabelGroupConflict(
	ctx context.Context, conflict errInitiativeLabelGroupConflict,
) error {
	q := s.db.Queries()
	group, err := q.GetInitiativeLabel(ctx, conflict.GroupID)
	if err != nil {
		return platform.Validation("labelId", "this initiative already carries a label from that group")
	}
	return platform.Validation("labelId", fmt.Sprintf(
		"this initiative already carries a label from %q — remove it before applying another", group.Name))
}

func toInitiativeLabel[R initiativeLabelRow](r R) model.InitiativeLabel {
	row := store.GetInitiativeLabelRow(r)
	return model.InitiativeLabel{
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

type initiativeLabelRow interface {
	store.CreateInitiativeLabelRow | store.GetInitiativeLabelRow | store.UpdateInitiativeLabelRow |
		store.ArchiveInitiativeLabelRow | store.UnarchiveInitiativeLabelRow | store.GetArchivedInitiativeLabelRow |
		store.ListInitiativeLabelsInWorkspaceRow | store.ListInitiativeLabelsInGroupRow |
		store.StreamInitiativeLabelsForBootstrapRow
}

func toInitiativeLabelLink(row store.InitiativeLabelLink) model.InitiativeLabelLink {
	return model.InitiativeLabelLink{
		ID:           row.ID,
		WorkspaceID:  row.WorkspaceID,
		InitiativeID: row.InitiativeID,
		LabelID:      row.LabelID,
		GroupID:      row.GroupID,
		CreatedBy:    row.CreatedBy,
		CreatedAt:    row.CreatedAt,
	}
}
