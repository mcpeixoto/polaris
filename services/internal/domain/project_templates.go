package domain

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type CreateProjectTemplateInput struct {
	TeamID      *uuid.UUID
	Name        string
	Description *string
	Summary     string
	Body        string
	Properties  json.RawMessage
}

type UpdateProjectTemplateInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Summary     *string
	Body        *string
	Properties  json.RawMessage
}

type CreateProjectTemplateMilestoneInput struct {
	ProjectTemplateID uuid.UUID
	Name              string
	Description       *string
	TargetDate        *model.Date
}

type UpdateProjectTemplateMilestoneInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	TargetDate  *model.Date
	SortOrder   *string
}

type CreateProjectTemplateIssueInput struct {
	ProjectTemplateID uuid.UUID
	ParentID          *uuid.UUID
	Title             string
	Description       string
	Properties        json.RawMessage
}

type UpdateProjectTemplateIssueInput struct {
	ID          uuid.UUID
	Title       *string
	Description *string
	Properties  json.RawMessage
	ParentID    *uuid.UUID
	SortOrder   *string
}

type projectTemplateProperties struct {
	StatusID              *uuid.UUID  `json:"statusId"`
	Priority              *int        `json:"priority"`
	LeadID                *uuid.UUID  `json:"leadId"`
	Color                 *string     `json:"color"`
	Icon                  *string     `json:"icon"`
	TeamIDs               []uuid.UUID `json:"teamIds"`
	MemberIDs             []uuid.UUID `json:"memberIds"`
	StartDate             *string     `json:"startDate"`
	StartDateGranularity  *string     `json:"startDateGranularity"`
	TargetDate            *string     `json:"targetDate"`
	TargetDateGranularity *string     `json:"targetDateGranularity"`
	InitiativeIDs         []uuid.UUID `json:"initiativeIds"`
}

type projectTemplateIssueProperties struct {
	TeamID     *uuid.UUID  `json:"teamId"`
	TemplateID *uuid.UUID  `json:"templateId"`
	StateID    *uuid.UUID  `json:"stateId"`
	AssigneeID *uuid.UUID  `json:"assigneeId"`
	Priority   *int        `json:"priority"`
	Estimate   *int        `json:"estimate"`
	LabelIDs   []uuid.UUID `json:"labelIds"`
}

