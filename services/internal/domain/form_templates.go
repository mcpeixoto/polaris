package domain

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type CreateFormTemplateInput struct {
	TeamID      *uuid.UUID
	Name        string
	Description *string
	Properties  json.RawMessage
}

type UpdateFormTemplateInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Properties  json.RawMessage
}

type CreateFormTemplateFieldInput struct {
	FormTemplateID uuid.UUID
	FieldType      model.FormTemplateFieldType
	Label          string
	Description    *string
	Required       bool
	Config         json.RawMessage
}

type UpdateFormTemplateFieldInput struct {
	ID          uuid.UUID
	FieldType   *model.FormTemplateFieldType
	Label       *string
	Description *string
	Required    *bool
	SortOrder   *string
	Config      json.RawMessage
}

func (s *Service) CreateFormTemplate(
	ctx context.Context, p *authz.Principal, in CreateFormTemplateInput,
) (model.FormTemplate, int64, error) {
	name, err := templateName(in.Name)
	if err != nil {
		return model.FormTemplate{}, 0, err
	}
	propertiesJSON, err := jsonObject("properties", in.Properties)
	if err != nil {
		return model.FormTemplate{}, 0, err
	}

	var out model.FormTemplate
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		scope, err := s.requireTemplateScope(ctx, q, p, in.TeamID)
		if err != nil {
			return err
		}

		pos, err := nextFormTemplatePosition(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateFormTemplate(ctx, store.CreateFormTemplateParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      in.TeamID,
			Name:        name,
			Description: in.Description,
			Properties:  propertiesJSON,
			Position:    pos,
			CreatedBy:   &p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toFormTemplate(store.AsFormTemplateRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "formTemplate", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateFormTemplate(
	ctx context.Context, p *authz.Principal, in UpdateFormTemplateInput,
) (model.FormTemplate, int64, error) {
	var name *string
	if in.Name != nil {
		n, err := templateName(*in.Name)
		if err != nil {
			return model.FormTemplate{}, 0, err
		}
		name = &n
	}
	var propertiesJSON json.RawMessage
	if !isAbsentJSON(in.Properties) {
		props, err := jsonObject("properties", in.Properties)
		if err != nil {
			return model.FormTemplate{}, 0, err
		}
		propertiesJSON = props
	}

	var out model.FormTemplate
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireFormTemplateAccess(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, before.TeamID)
		if err != nil {
			return err
		}

		row, err := q.UpdateFormTemplate(ctx, store.UpdateFormTemplateParams{
			ID:          in.ID,
			Name:        name,
			Description: in.Description,
			Properties:  propertiesJSON,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("form template")
			}
			return platform.Internal(err)
		}
		out = toFormTemplate(store.AsFormTemplateRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "formTemplate", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveFormTemplate(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.loadFormTemplateForArchive(ctx, q, p, id, archived)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, before.TeamID)
		if err != nil {
			return err
		}

		changes := []Change{{
			EntityType: "formTemplate", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, before.TeamID), Scope: scope,
		}}

		if archived {
			fields, err := q.ListFormTemplateFields(ctx, id)
			if err != nil {
				return platform.Internal(err)
			}
			for _, f := range fields {
				changes = append(changes, Change{
					EntityType: "formTemplateField", EntityID: f.ID, Op: OpDelete,
					TeamID: scopeTeamID(scope, before.TeamID), Scope: scope,
				})
			}
			if _, err := q.ArchiveFormTemplate(ctx, id); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("form template")
				}
				return platform.Internal(err)
			}
		} else {
			row, err := q.UnarchiveFormTemplate(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("form template")
				}
				return platform.Internal(err)
			}
			changes[0].Op = OpUpsert
			changes[0].Payload = toFormTemplate(store.AsFormTemplateRow(row))

			fields, err := q.ListFormTemplateFields(ctx, id)
			if err != nil {
				return platform.Internal(err)
			}
			for _, f := range fields {
				field := toFormTemplateField(f)
				changes = append(changes, Change{
					EntityType: "formTemplateField", EntityID: f.ID, Op: OpUpsert,
					TeamID: scopeTeamID(scope, before.TeamID), Scope: scope, Payload: field,
				})
			}
		}

		for _, c := range changes {
			var emitErr error
			version, emitErr = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), c)
			if emitErr != nil {
				return emitErr
			}
		}
		return nil
	})
	return id, version, err
}

