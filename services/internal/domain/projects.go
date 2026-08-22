package domain

import (
	"context"
	"fmt"
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

// Projects, their statuses, teams, members and milestones.
//
// Status is always manual. Completing every issue in a project does not move it — there
// is no code path that would, and the schema test asserts the database does not either.
//
// Teams and members are rows with their own ids, for the same reason issue_label is. A
// set written as a whole loses writes: two people adding different teams a second apart
// both send the full new set and the second overwrites the first. As individual rows an
// add is an upsert of one and a remove is a delete of one.

var defaultProjectStatuses = []struct {
	Name      string
	Category  string
	Color     string
	IsDefault bool
}{
	{"Backlog", model.ProjectCategoryBacklog, "#bec2c8", true},
	{"Planned", model.ProjectCategoryPlanned, "#e2e2e2", false},
	{"In Progress", model.ProjectCategoryStarted, "#f2c94c", false},
	{"Completed", model.ProjectCategoryCompleted, "#5e6ad2", false},
	{"Canceled", model.ProjectCategoryCanceled, "#95a2b3", false},
}

func validProjectCategory(c string) bool {
	switch c {
	case model.ProjectCategoryBacklog, model.ProjectCategoryPlanned, model.ProjectCategoryStarted,
		model.ProjectCategoryCompleted, model.ProjectCategoryCanceled:
		return true
	}
	return false
}

// canHoldDefault mirrors project_status_default_category_check.
//
// The default is where a brand new project lands, so it may only be Backlog or Planned —
// a project that is Completed before anybody has touched it is not a state the product
// has. The database enforces it; without the same rule here the constraint surfaces as an
// opaque "internal error" that the client treats as retriable and eventually drops on the
// floor, so the promotion looks like it worked until the page is reloaded.
func canHoldDefault(category string) bool {
	return category == model.ProjectCategoryBacklog || category == model.ProjectCategoryPlanned
}

const defaultCategoryMessage = "only a Backlog or Planned status can be the workspace default"

func validGranularity(g string) bool {
	switch g {
	case model.GranularityDay, model.GranularityMonth, model.GranularityQuarter,
		model.GranularityHalf, model.GranularityYear:
		return true
	}
	return false
}

func seedProjectStatuses(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) ([]model.ProjectStatus, error) {
	out := make([]model.ProjectStatus, 0, len(defaultProjectStatuses))
	pos := fractional.First()
	for i, d := range defaultProjectStatuses {
		if i > 0 {
			pos = fractional.After(pos)
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, platform.Internal(err)
		}
		color := d.Color
		row, err := q.CreateProjectStatus(ctx, store.CreateProjectStatusParams{
			ID:          id,
			WorkspaceID: workspaceID,
			Name:        d.Name,
			Color:       &color,
			Category:    d.Category,
			Position:    pos,
			IsDefault:   d.IsDefault,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		out = append(out, toProjectStatus(row))
	}
	return out, nil
}

type CreateProjectInput struct {
	Name        string
	Summary     *string
	Description string
	Icon        *string
	Color       *string
	StatusID    *uuid.UUID
	Priority    int
	LeadID      *uuid.UUID
	// TeamIDs is required and at least one. A project with no team is invisible to
	// everyone via ProjectScope, which is a project nobody can open.
	TeamIDs   []uuid.UUID
	MemberIDs []uuid.UUID

	StartDate             *model.Date
	StartDateGranularity  *string
	TargetDate            *model.Date
	TargetDateGranularity *string

	ProjectTemplateID *uuid.UUID
}

func (s *Service) CreateProject(ctx context.Context, p *authz.Principal, in CreateProjectInput) (model.Project, int64, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.Project{}, 0, platform.Validation("name", "a project needs a name")
	}
	if !authz.Can(p, authz.ActionProjectCreate) {
		return model.Project{}, 0, platform.Forbidden("project")
	}
	if in.Priority < 0 || in.Priority > 4 {
		return model.Project{}, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	in.Color = normaliseColor(in.Color)

	var out model.Project
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var template *model.ProjectTemplate
		if in.ProjectTemplateID != nil {
			row, err := s.requireProjectTemplateAccess(ctx, q, p, *in.ProjectTemplateID)
			if err != nil {
				if platform.CodeOf(err) == platform.CodeNotFound {
					return platform.Validation("projectTemplateId", "no such project template")
				}
				return err
			}
			tpl := toProjectTemplate(store.AsProjectTemplateRow(row))
			if err := mergeCreateProjectWithTemplate(&in, tpl); err != nil {
				return err
			}
			template = &tpl
		}

		if len(in.TeamIDs) == 0 {
			return platform.Validation("teamIds", "a project needs at least one team")
		}
		if err := s.validateProjectTemplate(ctx, q, p, in.TeamIDs, in.ProjectTemplateID); err != nil {
			return err
		}

		start, startG, err := resolveTimeframe(in.StartDate, in.StartDateGranularity)
		if err != nil {
			return err
		}
		target, targetG, err := resolveTimeframe(in.TargetDate, in.TargetDateGranularity)
		if err != nil {
			return err
		}

		statusID := in.StatusID
		if statusID == nil {
			def, err := q.GetDefaultProjectStatus(ctx, p.WorkspaceID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.Validation("statusId", "this workspace has no default project status")
				}
				return platform.Internal(err)
			}
			statusID = &def.ID
		} else if _, err := s.loadProjectStatus(ctx, q, p, *statusID); err != nil {
			return err
		}

		for _, teamID := range in.TeamIDs {
			if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionIssueCreate); err != nil {
				// Admins are not members of every team; requireTeamAccess still lets them
				// through ActionIssueCreate via CanInTeam's admin branch... wait, IssueCreate
				// is membership-only. An admin not in the team would be refused. Lift that
				// for admins below.
				if !p.Role.IsAdmin() {
					return err
				}
				if _, err := q.GetTeam(ctx, teamID); err != nil {
					if store.IsNotFound(err) {
						return platform.NotFound("team")
					}
					return platform.Internal(err)
				}
			}
		}

		pos, err := nextProjectSort(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateProject(ctx, store.CreateProjectParams{
			ID:                    id,
			WorkspaceID:           p.WorkspaceID,
			Name:                  in.Name,
			Summary:               trimOpt(in.Summary),
			Description:           in.Description,
			Icon:                  trimOpt(in.Icon),
			Color:                 in.Color,
			StatusID:              *statusID,
			Priority:              int16(in.Priority),
			LeadID:                in.LeadID,
			CreatorID:             &p.UserID,
			SortOrder:             pos,
			StartDate:             start,
			StartDateGranularity:  startG,
			TargetDate:            target,
			TargetDateGranularity: targetG,
			ProjectTemplateID:     in.ProjectTemplateID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProject(row)

		var changes []Change
		for _, teamID := range uniqueUUIDs(in.TeamIDs) {
			link, err := s.insertProjectTeam(ctx, q, p.WorkspaceID, id, teamID)
			if err != nil {
				return err
			}
			changes = append(changes, Change{
				EntityType: "projectTeam", EntityID: link.ID, Op: OpUpsert,
				TeamID: &teamID, Payload: link,
			})
		}
		for _, userID := range uniqueUUIDs(in.MemberIDs) {
			member, err := s.insertProjectMember(ctx, q, p.WorkspaceID, id, userID)
			if err != nil {
				return err
			}
			changes = append(changes, Change{
				EntityType: "projectMember", EntityID: member.ID, Op: OpUpsert, Payload: member,
			})
		}

		scope, err := s.projectScope(ctx, q, id)
		if err != nil {
			return err
		}
		if template != nil {
			spawned, err := s.applyProjectTemplateContent(
				ctx, q, p, id, *template, uniqueUUIDs(in.TeamIDs), scope,
			)
			if err != nil {
				return err
			}
			changes = append(changes, spawned...)
		}
		for i := range changes {
			if changes[i].Scope.Kind == "" {
				changes[i].Scope = scope
			}
		}
		changes = append([]Change{{
			EntityType: "project", EntityID: id, Op: OpUpsert, Scope: scope, Payload: out,
		}}, changes...)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

type UpdateProjectInput struct {
	ID          uuid.UUID
	Name        *string
	Summary     *string
	Description *string
	Icon        *string
	Color       *string
	StatusID    *uuid.UUID
	Priority    *int
	LeadID      *uuid.UUID
	ClearLead   bool

	AfterProjectID *uuid.UUID
	MoveToTop      bool

	StartDate             *model.Date
	StartDateGranularity  *string
	ClearStart            bool
	TargetDate            *model.Date
	TargetDateGranularity *string
	ClearTarget           bool

	UpdateSchedule             *string
	UpdateReminderIntervalDays *int
	UpdateReminderWeekday      *int
	UpdateReminderHour         *int
}

func (s *Service) UpdateProject(ctx context.Context, p *authz.Principal, in UpdateProjectInput) (model.Project, int64, error) {
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.Project{}, 0, platform.Validation("name", "a project needs a name")
		}
		in.Name = &trimmed
	}
	if in.Priority != nil && (*in.Priority < 0 || *in.Priority > 4) {
		return model.Project{}, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	if in.LeadID != nil && in.ClearLead {
		return model.Project{}, 0, platform.Validation("leadId", "cannot set and clear the lead in one call")
	}
	if in.AfterProjectID != nil && in.MoveToTop {
		return model.Project{}, 0, platform.Validation("afterProjectId",
			"cannot place after a project and move to top in one call")
	}
	if in.StartDate != nil && in.ClearStart {
		return model.Project{}, 0, platform.Validation("startDate", "cannot set and clear the start date in one call")
	}
	if in.TargetDate != nil && in.ClearTarget {
		return model.Project{}, 0, platform.Validation("targetDate", "cannot set and clear the target date in one call")
	}
	if err := validateProjectUpdateSchedule(in.UpdateSchedule); err != nil {
		return model.Project{}, 0, err
	}
	if err := validateProjectUpdateReminderFields(
		in.UpdateReminderIntervalDays,
		in.UpdateReminderWeekday,
		in.UpdateReminderHour,
	); err != nil {
		return model.Project{}, 0, err
	}
	in.Color = normaliseColor(in.Color)

	start, startG, err := resolveTimeframe(in.StartDate, in.StartDateGranularity)
	if err != nil {
		return model.Project{}, 0, err
	}
	target, targetG, err := resolveTimeframe(in.TargetDate, in.TargetDateGranularity)
	if err != nil {
		return model.Project{}, 0, err
	}

	var out model.Project
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, _, err := s.requireProjectWrite(ctx, q, p, in.ID, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		if in.StatusID != nil {
			if _, err := s.loadProjectStatus(ctx, q, p, *in.StatusID); err != nil {
				return err
			}
		}

		var sortOrder *string
		targetPriority := before.Priority
		if in.Priority != nil {
			targetPriority = int16(*in.Priority)
		}
		needsReorder := in.AfterProjectID != nil || in.MoveToTop ||
			(in.Priority != nil && targetPriority != before.Priority)
		if needsReorder {
			pos, err := s.projectSortOrderFor(
				ctx, q, p.WorkspaceID, targetPriority, in.AfterProjectID, in.MoveToTop,
			)
			if err != nil {
				return err
			}
			sortOrder = &pos
		}

		var priority *int16
		if in.Priority != nil {
			v := int16(*in.Priority)
			priority = &v
		}
		row, err := q.UpdateProject(ctx, store.UpdateProjectParams{
			ID:                         in.ID,
			Name:                       in.Name,
			Summary:                    in.Summary,
			Description:                in.Description,
			Icon:                       in.Icon,
			Color:                      in.Color,
			StatusID:                   in.StatusID,
			Priority:                   priority,
			SortOrder:                  sortOrder,
			LeadID:                     in.LeadID,
			ClearLead:                  in.ClearLead,
			StartDate:                  start,
			StartDateGranularity:       startG,
			ClearStart:                 in.ClearStart,
			TargetDate:                 target,
			TargetDateGranularity:      targetG,
			ClearTarget:                in.ClearTarget,
			UpdateSchedule:             in.UpdateSchedule,
			UpdateReminderIntervalDays: int16PtrFromInt(in.UpdateReminderIntervalDays),
			UpdateReminderWeekday:      int16PtrFromInt(in.UpdateReminderWeekday),
			UpdateReminderHour:         int16PtrFromInt(in.UpdateReminderHour),
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProject(row)
		scope, err := s.projectScope(ctx, q, in.ID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "project", EntityID: in.ID, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteProject(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireProjectWrite(ctx, q, p, id, authz.ActionProjectDelete)
		if err != nil {
			return err
		}
		if err := q.SoftDeleteProject(ctx, store.SoftDeleteProjectParams{
			ID: id, DeletedBy: &p.UserID,
		}); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "project", EntityID: id, Op: OpDelete, Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) RestoreProject(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Project, int64, error) {
	if !authz.Can(p, authz.ActionProjectDelete) {
		return model.Project{}, 0, platform.Forbidden("project")
	}
	var out model.Project
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cutoff := time.Now().Add(-IssueRestoreWindow)
		row, err := q.RestoreProject(ctx, store.RestoreProjectParams{
			ID:           id,
			DeletedAfter: &cutoff,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project")
			}
			return platform.Internal(err)
		}
		if row.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project")
		}
		out = toProject(row)
		scope, err := s.projectScope(ctx, q, id)
		if err != nil {
			return err
		}
		if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
			return platform.NotFound("project")
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "project", EntityID: id, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) GetProject(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Project, error) {
	q := s.db.Queries()
	row, err := q.GetProject(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Project{}, platform.NotFound("project")
		}
		return model.Project{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.Project{}, platform.NotFound("project")
	}
	scope, err := s.projectScope(ctx, q, id)
	if err != nil {
		return model.Project{}, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return model.Project{}, platform.NotFound("project")
	}
	return toProject(row), nil
}

func (s *Service) ListProjects(ctx context.Context, p *authz.Principal) ([]model.Project, error) {
	rows, err := s.db.Queries().ListProjectsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Project, 0, len(rows))
	for _, row := range rows {
		scope, err := s.projectScope(ctx, s.db.Queries(), row.ID)
		if err != nil {
			return nil, err
		}
		if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toProject(row))
	}
	return out, nil
}

func (s *Service) AddProjectTeam(ctx context.Context, p *authz.Principal, projectID, teamID uuid.UUID) (model.ProjectTeam, int64, error) {
	var out model.ProjectTeam
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		if !p.Role.IsAdmin() {
			if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionIssueCreate); err != nil {
				return err
			}
		} else if _, err := q.GetTeam(ctx, teamID); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		link, err := s.insertProjectTeam(ctx, q, p.WorkspaceID, projectID, teamID)
		if err != nil {
			return err
		}
		out = link
		scope, err := s.projectScope(ctx, q, projectID)
		if err != nil {
			return err
		}
		project, err := q.GetProject(ctx, projectID)
		if err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(),
			Change{EntityType: "project", EntityID: projectID, Op: OpUpsert, Scope: scope, Payload: toProject(project)},
			Change{EntityType: "projectTeam", EntityID: link.ID, Op: OpUpsert, TeamID: &teamID, Scope: scope, Payload: link},
		)
		return err
	})
	return out, version, err
}

func (s *Service) RemoveProjectTeam(ctx context.Context, p *authz.Principal, projectID, teamID uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		existing, err := q.GetProjectTeam(ctx, store.GetProjectTeamParams{ProjectID: projectID, TeamID: teamID})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project team")
			}
			return platform.Internal(err)
		}
		n, err := q.CountProjectTeams(ctx, projectID)
		if err != nil {
			return platform.Internal(err)
		}
		if n <= 1 {
			return platform.Validation("teamId", "a project needs at least one team")
		}
		if _, err := q.RemoveProjectTeam(ctx, store.RemoveProjectTeamParams{
			ProjectID: projectID, TeamID: teamID,
		}); err != nil {
			return platform.Internal(err)
		}
		scope, err := s.projectScope(ctx, q, projectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectTeam", EntityID: existing.ID, Op: OpDelete, TeamID: &teamID, Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) AddProjectMember(ctx context.Context, p *authz.Principal, projectID, userID uuid.UUID) (model.ProjectMember, int64, error) {
	var out model.ProjectMember
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		member, err := s.insertProjectMember(ctx, q, p.WorkspaceID, projectID, userID)
		if err != nil {
			return err
		}
		out = member
		scope, err := s.projectScope(ctx, q, projectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectMember", EntityID: member.ID, Op: OpUpsert, Scope: scope, Payload: member,
		})
		return err
	})
	return out, version, err
}