func (s *Service) CreateProjectTemplate(
	ctx context.Context, p *authz.Principal, in CreateProjectTemplateInput,
) (model.ProjectTemplate, int64, error) {
	name, err := templateName(in.Name)
	if err != nil {
		return model.ProjectTemplate{}, 0, err
	}
	if err := validateProjectTemplateContent(&in.Summary, &in.Body); err != nil {
		return model.ProjectTemplate{}, 0, err
	}
	propertiesJSON, err := jsonObject("properties", in.Properties)
	if err != nil {
		return model.ProjectTemplate{}, 0, err
	}

	var out model.ProjectTemplate
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		scope, err := s.requireTemplateScope(ctx, q, p, in.TeamID)
		if err != nil {
			return err
		}

		pos, err := nextProjectTemplatePosition(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateProjectTemplate(ctx, store.CreateProjectTemplateParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      in.TeamID,
			Name:        name,
			Description: in.Description,
			Summary:     strings.TrimSpace(in.Summary),
			Body:        in.Body,
			Properties:  propertiesJSON,
			Position:    pos,
			CreatedBy:   &p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectTemplate(store.AsProjectTemplateRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplate", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateProjectTemplate(
	ctx context.Context, p *authz.Principal, in UpdateProjectTemplateInput,
) (model.ProjectTemplate, int64, error) {
	var name *string
	if in.Name != nil {
		n, err := templateName(*in.Name)
		if err != nil {
			return model.ProjectTemplate{}, 0, err
		}
		name = &n
	}
	if err := validateProjectTemplateContent(in.Summary, in.Body); err != nil {
		return model.ProjectTemplate{}, 0, err
	}
	var propertiesJSON json.RawMessage
	if !isAbsentJSON(in.Properties) {
		props, err := jsonObject("properties", in.Properties)
		if err != nil {
			return model.ProjectTemplate{}, 0, err
		}
		propertiesJSON = props
	}

	var out model.ProjectTemplate
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireProjectTemplateAccess(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, before.TeamID)
		if err != nil {
			return err
		}

		row, err := q.UpdateProjectTemplate(ctx, store.UpdateProjectTemplateParams{
			ID:          in.ID,
			Name:        name,
			Description: in.Description,
			Summary:     in.Summary,
			Body:        in.Body,
			Properties:  propertiesJSON,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template")
			}
			return platform.Internal(err)
		}
		out = toProjectTemplate(store.AsProjectTemplateRow(row))

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplate", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, out.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveProjectTemplate(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (uuid.UUID, int64, error) {
	if !archived {
		return uuid.Nil, 0, platform.NotFound("project template")
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireProjectTemplateAccess(ctx, q, p, id)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, before.TeamID)
		if err != nil {
			return err
		}

		changes := []Change{{
			EntityType: "projectTemplate", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, before.TeamID), Scope: scope,
		}}

		milestones, err := q.ListProjectTemplateMilestones(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		for _, m := range milestones {
			changes = append(changes, Change{
				EntityType: "projectTemplateMilestone", EntityID: m.ID, Op: OpDelete,
				TeamID: scopeTeamID(scope, before.TeamID), Scope: scope,
			})
		}

		issues, err := q.ListProjectTemplateIssues(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		for _, i := range issues {
			changes = append(changes, Change{
				EntityType: "projectTemplateIssue", EntityID: i.ID, Op: OpDelete,
				TeamID: scopeTeamID(scope, before.TeamID), Scope: scope,
			})
		}

		if _, err := q.ArchiveProjectTemplate(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template")
			}
			return platform.Internal(err)
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

func (s *Service) ListProjectTemplates(
	ctx context.Context, p *authz.Principal, teamID *uuid.UUID,
) ([]model.ProjectTemplate, error) {
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

		rows, err := q.ListProjectTemplatesForTeam(ctx, store.ListProjectTemplatesForTeamParams{
			WorkspaceID: p.WorkspaceID,
			TeamID:      teamID,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		out := make([]model.ProjectTemplate, 0, len(rows))
		for _, r := range rows {
			if r.TeamID == nil && !authz.Visible(p, authz.WorkspaceScope()) {
				continue
			}
			out = append(out, toProjectTemplate(store.AsProjectTemplateRow(r)))
		}
		return out, nil
	}

	rows, err := q.ListProjectTemplatesInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectTemplate, 0, len(rows))
	for _, r := range rows {
		scope, err := scopeForTemplate(ctx, q, r.TeamID)
		if err != nil {
			return nil, err
		}
		if !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toProjectTemplate(store.AsProjectTemplateRow(r)))
	}
	return out, nil
}

func (s *Service) GetProjectTemplate(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.ProjectTemplate, error) {
	q := s.db.Queries()
	row, err := s.requireProjectTemplateAccess(ctx, q, p, id)
	if err != nil {
		return model.ProjectTemplate{}, err
	}
	scope, err := scopeForTemplate(ctx, q, row.TeamID)
	if err != nil {
		return model.ProjectTemplate{}, err
	}
	if !authz.Visible(p, scope) {
		return model.ProjectTemplate{}, platform.NotFound("project template")
	}
	return toProjectTemplate(store.AsProjectTemplateRow(row)), nil
}

func (s *Service) ListProjectTemplateMilestones(
	ctx context.Context, p *authz.Principal, projectTemplateID uuid.UUID,
) ([]model.ProjectTemplateMilestone, error) {
	q := s.db.Queries()
	tpl, err := s.requireProjectTemplateAccess(ctx, q, p, projectTemplateID)
	if err != nil {
		return nil, err
	}
	scope, err := scopeForTemplate(ctx, q, tpl.TeamID)
	if err != nil {
		return nil, err
	}
	if !authz.Visible(p, scope) {
		return nil, platform.NotFound("project template")
	}

	rows, err := q.ListProjectTemplateMilestones(ctx, projectTemplateID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectTemplateMilestone, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProjectTemplateMilestone(r))
	}
	return out, nil
}

func (s *Service) ListProjectTemplateIssues(
	ctx context.Context, p *authz.Principal, projectTemplateID uuid.UUID,
) ([]model.ProjectTemplateIssue, error) {
	q := s.db.Queries()
	tpl, err := s.requireProjectTemplateAccess(ctx, q, p, projectTemplateID)
	if err != nil {
		return nil, err
	}
	scope, err := scopeForTemplate(ctx, q, tpl.TeamID)
	if err != nil {
		return nil, err
	}
	if !authz.Visible(p, scope) {
		return nil, platform.NotFound("project template")
	}

	rows, err := q.ListProjectTemplateIssues(ctx, projectTemplateID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectTemplateIssue, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProjectTemplateIssue(r))
	}
	return out, nil
}

func (s *Service) CreateProjectTemplateMilestone(
	ctx context.Context, p *authz.Principal, in CreateProjectTemplateMilestoneInput,
) (model.ProjectTemplateMilestone, int64, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.ProjectTemplateMilestone{}, 0, platform.Validation("name", "a milestone needs a name")
	}
	var target pgtype.Date
	if in.TargetDate != nil {
		day, err := time.Parse(dateLayout, string(*in.TargetDate))
		if err != nil {
			return model.ProjectTemplateMilestone{}, 0, platform.Validation("targetDate", "a date is a calendar day, YYYY-MM-DD")
		}
		target = store.DateOf(day)
	}

	var out model.ProjectTemplateMilestone
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		tpl, err := s.requireProjectTemplateAccess(ctx, q, p, in.ProjectTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		sortOrder, err := nextProjectTemplateMilestoneSort(ctx, q, in.ProjectTemplateID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateProjectTemplateMilestone(ctx, store.CreateProjectTemplateMilestoneParams{
			ID:                id,
			WorkspaceID:       p.WorkspaceID,
			ProjectTemplateID: in.ProjectTemplateID,
			Name:              in.Name,
			Description:       in.Description,
			TargetDate:        target,
			SortOrder:         sortOrder,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectTemplateMilestone(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplateMilestone", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateProjectTemplateMilestone(
	ctx context.Context, p *authz.Principal, in UpdateProjectTemplateMilestoneInput,
) (model.ProjectTemplateMilestone, int64, error) {
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.ProjectTemplateMilestone{}, 0, platform.Validation("name", "a milestone needs a name")
		}
		in.Name = &trimmed
	}
	var target pgtype.Date
	if in.TargetDate != nil {
		day, err := time.Parse(dateLayout, string(*in.TargetDate))
		if err != nil {
			return model.ProjectTemplateMilestone{}, 0, platform.Validation("targetDate", "a date is a calendar day, YYYY-MM-DD")
		}
		target = store.DateOf(day)
	}

	var out model.ProjectTemplateMilestone
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetProjectTemplateMilestone(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template milestone")
			}
			return platform.Internal(err)
		}
		if before.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project template milestone")
		}

		tpl, err := s.requireProjectTemplateAccess(ctx, q, p, before.ProjectTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		row, err := q.UpdateProjectTemplateMilestone(ctx, store.UpdateProjectTemplateMilestoneParams{
			ID:          in.ID,
			Name:        in.Name,
			Description: in.Description,
			TargetDate:  target,
			SortOrder:   in.SortOrder,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template milestone")
			}
			return platform.Internal(err)
		}
		out = toProjectTemplateMilestone(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplateMilestone", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteProjectTemplateMilestone(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetProjectTemplateMilestone(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template milestone")
			}
			return platform.Internal(err)
		}
		if before.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project template milestone")
		}

		tpl, err := s.requireProjectTemplateAccess(ctx, q, p, before.ProjectTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		if err := q.DeleteProjectTemplateMilestone(ctx, id); err != nil {
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplateMilestone", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope,
		})
		return err
	})
	return id, version, err
}