func (s *Service) ListFormTemplates(
	ctx context.Context, p *authz.Principal, teamID *uuid.UUID,
) ([]model.FormTemplate, error) {
	q := s.db.Queries()

	if teamID != nil {
		team, err := q.GetTeam(ctx, *teamID)
		if err != nil {
			if store.IsNotFound(err) {
				return nil, platform.NotFound("team")
			}
			return nil, platform.Internal(err)
		}
		if team.WorkspaceID != p.WorkspaceID || !authz.Visible(p, authz.TeamScope(team.ID, team.Private)) {
			return nil, platform.NotFound("team")
		}

		rows, err := q.ListFormTemplatesForTeam(ctx, store.ListFormTemplatesForTeamParams{
			WorkspaceID: p.WorkspaceID,
			TeamID:      teamID,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		out := make([]model.FormTemplate, 0, len(rows))
		for _, r := range rows {
			if r.TeamID == nil && !authz.Visible(p, authz.WorkspaceScope()) {
				continue
			}
			out = append(out, toFormTemplate(store.AsFormTemplateRow(r)))
		}
		return out, nil
	}

	rows, err := q.ListFormTemplatesInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.FormTemplate, 0, len(rows))
	for _, r := range rows {
		scope, err := scopeForFormTemplate(ctx, q, r.TeamID)
		if err != nil {
			return nil, err
		}
		if !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toFormTemplate(store.AsFormTemplateRow(r)))
	}
	return out, nil
}

func (s *Service) GetFormTemplate(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.FormTemplate, error) {
	q := s.db.Queries()
	row, err := s.requireFormTemplateAccess(ctx, q, p, id)
	if err != nil {
		return model.FormTemplate{}, err
	}
	scope, err := scopeForFormTemplate(ctx, q, row.TeamID)
	if err != nil {
		return model.FormTemplate{}, err
	}
	if !authz.Visible(p, scope) {
		return model.FormTemplate{}, platform.NotFound("form template")
	}
	return toFormTemplate(store.AsFormTemplateRow(row)), nil
}

func (s *Service) ListFormTemplateFields(
	ctx context.Context, p *authz.Principal, formTemplateID uuid.UUID,
) ([]model.FormTemplateField, error) {
	q := s.db.Queries()
	tpl, err := s.requireFormTemplateAccess(ctx, q, p, formTemplateID)
	if err != nil {
		return nil, err
	}
	scope, err := scopeForFormTemplate(ctx, q, tpl.TeamID)
	if err != nil {
		return nil, err
	}
	if !authz.Visible(p, scope) {
		return nil, platform.NotFound("form template")
	}

	rows, err := q.ListFormTemplateFields(ctx, formTemplateID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.FormTemplateField, 0, len(rows))
	for _, r := range rows {
		out = append(out, toFormTemplateField(r))
	}
	return out, nil
}

func (s *Service) CreateFormTemplateField(
	ctx context.Context, p *authz.Principal, in CreateFormTemplateFieldInput,
) (model.FormTemplateField, int64, error) {
	label, err := formFieldLabel(in.Label)
	if err != nil {
		return model.FormTemplateField{}, 0, err
	}
	if err := validateFormFieldType(in.FieldType); err != nil {
		return model.FormTemplateField{}, 0, err
	}
	configJSON, err := jsonObject("config", in.Config)
	if err != nil {
		return model.FormTemplateField{}, 0, err
	}

	var out model.FormTemplateField
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		tpl, err := s.requireFormTemplateAccess(ctx, q, p, in.FormTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		sortOrder, err := nextFormFieldSortOrder(ctx, q, in.FormTemplateID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateFormTemplateField(ctx, store.CreateFormTemplateFieldParams{
			ID:             id,
			WorkspaceID:    p.WorkspaceID,
			FormTemplateID: in.FormTemplateID,
			FieldType:      string(in.FieldType),
			Label:          label,
			Description:    in.Description,
			Required:       in.Required,
			SortOrder:      sortOrder,
			Config:         configJSON,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toFormTemplateField(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "formTemplateField", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateFormTemplateField(
	ctx context.Context, p *authz.Principal, in UpdateFormTemplateFieldInput,
) (model.FormTemplateField, int64, error) {
	var label *string
	if in.Label != nil {
		l, err := formFieldLabel(*in.Label)
		if err != nil {
			return model.FormTemplateField{}, 0, err
		}
		label = &l
	}
	var fieldType *string
	if in.FieldType != nil {
		if err := validateFormFieldType(*in.FieldType); err != nil {
			return model.FormTemplateField{}, 0, err
		}
		ft := string(*in.FieldType)
		fieldType = &ft
	}
	var configJSON json.RawMessage
	if !isAbsentJSON(in.Config) {
		cfg, err := jsonObject("config", in.Config)
		if err != nil {
			return model.FormTemplateField{}, 0, err
		}
		configJSON = cfg
	}

	var out model.FormTemplateField
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetFormTemplateField(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("form template field")
			}
			return platform.Internal(err)
		}
		if before.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("form template field")
		}

		tpl, err := s.requireFormTemplateAccess(ctx, q, p, before.FormTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		row, err := q.UpdateFormTemplateField(ctx, store.UpdateFormTemplateFieldParams{
			ID:          in.ID,
			FieldType:   fieldType,
			Label:       label,
			Description: in.Description,
			Required:    in.Required,
			SortOrder:   in.SortOrder,
			Config:      configJSON,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("form template field")
			}
			return platform.Internal(err)
		}
		out = toFormTemplateField(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "formTemplateField", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteFormTemplateField(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetFormTemplateField(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("form template field")
			}
			return platform.Internal(err)
		}
		if before.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("form template field")
		}

		tpl, err := s.requireFormTemplateAccess(ctx, q, p, before.FormTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		if _, err := q.DeleteFormTemplateField(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("form template field")
			}
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "formTemplateField", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope,
		})
		return err
	})
	return id, version, err
}

func (s *Service) loadFormTemplateForArchive(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID, archived bool,
) (store.GetFormTemplateRow, error) {
	if archived {
		row, err := s.requireFormTemplateAccess(ctx, q, p, id)
		if err != nil {
			return store.GetFormTemplateRow{}, err
		}
		return row, nil
	}
	row, err := q.GetFormTemplate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetFormTemplateRow{}, platform.NotFound("form template")
		}
		return store.GetFormTemplateRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt == nil {
		return store.GetFormTemplateRow{}, platform.NotFound("form template")
	}
	return row, nil
}

func (s *Service) requireFormTemplateAccess(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetFormTemplateRow, error) {
	row, err := q.GetFormTemplate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetFormTemplateRow{}, platform.NotFound("form template")
		}
		return store.GetFormTemplateRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetFormTemplateRow{}, platform.NotFound("form template")
	}
	return row, nil
}