func (s *Service) RemoveProjectMember(ctx context.Context, p *authz.Principal, projectID, userID uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		existing, err := q.GetProjectMember(ctx, store.GetProjectMemberParams{ProjectID: projectID, UserID: userID})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project member")
			}
			return platform.Internal(err)
		}
		if _, err := q.RemoveProjectMember(ctx, store.RemoveProjectMemberParams{
			ProjectID: projectID, UserID: userID,
		}); err != nil {
			return platform.Internal(err)
		}
		scope, err := s.projectScope(ctx, q, projectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectMember", EntityID: existing.ID, Op: OpDelete, Scope: scope,
		})
		return err
	})
	return version, err
}

type CreateProjectMilestoneInput struct {
	ProjectID   uuid.UUID
	Name        string
	Description *string
	TargetDate  *model.Date
}

func (s *Service) CreateProjectMilestone(ctx context.Context, p *authz.Principal, in CreateProjectMilestoneInput) (model.ProjectMilestone, int64, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.ProjectMilestone{}, 0, platform.Validation("name", "a milestone needs a name")
	}
	var target pgtype.Date
	if in.TargetDate != nil {
		day, err := time.Parse(dateLayout, string(*in.TargetDate))
		if err != nil {
			return model.ProjectMilestone{}, 0, platform.Validation("targetDate", "a date is a calendar day, YYYY-MM-DD")
		}
		target = store.DateOf(day)
	}

	var out model.ProjectMilestone
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireProjectWrite(ctx, q, p, in.ProjectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		pos, err := nextMilestoneSort(ctx, q, in.ProjectID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateProjectMilestone(ctx, store.CreateProjectMilestoneParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			ProjectID:   in.ProjectID,
			Name:        in.Name,
			Description: trimOpt(in.Description),
			TargetDate:  target,
			SortOrder:   pos,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectMilestone(row)
		scope, err := s.projectScope(ctx, q, in.ProjectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectMilestone", EntityID: id, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

type UpdateProjectMilestoneInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	TargetDate  *model.Date
	ClearTarget bool
}

func (s *Service) UpdateProjectMilestone(ctx context.Context, p *authz.Principal, in UpdateProjectMilestoneInput) (model.ProjectMilestone, int64, error) {
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.ProjectMilestone{}, 0, platform.Validation("name", "a milestone needs a name")
		}
		in.Name = &trimmed
	}
	if in.TargetDate != nil && in.ClearTarget {
		return model.ProjectMilestone{}, 0, platform.Validation("targetDate", "cannot set and clear the date in one call")
	}
	var target pgtype.Date
	if in.TargetDate != nil {
		day, err := time.Parse(dateLayout, string(*in.TargetDate))
		if err != nil {
			return model.ProjectMilestone{}, 0, platform.Validation("targetDate", "a date is a calendar day, YYYY-MM-DD")
		}
		target = store.DateOf(day)
	}

	var out model.ProjectMilestone
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetProjectMilestone(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("milestone")
			}
			return platform.Internal(err)
		}
		if _, _, err := s.requireProjectWrite(ctx, q, p, existing.ProjectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		row, err := q.UpdateProjectMilestone(ctx, store.UpdateProjectMilestoneParams{
			ID:          in.ID,
			Name:        in.Name,
			Description: in.Description,
			TargetDate:  target,
			ClearTarget: in.ClearTarget,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectMilestone(row)
		scope, err := s.projectScope(ctx, q, existing.ProjectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectMilestone", EntityID: in.ID, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteProjectMilestone(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetProjectMilestone(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("milestone")
			}
			return platform.Internal(err)
		}
		if _, _, err := s.requireProjectWrite(ctx, q, p, existing.ProjectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		if err := q.ArchiveProjectMilestone(ctx, id); err != nil {
			return platform.Internal(err)
		}
		scope, err := s.projectScope(ctx, q, existing.ProjectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectMilestone", EntityID: id, Op: OpDelete, Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) ListProjectMilestones(ctx context.Context, p *authz.Principal, projectID uuid.UUID) ([]model.ProjectMilestone, error) {
	if _, err := s.GetProject(ctx, p, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListProjectMilestones(ctx, projectID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectMilestone, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProjectMilestone(r))
	}
	return out, nil
}

func (s *Service) ListProjectTeams(ctx context.Context, p *authz.Principal, projectID uuid.UUID) ([]model.ProjectTeam, error) {
	if _, err := s.GetProject(ctx, p, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListProjectTeams(ctx, projectID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectTeam, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProjectTeam(r))
	}
	return out, nil
}

func (s *Service) ListProjectMembers(ctx context.Context, p *authz.Principal, projectID uuid.UUID) ([]model.ProjectMember, error) {
	if _, err := s.GetProject(ctx, p, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListProjectMembers(ctx, projectID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectMember, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProjectMember(r))
	}
	return out, nil
}

func (s *Service) ListProjectStatuses(ctx context.Context, p *authz.Principal) ([]model.ProjectStatus, error) {
	if p.IsGuest() {
		return nil, nil
	}
	rows, err := s.db.Queries().ListProjectStatuses(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectStatus, 0, len(rows))
	for _, r := range rows {
		out = append(out, toProjectStatus(r))
	}
	return out, nil
}

func (s *Service) GetProjectStatus(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.ProjectStatus, error) {
	row, err := s.loadProjectStatus(ctx, s.db.Queries(), p, id)
	if err != nil {
		return model.ProjectStatus{}, err
	}
	return toProjectStatus(row), nil
}

type CreateProjectStatusInput struct {
	Name        string
	Description *string
	Color       *string
	Category    string
	IsDefault   bool
}

func (s *Service) CreateProjectStatus(ctx context.Context, p *authz.Principal, in CreateProjectStatusInput) (model.ProjectStatus, int64, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.ProjectStatus{}, 0, platform.Validation("name", "a status needs a name")
	}
	if !validProjectCategory(in.Category) {
		return model.ProjectStatus{}, 0, platform.Validation("category", "a project status is backlog, planned, started, completed or canceled")
	}
	if in.IsDefault && !canHoldDefault(in.Category) {
		return model.ProjectStatus{}, 0, platform.Validation("isDefault", defaultCategoryMessage)
	}
	if !authz.Can(p, authz.ActionProjectStatusManage) {
		return model.ProjectStatus{}, 0, platform.Forbidden("project status")
	}
	in.Color = normaliseColor(in.Color)

	var out model.ProjectStatus
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		pos, err := nextStatusPosition(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		if in.IsDefault {
			if err := q.ClearDefaultProjectStatuses(ctx, store.ClearDefaultProjectStatusesParams{
				WorkspaceID: p.WorkspaceID, ExceptID: id,
			}); err != nil {
				return platform.Internal(err)
			}
		}
		row, err := q.CreateProjectStatus(ctx, store.CreateProjectStatusParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			Name:        in.Name,
			Description: trimOpt(in.Description),
			Color:       in.Color,
			Category:    in.Category,
			Position:    pos,
			IsDefault:   in.IsDefault,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "project_status_workspace_name_key") {
				return platform.Validation("name", "a project status with that name already exists")
			}
			return platform.Internal(err)
		}
		out = toProjectStatus(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectStatus", EntityID: id, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

type UpdateProjectStatusInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Color       *string
	Category    *string
	IsDefault   *bool
}

func (s *Service) UpdateProjectStatus(ctx context.Context, p *authz.Principal, in UpdateProjectStatusInput) (model.ProjectStatus, int64, error) {
	if !authz.Can(p, authz.ActionProjectStatusManage) {
		return model.ProjectStatus{}, 0, platform.Forbidden("project status")
	}
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.ProjectStatus{}, 0, platform.Validation("name", "a status needs a name")
		}
		in.Name = &trimmed
	}
	if in.Category != nil && !validProjectCategory(*in.Category) {
		return model.ProjectStatus{}, 0, platform.Validation("category", "a project status is backlog, planned, started, completed or canceled")
	}
	in.Color = normaliseColor(in.Color)

	var out model.ProjectStatus
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.loadProjectStatus(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		// What the row looks like once this update lands is what the constraint is
		// checked against, so both halves of the pair have to be resolved before either
		// is written: promoting a Started status and moving the default into Started are
		// the same violation arriving from opposite directions.
		category := existing.Category
		if in.Category != nil {
			category = *in.Category
		}
		isDefault := existing.IsDefault
		if in.IsDefault != nil {
			isDefault = *in.IsDefault
		}
		if isDefault && !canHoldDefault(category) {
			return platform.Validation("isDefault", defaultCategoryMessage)
		}
		if in.IsDefault != nil && *in.IsDefault {
			if err := q.ClearDefaultProjectStatuses(ctx, store.ClearDefaultProjectStatusesParams{
				WorkspaceID: p.WorkspaceID, ExceptID: in.ID,
			}); err != nil {
				return platform.Internal(err)
			}
		}
		row, err := q.UpdateProjectStatus(ctx, store.UpdateProjectStatusParams{
			ID:          in.ID,
			Name:        in.Name,
			Description: in.Description,
			Color:       in.Color,
			Category:    in.Category,
			IsDefault:   in.IsDefault,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectStatus(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectStatus", EntityID: in.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveProjectStatus(ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool) (int64, error) {
	if !authz.Can(p, authz.ActionProjectStatusManage) {
		return 0, platform.Forbidden("project status")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := s.loadProjectStatus(ctx, q, p, id)
		if err != nil {
			return err
		}
		if archived {
			if row.IsDefault {
				return platform.Validation("id", "the default status cannot be archived")
			}
			// Same rule as ArchiveWorkflowState and ArchiveProjectLabel. `status_id` is
			// NOT NULL and the archive is a soft one, so the projects would keep pointing
			// at a row no client can see: every one of them renders as "No status", their
			// category stops driving the timeline, the graph, staleness and auto-archive,
			// and nothing on screen says a status was taken away. There is no restore in
			// the UI either, so the loss reads as permanent.
			count, err := q.CountProjectsInProjectStatus(ctx, id)
			if err != nil {
				return platform.Internal(err)
			}
			if count > 0 {
				return platform.Conflict(fmt.Sprintf(
					"%d projects still use this status; move them first", count))
			}
			if err := q.ArchiveProjectStatus(ctx, id); err != nil {
				return platform.Internal(err)
			}
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "projectStatus", EntityID: id, Op: OpDelete,
				Scope: authz.WorkspaceScope(),
			})
			return err
		}
		if err := q.UnarchiveProjectStatus(ctx, id); err != nil {
			return platform.Internal(err)
		}
		fresh, err := q.GetProjectStatus(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectStatus", EntityID: id, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: toProjectStatus(fresh),
		})
		return err
	})
	return version, err
}

func (s *Service) insertProjectTeam(ctx context.Context, q *store.Queries, workspaceID, projectID, teamID uuid.UUID) (model.ProjectTeam, error) {
	existing, err := q.GetProjectTeam(ctx, store.GetProjectTeamParams{ProjectID: projectID, TeamID: teamID})
	if err == nil {
		return toProjectTeam(existing), nil
	}
	if !store.IsNotFound(err) {
		return model.ProjectTeam{}, platform.Internal(err)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return model.ProjectTeam{}, platform.Internal(err)
	}
	row, err := q.AddProjectTeam(ctx, store.AddProjectTeamParams{
		ID: id, WorkspaceID: workspaceID, ProjectID: projectID, TeamID: teamID,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "project_team_key") {
			existing, err := q.GetProjectTeam(ctx, store.GetProjectTeamParams{ProjectID: projectID, TeamID: teamID})
			if err != nil {
				return model.ProjectTeam{}, platform.Internal(err)
			}
			return toProjectTeam(existing), nil
		}
		if store.IsForeignKeyViolation(err) {
			return model.ProjectTeam{}, platform.NotFound("team")
		}
		return model.ProjectTeam{}, platform.Internal(err)
	}
	return toProjectTeam(row), nil
}

func (s *Service) insertProjectMember(ctx context.Context, q *store.Queries, workspaceID, projectID, userID uuid.UUID) (model.ProjectMember, error) {
	existing, err := q.GetProjectMember(ctx, store.GetProjectMemberParams{ProjectID: projectID, UserID: userID})
	if err == nil {
		return toProjectMember(existing), nil
	}
	if !store.IsNotFound(err) {
		return model.ProjectMember{}, platform.Internal(err)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return model.ProjectMember{}, platform.Internal(err)
	}
	row, err := q.AddProjectMember(ctx, store.AddProjectMemberParams{
		ID: id, WorkspaceID: workspaceID, ProjectID: projectID, UserID: userID,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "project_member_key") {
			existing, err := q.GetProjectMember(ctx, store.GetProjectMemberParams{ProjectID: projectID, UserID: userID})
			if err != nil {
				return model.ProjectMember{}, platform.Internal(err)
			}
			return toProjectMember(existing), nil
		}
		if store.IsForeignKeyViolation(err) {
			return model.ProjectMember{}, platform.NotFound("user")
		}
		return model.ProjectMember{}, platform.Internal(err)
	}
	return toProjectMember(row), nil
}

func (s *Service) projectScope(ctx context.Context, q *store.Queries, projectID uuid.UUID) (authz.Scope, error) {
	ids, err := q.ListProjectTeamIDs(ctx, projectID)
	if err != nil {
		return authz.Scope{}, platform.Internal(err)
	}
	return authz.ProjectScope(ids), nil
}

func (s *Service) requireProjectWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID, action authz.Action,
) (store.Project, authz.Scope, error) {
	if !authz.Can(p, action) {
		return store.Project{}, authz.Scope{}, platform.Forbidden("project")
	}
	row, err := q.GetProjectForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Project{}, authz.Scope{}, platform.NotFound("project")
		}
		return store.Project{}, authz.Scope{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return store.Project{}, authz.Scope{}, platform.NotFound("project")
	}
	scope, err := s.projectScope(ctx, q, id)
	if err != nil {
		return store.Project{}, authz.Scope{}, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return store.Project{}, authz.Scope{}, platform.NotFound("project")
	}
	if action == authz.ActionProjectUpdate {
		retiredOnly, err := s.projectLinkedOnlyToRetiredTeams(ctx, q, id)
		if err != nil {
			return store.Project{}, authz.Scope{}, err
		}
		if retiredOnly {
			return store.Project{}, authz.Scope{}, platform.Conflict(
				"this project is read-only because every linked team is retired")
		}
	}
	return row, scope, nil
}