func (s *Service) CreateProjectTemplateIssue(
	ctx context.Context, p *authz.Principal, in CreateProjectTemplateIssueInput,
) (model.ProjectTemplateIssue, int64, error) {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return model.ProjectTemplateIssue{}, 0, platform.Validation("title", "an issue needs a title")
	}
	if len(in.Description) > maxDescriptionLength {
		return model.ProjectTemplateIssue{}, 0, platform.Validation("description", "description is too long")
	}
	propertiesJSON, err := jsonObject("properties", in.Properties)
	if err != nil {
		return model.ProjectTemplateIssue{}, 0, err
	}

	var out model.ProjectTemplateIssue
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		tpl, err := s.requireProjectTemplateAccess(ctx, q, p, in.ProjectTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}
		if in.ParentID != nil {
			parent, err := q.GetProjectTemplateIssue(ctx, *in.ParentID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.Validation("parentId", "no such parent issue")
				}
				return platform.Internal(err)
			}
			if parent.ProjectTemplateID != in.ProjectTemplateID {
				return platform.Validation("parentId", "that parent belongs to another template")
			}
		}

		sortOrder, err := nextProjectTemplateIssueSort(ctx, q, in.ProjectTemplateID, in.ParentID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		row, err := q.CreateProjectTemplateIssue(ctx, store.CreateProjectTemplateIssueParams{
			ID:                id,
			WorkspaceID:       p.WorkspaceID,
			ProjectTemplateID: in.ProjectTemplateID,
			ParentID:          in.ParentID,
			Title:             in.Title,
			Description:       in.Description,
			Properties:        propertiesJSON,
			SortOrder:         sortOrder,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectTemplateIssue(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplateIssue", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateProjectTemplateIssue(
	ctx context.Context, p *authz.Principal, in UpdateProjectTemplateIssueInput,
) (model.ProjectTemplateIssue, int64, error) {
	var title *string
	if in.Title != nil {
		t := strings.TrimSpace(*in.Title)
		if t == "" {
			return model.ProjectTemplateIssue{}, 0, platform.Validation("title", "an issue needs a title")
		}
		title = &t
	}
	if in.Description != nil && len(*in.Description) > maxDescriptionLength {
		return model.ProjectTemplateIssue{}, 0, platform.Validation("description", "description is too long")
	}
	var propertiesJSON json.RawMessage
	if !isAbsentJSON(in.Properties) {
		props, err := jsonObject("properties", in.Properties)
		if err != nil {
			return model.ProjectTemplateIssue{}, 0, err
		}
		propertiesJSON = props
	}

	var out model.ProjectTemplateIssue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetProjectTemplateIssue(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template issue")
			}
			return platform.Internal(err)
		}
		if before.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project template issue")
		}

		tpl, err := s.requireProjectTemplateAccess(ctx, q, p, before.ProjectTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}
		if in.ParentID != nil {
			if *in.ParentID == in.ID {
				return platform.Validation("parentId", "an issue cannot be its own parent")
			}
			parent, err := q.GetProjectTemplateIssue(ctx, *in.ParentID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.Validation("parentId", "no such parent issue")
				}
				return platform.Internal(err)
			}
			if parent.ProjectTemplateID != before.ProjectTemplateID {
				return platform.Validation("parentId", "that parent belongs to another template")
			}
		}

		row, err := q.UpdateProjectTemplateIssue(ctx, store.UpdateProjectTemplateIssueParams{
			ID:          in.ID,
			Title:       title,
			Description: in.Description,
			Properties:  propertiesJSON,
			SortOrder:   in.SortOrder,
			ParentID:    in.ParentID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template issue")
			}
			return platform.Internal(err)
		}
		out = toProjectTemplateIssue(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplateIssue", EntityID: out.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteProjectTemplateIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetProjectTemplateIssue(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project template issue")
			}
			return platform.Internal(err)
		}
		if before.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project template issue")
		}

		tpl, err := s.requireProjectTemplateAccess(ctx, q, p, before.ProjectTemplateID)
		if err != nil {
			return err
		}
		scope, err := s.requireTemplateScope(ctx, q, p, tpl.TeamID)
		if err != nil {
			return err
		}

		if err := q.DeleteProjectTemplateIssue(ctx, id); err != nil {
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTemplateIssue", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, tpl.TeamID), Scope: scope,
		})
		return err
	})
	return id, version, err
}