func scopeForFormTemplate(ctx context.Context, q *store.Queries, teamID *uuid.UUID) (authz.Scope, error) {
	return scopeForTemplate(ctx, q, teamID)
}

func nextFormTemplatePosition(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.GetLastFormTemplatePosition(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func nextFormFieldSortOrder(ctx context.Context, q *store.Queries, formTemplateID uuid.UUID) (string, error) {
	last, err := q.LastFormTemplateFieldSortOrder(ctx, formTemplateID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func formFieldLabel(label string) (string, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return "", platform.Validation("label", "a field needs a label")
	}
	return label, nil
}

func validateFormFieldType(ft model.FormTemplateFieldType) error {
	switch ft {
	case model.FormFieldText, model.FormFieldLongText, model.FormFieldDropdown,
		model.FormFieldCheckboxes, model.FormFieldDate, model.FormFieldFileUpload,
		model.FormFieldInstructions, model.FormFieldLabelGroup, model.FormFieldPriority,
		model.FormFieldTitle, model.FormFieldDueDate:
		return nil
	default:
		return platform.Validation("fieldType", "unknown field type")
	}
}

func toFormTemplate(t store.GetFormTemplateRow) model.FormTemplate {
	return model.FormTemplate{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		TeamID:      t.TeamID,
		Name:        t.Name,
		Description: t.Description,
		Properties:  t.Properties,
		Position:    t.Position,
		CreatedBy:   t.CreatedBy,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		ArchivedAt:  t.ArchivedAt,
	}
}

func toFormTemplateField(f store.FormTemplateField) model.FormTemplateField {
	return model.FormTemplateField{
		ID:             f.ID,
		WorkspaceID:    f.WorkspaceID,
		FormTemplateID: f.FormTemplateID,
		FieldType:      model.FormTemplateFieldType(f.FieldType),
		Label:          f.Label,
		Description:    f.Description,
		Required:       f.Required,
		SortOrder:      f.SortOrder,
		Config:         f.Config,
		CreatedAt:      f.CreatedAt,
		UpdatedAt:      f.UpdatedAt,
	}
}

// validateFormTemplate refuses a form template the caller cannot use for this team.
func (s *Service) validateFormTemplate(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID, formTemplateID *uuid.UUID,
) error {
	if formTemplateID == nil {
		return nil
	}
	row, err := s.requireFormTemplateAccess(ctx, q, p, *formTemplateID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return platform.Validation("formTemplateId", "no such form template")
		}
		return err
	}
	if row.TeamID != nil && *row.TeamID != teamID {
		return platform.Validation("formTemplateId", "that form template belongs to another team")
	}
	return nil
}