func (s *Service) projectLinkedOnlyToRetiredTeams(
	ctx context.Context, q *store.Queries, projectID uuid.UUID,
) (bool, error) {
	teamIDs, err := q.ListProjectTeamIDs(ctx, projectID)
	if err != nil {
		return false, platform.Internal(err)
	}
	if len(teamIDs) == 0 {
		return false, nil
	}
	for _, teamID := range teamIDs {
		team, err := q.GetTeam(ctx, teamID)
		if err != nil {
			if store.IsNotFound(err) {
				continue
			}
			return false, platform.Internal(err)
		}
		if team.RetiredAt == nil {
			return false, nil
		}
	}
	return true, nil
}

func (s *Service) loadProjectStatus(ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID) (store.ProjectStatus, error) {
	row, err := q.GetProjectStatus(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.ProjectStatus{}, platform.NotFound("project status")
		}
		return store.ProjectStatus{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return store.ProjectStatus{}, platform.NotFound("project status")
	}
	return row, nil
}

func nextProjectSort(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.LastProjectSortOrder(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func nextMilestoneSort(ctx context.Context, q *store.Queries, projectID uuid.UUID) (string, error) {
	last, err := q.LastProjectMilestoneSortOrder(ctx, projectID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func (s *Service) projectSortOrderFor(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, priority int16,
	after *uuid.UUID, toTop bool,
) (string, error) {
	if toTop {
		rows, err := q.ListProjectsInWorkspace(ctx, workspaceID)
		if err != nil {
			return "", platform.Internal(err)
		}
		first := ""
		for _, row := range rows {
			if row.Priority != priority {
				continue
			}
			if first == "" || row.SortOrder < first {
				first = row.SortOrder
			}
		}
		if first == "" {
			return fractional.First(), nil
		}
		return fractional.Before(first), nil
	}
	if after == nil {
		last, err := q.LastProjectSortOrderForPriority(ctx, store.LastProjectSortOrderForPriorityParams{
			WorkspaceID: workspaceID, Priority: priority,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return fractional.First(), nil
			}
			return "", platform.Internal(err)
		}
		return fractional.After(last), nil
	}
	return s.projectReorderPosition(ctx, q, workspaceID, priority, after)
}

func (s *Service) projectReorderPosition(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, priority int16, after *uuid.UUID,
) (string, error) {
	anchor, err := q.GetProject(ctx, *after)
	if err != nil {
		if store.IsNotFound(err) {
			return "", platform.Validation("afterProjectId", "no such project")
		}
		return "", platform.Internal(err)
	}
	if anchor.WorkspaceID != workspaceID {
		return "", platform.Validation("afterProjectId", "no such project")
	}
	if anchor.Priority != priority {
		return "", platform.Validation("afterProjectId",
			"that project is in a different priority group")
	}

	next, err := q.GetProjectSortOrderAfter(ctx, store.GetProjectSortOrderAfterParams{
		WorkspaceID: workspaceID, Priority: priority, SortOrder: anchor.SortOrder,
	})
	if err != nil && !store.IsNotFound(err) {
		return "", platform.Internal(err)
	}
	upper := ""
	if err == nil {
		upper = next
	}
	pos, err := fractional.Between(anchor.SortOrder, upper)
	if err != nil {
		return "", platform.Internal(err)
	}
	return pos, nil
}

func nextStatusPosition(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.LastProjectStatusPosition(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func resolveTimeframe(d *model.Date, gran *string) (pgtype.Date, *string, error) {
	if d == nil {
		if gran != nil && strings.TrimSpace(*gran) != "" {
			return pgtype.Date{}, nil, platform.Validation("startDate", "a timeframe needs a day, not just a granularity")
		}
		return pgtype.Date{}, nil, nil
	}
	day, err := time.Parse(dateLayout, string(*d))
	if err != nil {
		return pgtype.Date{}, nil, platform.Validation("startDate", "a date is a calendar day, YYYY-MM-DD")
	}
	g := model.GranularityDay
	if gran != nil && strings.TrimSpace(*gran) != "" {
		g = strings.TrimSpace(*gran)
		if !validGranularity(g) {
			return pgtype.Date{}, nil, platform.Validation("startDateGranularity", "granularity is day, month, quarter, half or year")
		}
	}
	return store.DateOf(day), &g, nil
}

func trimOpt(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func toProjectStatus(s store.ProjectStatus) model.ProjectStatus {
	return model.ProjectStatus{
		ID:          s.ID,
		WorkspaceID: s.WorkspaceID,
		Name:        s.Name,
		Description: s.Description,
		Color:       s.Color,
		Category:    s.Category,
		Position:    s.Position,
		IsDefault:   s.IsDefault,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
		ArchivedAt:  s.ArchivedAt,
	}
}

func toProject(p store.Project) model.Project {
	out := model.Project{
		ID:                         p.ID,
		WorkspaceID:                p.WorkspaceID,
		Name:                       p.Name,
		Summary:                    p.Summary,
		Description:                p.Description,
		Icon:                       p.Icon,
		Color:                      p.Color,
		StatusID:                   p.StatusID,
		Priority:                   int(p.Priority),
		LeadID:                     p.LeadID,
		CreatorID:                  p.CreatorID,
		SortOrder:                  p.SortOrder,
		StartDateGranularity:       p.StartDateGranularity,
		TargetDateGranularity:      p.TargetDateGranularity,
		UpdateSchedule:             p.UpdateSchedule,
		UpdateReminderIntervalDays: intPtrFromInt16(p.UpdateReminderIntervalDays),
		UpdateReminderWeekday:      intPtrFromInt16(p.UpdateReminderWeekday),
		UpdateReminderHour:         intPtrFromInt16(p.UpdateReminderHour),
		ProjectTemplateID:          p.ProjectTemplateID,
		ArchivedAt:                 p.ArchivedAt,
		DeletedAt:                  p.DeletedAt,
		DeletedBy:                  p.DeletedBy,
		CreatedAt:                  p.CreatedAt,
		UpdatedAt:                  p.UpdatedAt,
	}
	out.StartDate = dateOf(p.StartDate)
	out.TargetDate = dateOf(p.TargetDate)
	return out
}

func toProjectTeam(t store.ProjectTeam) model.ProjectTeam {
	return model.ProjectTeam{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		ProjectID:   t.ProjectID,
		TeamID:      t.TeamID,
		CreatedAt:   t.CreatedAt,
	}
}

func toProjectMember(m store.ProjectMember) model.ProjectMember {
	return model.ProjectMember{
		ID:          m.ID,
		WorkspaceID: m.WorkspaceID,
		ProjectID:   m.ProjectID,
		UserID:      m.UserID,
		CreatedAt:   m.CreatedAt,
	}
}

func toProjectMilestone(m store.ProjectMilestone) model.ProjectMilestone {
	return model.ProjectMilestone{
		ID:          m.ID,
		WorkspaceID: m.WorkspaceID,
		ProjectID:   m.ProjectID,
		Name:        m.Name,
		Description: m.Description,
		TargetDate:  dateOf(m.TargetDate),
		SortOrder:   m.SortOrder,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
		ArchivedAt:  m.ArchivedAt,
	}
}

func dateOf(d pgtype.Date) *model.Date {
	if !d.Valid {
		return nil
	}
	v := model.Date(d.Time.Format(dateLayout))
	return &v
}