func (s *Service) requireProjectTemplateAccess(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.GetProjectTemplateRow, error) {
	row, err := q.GetProjectTemplate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.GetProjectTemplateRow{}, platform.NotFound("project template")
		}
		return store.GetProjectTemplateRow{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.ArchivedAt != nil {
		return store.GetProjectTemplateRow{}, platform.NotFound("project template")
	}
	return row, nil
}

func (s *Service) validateProjectTemplate(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamIDs []uuid.UUID, projectTemplateID *uuid.UUID,
) error {
	if projectTemplateID == nil {
		return nil
	}
	row, err := s.requireProjectTemplateAccess(ctx, q, p, *projectTemplateID)
	if err != nil {
		if platform.CodeOf(err) == platform.CodeNotFound {
			return platform.Validation("projectTemplateId", "no such project template")
		}
		return err
	}
	if row.TeamID != nil {
		ok := false
		for _, teamID := range teamIDs {
			if teamID == *row.TeamID {
				ok = true
				break
			}
		}
		if !ok {
			return platform.Validation("projectTemplateId", "that project template belongs to another team")
		}
	}
	return nil
}

func mergeCreateProjectWithTemplate(in *CreateProjectInput, tpl model.ProjectTemplate) error {
	props, err := parseProjectTemplateProperties(tpl.Properties)
	if err != nil {
		return err
	}

	if (in.Summary == nil || strings.TrimSpace(*in.Summary) == "") && tpl.Summary != "" {
		s := tpl.Summary
		in.Summary = &s
	}
	if strings.TrimSpace(in.Description) == "" && tpl.Body != "" {
		in.Description = tpl.Body
	}

	if in.StatusID == nil {
		in.StatusID = props.StatusID
	}
	if in.Priority == 0 && props.Priority != nil {
		in.Priority = *props.Priority
	}
	if in.LeadID == nil {
		in.LeadID = props.LeadID
	}
	if in.Color == nil {
		in.Color = props.Color
	}
	if in.Icon == nil {
		in.Icon = props.Icon
	}
	if len(in.TeamIDs) == 0 && len(props.TeamIDs) > 0 {
		in.TeamIDs = props.TeamIDs
	}
	if len(in.MemberIDs) == 0 && len(props.MemberIDs) > 0 {
		in.MemberIDs = props.MemberIDs
	}
	if in.StartDate == nil && props.StartDate != nil {
		day, err := time.Parse(dateLayout, *props.StartDate)
		if err != nil {
			return platform.Validation("startDate", "template start date must be YYYY-MM-DD")
		}
		d := model.Date(day.Format(dateLayout))
		in.StartDate = &d
	}
	if in.StartDateGranularity == nil {
		in.StartDateGranularity = props.StartDateGranularity
	}
	if in.TargetDate == nil && props.TargetDate != nil {
		day, err := time.Parse(dateLayout, *props.TargetDate)
		if err != nil {
			return platform.Validation("targetDate", "template target date must be YYYY-MM-DD")
		}
		d := model.Date(day.Format(dateLayout))
		in.TargetDate = &d
	}
	if in.TargetDateGranularity == nil {
		in.TargetDateGranularity = props.TargetDateGranularity
	}
	return nil
}

func (s *Service) applyProjectTemplateContent(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	projectID uuid.UUID, tpl model.ProjectTemplate, projectTeamIDs []uuid.UUID, projectScope authz.Scope,
) ([]Change, error) {
	props, err := parseProjectTemplateProperties(tpl.Properties)
	if err != nil {
		return nil, err
	}

	var changes []Change

	milestones, err := q.ListProjectTemplateMilestones(ctx, tpl.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, m := range milestones {
		pos, err := nextMilestoneSort(ctx, q, projectID)
		if err != nil {
			return nil, err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, platform.Internal(err)
		}
		row, err := q.CreateProjectMilestone(ctx, store.CreateProjectMilestoneParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			ProjectID:   projectID,
			Name:        m.Name,
			Description: m.Description,
			TargetDate:  m.TargetDate,
			SortOrder:   pos,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		milestone := toProjectMilestone(row)
		changes = append(changes, Change{
			EntityType: "projectMilestone", EntityID: id, Op: OpUpsert,
			Scope: projectScope, Payload: milestone,
		})
	}

	templateIssues, err := q.ListProjectTemplateIssues(ctx, tpl.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	created := map[uuid.UUID]uuid.UUID{}
	for _, tplIssue := range orderTemplateIssues(templateIssues) {
		issueChanges, createdID, err := s.createIssueFromProjectTemplateIssue(
			ctx, q, p, projectID, tplIssue, projectTeamIDs, created,
		)
		if err != nil {
			return nil, err
		}
		created[tplIssue.ID] = createdID
		changes = append(changes, issueChanges...)
	}

	for _, initiativeID := range props.InitiativeIDs {
		linkChanges, err := s.linkInitiativeProjectInTx(ctx, q, p, initiativeID, projectID)
		if err != nil {
			return nil, err
		}
		changes = append(changes, linkChanges...)
	}

	return changes, nil
}

func (s *Service) createIssueFromProjectTemplateIssue(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	projectID uuid.UUID, tplIssue store.ProjectTemplateIssue, projectTeamIDs []uuid.UUID,
	created map[uuid.UUID]uuid.UUID,
) ([]Change, uuid.UUID, error) {
	props, err := parseProjectTemplateIssueProperties(tplIssue.Properties)
	if err != nil {
		return nil, uuid.Nil, err
	}

	title := strings.TrimSpace(tplIssue.Title)
	description := tplIssue.Description
	var issueTemplateID *uuid.UUID
	priority := 0
	var stateID, assigneeID *uuid.UUID
	var estimate *int
	labelIDs := props.LabelIDs

	if props.TemplateID != nil {
		issueTpl, err := q.GetIssueTemplate(ctx, *props.TemplateID)
		if err == nil && issueTpl.ArchivedAt == nil {
			issueTemplateID = props.TemplateID
			if title == "" && issueTpl.Title != "" {
				title = issueTpl.Title
			}
			if description == "" && issueTpl.Body != "" {
				description = issueTpl.Body
			}
			issueTplProps, err := parseProjectTemplateIssueProperties(issueTpl.Properties)
			if err != nil {
				return nil, uuid.Nil, err
			}
			if stateID == nil {
				stateID = issueTplProps.StateID
			}
			if assigneeID == nil {
				assigneeID = issueTplProps.AssigneeID
			}
			if priority == 0 && issueTplProps.Priority != nil {
				priority = *issueTplProps.Priority
			}
			if estimate == nil {
				estimate = issueTplProps.Estimate
			}
			if len(labelIDs) == 0 {
				labelIDs = issueTplProps.LabelIDs
			}
		}
	}

	if props.StateID != nil {
		stateID = props.StateID
	}
	if props.AssigneeID != nil {
		assigneeID = props.AssigneeID
	}
	if props.Priority != nil {
		priority = *props.Priority
	}
	if props.Estimate != nil {
		estimate = props.Estimate
	}
	if len(props.LabelIDs) > 0 {
		labelIDs = props.LabelIDs
	}

	teamID := props.TeamID
	if teamID == nil {
		if len(projectTeamIDs) == 0 {
			return nil, uuid.Nil, platform.Validation("teamId", "a template issue needs a team")
		}
		teamID = &projectTeamIDs[0]
	}

	team, err := q.GetTeam(ctx, *teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, uuid.Nil, platform.Validation("teamId", "no such team on template issue")
		}
		return nil, uuid.Nil, platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		return nil, uuid.Nil, platform.Validation("teamId", "that team belongs to another workspace")
	}

	state, err := s.resolveInitialState(ctx, q, team, stateID, false)
	if err != nil {
		return nil, uuid.Nil, err
	}
	if err := s.validateAssignee(ctx, q, p, *teamID, assigneeID); err != nil {
		return nil, uuid.Nil, err
	}
	estimateVal, err := validateEstimate(estimate)
	if err != nil {
		return nil, uuid.Nil, err
	}
	if priority < 0 || priority > 4 {
		return nil, uuid.Nil, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	if title == "" {
		return nil, uuid.Nil, platform.Validation("title", "a template issue needs a title")
	}

	number, err := q.AllocateIssueNumber(ctx, *teamID)
	if err != nil {
		return nil, uuid.Nil, platform.Internal(err)
	}
	sortOrder, err := s.sortOrderFor(ctx, q, *teamID, state.ID, nil)
	if err != nil {
		return nil, uuid.Nil, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, uuid.Nil, platform.Internal(err)
	}

	var parentID *uuid.UUID
	if tplIssue.ParentID != nil {
		mapped, ok := created[*tplIssue.ParentID]
		if !ok {
			return nil, uuid.Nil, platform.Validation("parentId", "template issue parent was not created first")
		}
		parentID = &mapped
	}

	var siblingOrder *string
	if parentID != nil {
		pos, _, err := s.resolveParent(ctx, q, p, *teamID, *parentID)
		if err != nil {
			return nil, uuid.Nil, err
		}
		siblingOrder = &pos
	}

	row, err := q.CreateIssue(ctx, store.CreateIssueParams{
		ID:                id,
		WorkspaceID:       p.WorkspaceID,
		TeamID:            *teamID,
		Number:            number,
		Title:             title,
		Description:       description,
		StateID:           state.ID,
		AssigneeID:        assigneeID,
		CreatorID:         &p.UserID,
		Priority:          int16(priority),
		SortOrder:         sortOrder,
		StartedAt:         startedAtFor(state.Category, nil),
		CompletedAt:       completedAtFor(state.Category),
		CanceledAt:        canceledAtFor(state.Category),
		Estimate:          estimateVal,
		ParentID:          parentID,
		SubIssueSortOrder: siblingOrder,
		TemplateID:        issueTemplateID,
		ProjectID:         &projectID,
	})
	if err != nil {
		return nil, uuid.Nil, mapParentTriggerError(err)
	}
	issue := toIssue(store.AsIssueRow(row), team.Key)

	var changes []Change
	changes = append(changes, Change{
		EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: teamID,
		Scope: authz.TeamScope(*teamID, team.Private), Payload: issue,
	})

	for _, labelID := range dedupe(labelIDs) {
		if _, _, err := s.applyIssueLabel(ctx, q, p, id, *teamID, team.Private, labelID); err != nil {
			return nil, uuid.Nil, err
		}
	}

	return changes, id, nil
}

func (s *Service) linkInitiativeProjectInTx(
	ctx context.Context, q *store.Queries, p *authz.Principal, initiativeID, projectID uuid.UUID,
) ([]Change, error) {
	_, scope, err := s.requireInitiativeWrite(ctx, q, p, initiativeID)
	if err != nil {
		return nil, err
	}
	if _, _, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate); err != nil {
		return nil, err
	}
	if _, err := q.GetInitiativeProjectByPair(ctx, store.GetInitiativeProjectByPairParams{
		InitiativeID: initiativeID, ProjectID: projectID,
	}); err == nil {
		return nil, nil
	} else if !store.IsNotFound(err) {
		return nil, platform.Internal(err)
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, platform.Internal(err)
	}
	row, err := q.CreateInitiativeProject(ctx, store.CreateInitiativeProjectParams{
		ID: id, WorkspaceID: p.WorkspaceID, InitiativeID: initiativeID, ProjectID: projectID,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "initiative_project_unique") {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	link := toInitiativeProject(row)
	return []Change{{
		EntityType: "initiativeProject", EntityID: id, Op: OpUpsert, Scope: scope, Payload: link,
	}}, nil
}

func orderTemplateIssues(rows []store.ProjectTemplateIssue) []store.ProjectTemplateIssue {
	byID := make(map[uuid.UUID]store.ProjectTemplateIssue, len(rows))
	for _, r := range rows {
		byID[r.ID] = r
	}
	var roots []store.ProjectTemplateIssue
	for _, r := range rows {
		if r.ParentID == nil {
			roots = append(roots, r)
		}
	}
	out := make([]store.ProjectTemplateIssue, 0, len(rows))
	var walk func(store.ProjectTemplateIssue)
	walk = func(r store.ProjectTemplateIssue) {
		out = append(out, r)
		for _, child := range rows {
			if child.ParentID != nil && *child.ParentID == r.ID {
				walk(child)
			}
		}
	}
	for _, r := range roots {
		walk(r)
	}
	if len(out) < len(rows) {
		seen := make(map[uuid.UUID]bool, len(out))
		for _, r := range out {
			seen[r.ID] = true
		}
		for _, r := range rows {
			if !seen[r.ID] {
				out = append(out, r)
			}
		}
	}
	return out
}

func parseProjectTemplateProperties(raw json.RawMessage) (projectTemplateProperties, error) {
	if len(raw) == 0 {
		return projectTemplateProperties{}, nil
	}
	var out projectTemplateProperties
	if err := json.Unmarshal(raw, &out); err != nil {
		return projectTemplateProperties{}, platform.Validation("properties", "properties must be a JSON object")
	}
	return out, nil
}

func parseProjectTemplateIssueProperties(raw json.RawMessage) (projectTemplateIssueProperties, error) {
	if len(raw) == 0 {
		return projectTemplateIssueProperties{}, nil
	}
	var out projectTemplateIssueProperties
	if err := json.Unmarshal(raw, &out); err != nil {
		return projectTemplateIssueProperties{}, platform.Validation("properties", "properties must be a JSON object")
	}
	return out, nil
}

func validateProjectTemplateContent(summary, body *string) error {
	if summary != nil && len(*summary) > maxTitleLength {
		return platform.Validation("summary", "summary is too long")
	}
	if body != nil && len(*body) > maxDescriptionLength {
		return platform.Validation("body", "body is too long")
	}
	return nil
}

func nextProjectTemplatePosition(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.GetLastProjectTemplatePosition(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func nextProjectTemplateMilestoneSort(ctx context.Context, q *store.Queries, templateID uuid.UUID) (string, error) {
	last, err := q.GetLastProjectTemplateMilestoneSort(ctx, templateID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func nextProjectTemplateIssueSort(
	ctx context.Context, q *store.Queries, templateID uuid.UUID, parentID *uuid.UUID,
) (string, error) {
	last, err := q.GetLastProjectTemplateIssueSort(ctx, store.GetLastProjectTemplateIssueSortParams{
		ProjectTemplateID: templateID,
		ParentID:          parentID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func toProjectTemplate(t store.GetProjectTemplateRow) model.ProjectTemplate {
	return model.ProjectTemplate{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		TeamID:      t.TeamID,
		Name:        t.Name,
		Description: t.Description,
		Summary:     t.Summary,
		Body:        t.Body,
		Properties:  t.Properties,
		Position:    t.Position,
		CreatedBy:   t.CreatedBy,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		ArchivedAt:  t.ArchivedAt,
	}
}

func toProjectTemplateMilestone(m store.ProjectTemplateMilestone) model.ProjectTemplateMilestone {
	out := model.ProjectTemplateMilestone{
		ID:                m.ID,
		WorkspaceID:       m.WorkspaceID,
		ProjectTemplateID: m.ProjectTemplateID,
		Name:              m.Name,
		Description:       m.Description,
		SortOrder:         m.SortOrder,
		CreatedAt:         m.CreatedAt,
		UpdatedAt:         m.UpdatedAt,
	}
	out.TargetDate = dateOf(m.TargetDate)
	return out
}

func toProjectTemplateIssue(i store.ProjectTemplateIssue) model.ProjectTemplateIssue {
	return model.ProjectTemplateIssue{
		ID:                i.ID,
		WorkspaceID:       i.WorkspaceID,
		ProjectTemplateID: i.ProjectTemplateID,
		ParentID:          i.ParentID,
		Title:             i.Title,
		Description:       i.Description,
		Properties:        i.Properties,
		SortOrder:         i.SortOrder,
		CreatedAt:         i.CreatedAt,
		UpdatedAt:         i.UpdatedAt,
	}
}
