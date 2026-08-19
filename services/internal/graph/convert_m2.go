package graph

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The model-to-GraphQL conversions for projects.
//
// A separate file from convert.go and convert_m1.go for the same two reasons those two
// are apart: gqlgen rewrites schema.resolvers.go, and a helper that lives there is one
// generate away from being commented out. Nested relations (status, teams, members,
// milestones, lead) are filled by hydrateProjects rather than here, so a list of projects
// does not become N+1 reads per row.

func toProject(p model.Project) (generated.Project, error) {
	startG, err := toGranularity(p.StartDateGranularity)
	if err != nil {
		return generated.Project{}, err
	}
	targetG, err := toGranularity(p.TargetDateGranularity)
	if err != nil {
		return generated.Project{}, err
	}
	return generated.Project{
		ID:                    p.ID,
		WorkspaceID:           p.WorkspaceID,
		Name:                  p.Name,
		Summary:               p.Summary,
		Description:           p.Description,
		Icon:                  p.Icon,
		Color:                 p.Color,
		StatusID:              p.StatusID,
		Priority:              p.Priority,
		LeadID:                p.LeadID,
		CreatorID:             p.CreatorID,
		SortOrder:             p.SortOrder,
		StartDate:             fromDate(p.StartDate),
		StartDateGranularity:  startG,
		TargetDate:            fromDate(p.TargetDate),
		TargetDateGranularity: targetG,
		ArchivedAt:            p.ArchivedAt,
		DeletedAt:             p.DeletedAt,
		DeletedBy:             p.DeletedBy,
		CreatedAt:             p.CreatedAt,
		UpdatedAt:             p.UpdatedAt,
	}, nil
}

func toProjectStatus(s model.ProjectStatus) (generated.ProjectStatus, error) {
	category, err := toProjectStatusCategory(s.Category)
	if err != nil {
		return generated.ProjectStatus{}, err
	}
	return generated.ProjectStatus{
		ID:          s.ID,
		WorkspaceID: s.WorkspaceID,
		Name:        s.Name,
		Description: s.Description,
		Color:       s.Color,
		Category:    category,
		Position:    s.Position,
		IsDefault:   s.IsDefault,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
		ArchivedAt:  s.ArchivedAt,
	}, nil
}

func toProjectStatuses(rows []model.ProjectStatus) ([]generated.ProjectStatus, error) {
	out := make([]generated.ProjectStatus, 0, len(rows))
	for _, s := range rows {
		converted, err := toProjectStatus(s)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	return out, nil
}

func toProjectTeam(t model.ProjectTeam) generated.ProjectTeam {
	return generated.ProjectTeam{
		ID:          t.ID,
		WorkspaceID: t.WorkspaceID,
		ProjectID:   t.ProjectID,
		TeamID:      t.TeamID,
		CreatedAt:   t.CreatedAt,
	}
}

func toProjectMember(m model.ProjectMember) generated.ProjectMember {
	return generated.ProjectMember{
		ID:          m.ID,
		WorkspaceID: m.WorkspaceID,
		ProjectID:   m.ProjectID,
		UserID:      m.UserID,
		CreatedAt:   m.CreatedAt,
	}
}

func toProjectMilestone(m model.ProjectMilestone) generated.ProjectMilestone {
	return generated.ProjectMilestone{
		ID:          m.ID,
		WorkspaceID: m.WorkspaceID,
		ProjectID:   m.ProjectID,
		Name:        m.Name,
		Description: m.Description,
		TargetDate:  fromDate(m.TargetDate),
		SortOrder:   m.SortOrder,
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
		ArchivedAt:  m.ArchivedAt,
	}
}

func toProjectStatusCategory(v string) (generated.ProjectStatusCategory, error) {
	switch v {
	case model.ProjectCategoryBacklog:
		return generated.ProjectStatusCategoryBacklog, nil
	case model.ProjectCategoryPlanned:
		return generated.ProjectStatusCategoryPlanned, nil
	case model.ProjectCategoryStarted:
		return generated.ProjectStatusCategoryStarted, nil
	case model.ProjectCategoryCompleted:
		return generated.ProjectStatusCategoryCompleted, nil
	case model.ProjectCategoryCanceled:
		return generated.ProjectStatusCategoryCanceled, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown project status category %q", v))
}

func fromProjectStatusCategory(c generated.ProjectStatusCategory) (string, error) {
	switch c {
	case generated.ProjectStatusCategoryBacklog:
		return model.ProjectCategoryBacklog, nil
	case generated.ProjectStatusCategoryPlanned:
		return model.ProjectCategoryPlanned, nil
	case generated.ProjectStatusCategoryStarted:
		return model.ProjectCategoryStarted, nil
	case generated.ProjectStatusCategoryCompleted:
		return model.ProjectCategoryCompleted, nil
	case generated.ProjectStatusCategoryCanceled:
		return model.ProjectCategoryCanceled, nil
	}
	return "", platform.Validation("category", "a project status is backlog, planned, started, completed or canceled")
}

func toGranularity(v *string) (*generated.TimeframeGranularity, error) {
	if v == nil {
		return nil, nil
	}
	var g generated.TimeframeGranularity
	switch *v {
	case model.GranularityDay:
		g = generated.TimeframeGranularityDay
	case model.GranularityMonth:
		g = generated.TimeframeGranularityMonth
	case model.GranularityQuarter:
		g = generated.TimeframeGranularityQuarter
	case model.GranularityHalf:
		g = generated.TimeframeGranularityHalf
	case model.GranularityYear:
		g = generated.TimeframeGranularityYear
	default:
		return nil, platform.Internal(fmt.Errorf("unknown timeframe granularity %q", *v))
	}
	return &g, nil
}

func fromGranularity(g *generated.TimeframeGranularity) (*string, error) {
	if g == nil {
		return nil, nil
	}
	var s string
	switch *g {
	case generated.TimeframeGranularityDay:
		s = model.GranularityDay
	case generated.TimeframeGranularityMonth:
		s = model.GranularityMonth
	case generated.TimeframeGranularityQuarter:
		s = model.GranularityQuarter
	case generated.TimeframeGranularityHalf:
		s = model.GranularityHalf
	case generated.TimeframeGranularityYear:
		s = model.GranularityYear
	default:
		return nil, platform.Validation("granularity", "a timeframe is a day, month, quarter, half or year")
	}
	return &s, nil
}

func fromCreateProjectInput(in generated.CreateProjectInput) (domain.CreateProjectInput, error) {
	startG, err := fromGranularity(in.StartDateGranularity)
	if err != nil {
		return domain.CreateProjectInput{}, err
	}
	targetG, err := fromGranularity(in.TargetDateGranularity)
	if err != nil {
		return domain.CreateProjectInput{}, err
	}
	return domain.CreateProjectInput{
		Name:                  in.Name,
		Summary:               in.Summary,
		Description:           deref(in.Description),
		Icon:                  in.Icon,
		Color:                 in.Color,
		StatusID:              in.StatusID,
		Priority:              deref(in.Priority),
		LeadID:                in.LeadID,
		TeamIDs:               in.TeamIds,
		MemberIDs:             in.MemberIds,
		StartDate:             toDate(in.StartDate),
		StartDateGranularity:  startG,
		TargetDate:            toDate(in.TargetDate),
		TargetDateGranularity: targetG,
	}, nil
}

func fromUpdateProjectInput(in generated.UpdateProjectInput) (domain.UpdateProjectInput, error) {
	startG, err := fromGranularity(in.StartDateGranularity)
	if err != nil {
		return domain.UpdateProjectInput{}, err
	}
	targetG, err := fromGranularity(in.TargetDateGranularity)
	if err != nil {
		return domain.UpdateProjectInput{}, err
	}
	return domain.UpdateProjectInput{
		ID:                    in.ID,
		Name:                  in.Name,
		Summary:               in.Summary,
		Description:           in.Description,
		Icon:                  in.Icon,
		Color:                 in.Color,
		StatusID:              in.StatusID,
		Priority:              in.Priority,
		LeadID:                in.LeadID,
		ClearLead:             deref(in.ClearLead),
		StartDate:             toDate(in.StartDate),
		StartDateGranularity:  startG,
		ClearStart:            deref(in.ClearStart),
		TargetDate:            toDate(in.TargetDate),
		TargetDateGranularity: targetG,
		ClearTarget:           deref(in.ClearTarget),
	}, nil
}

func fromCreateProjectStatusInput(in generated.CreateProjectStatusInput) (domain.CreateProjectStatusInput, error) {
	category, err := fromProjectStatusCategory(in.Category)
	if err != nil {
		return domain.CreateProjectStatusInput{}, err
	}
	return domain.CreateProjectStatusInput{
		Name:        in.Name,
		Description: in.Description,
		Color:       in.Color,
		Category:    category,
		IsDefault:   deref(in.IsDefault),
	}, nil
}

func fromUpdateProjectStatusInput(in generated.UpdateProjectStatusInput) (domain.UpdateProjectStatusInput, error) {
	var category *string
	if in.Category != nil {
		c, err := fromProjectStatusCategory(*in.Category)
		if err != nil {
			return domain.UpdateProjectStatusInput{}, err
		}
		category = &c
	}
	return domain.UpdateProjectStatusInput{
		ID:          in.ID,
		Name:        in.Name,
		Description: in.Description,
		Color:       in.Color,
		Category:    category,
		IsDefault:   in.IsDefault,
	}, nil
}

func (r *Resolver) hydrateProject(ctx context.Context, p *authz.Principal, project model.Project) (generated.Project, error) {
	out, err := r.hydrateProjects(ctx, p, []model.Project{project})
	if err != nil {
		return generated.Project{}, err
	}
	return out[0], nil
}

func (r *Resolver) hydrateProjects(ctx context.Context, p *authz.Principal, projects []model.Project) ([]generated.Project, error) {
	out := make([]generated.Project, 0, len(projects))
	if len(projects) == 0 {
		return out, nil
	}

	statuses, err := r.Svc.ListProjectStatuses(ctx, p)
	if err != nil {
		return nil, err
	}
	statusByID := make(map[uuid.UUID]generated.ProjectStatus, len(statuses))
	for _, s := range statuses {
		converted, err := toProjectStatus(s)
		if err != nil {
			return nil, err
		}
		statusByID[s.ID] = converted
	}

	users, err := r.loaders(ctx).allUsers(ctx, p)
	if err != nil {
		return nil, err
	}
	teams, err := r.loaders(ctx).allTeams(ctx, p)
	if err != nil {
		return nil, err
	}

	for _, project := range projects {
		g, err := toProject(project)
		if err != nil {
			return nil, err
		}
		if st, ok := statusByID[project.StatusID]; ok {
			copied := st
			g.Status = &copied
		} else {
			// A status the list hid (guest, archived) still has to be named: the schema
			// declares it non-null, and a project without a status is unrenderable.
			fetched, err := r.Svc.GetProjectStatus(ctx, p, project.StatusID)
			if err != nil {
				return nil, err
			}
			converted, err := toProjectStatus(fetched)
			if err != nil {
				return nil, err
			}
			g.Status = &converted
		}
		if project.LeadID != nil {
			if u, ok := users.byID[*project.LeadID]; ok {
				converted, err := toUser(u)
				if err != nil {
					return nil, err
				}
				g.Lead = &converted
			}
		}
		if project.CreatorID != nil {
			if u, ok := users.byID[*project.CreatorID]; ok {
				converted, err := toUser(u)
				if err != nil {
					return nil, err
				}
				g.Creator = &converted
			}
		}

		links, err := r.Svc.ListProjectTeams(ctx, p, project.ID)
		if err != nil {
			return nil, err
		}
		g.Teams = make([]generated.ProjectTeam, 0, len(links))
		for _, link := range links {
			row := toProjectTeam(link)
			if t, ok := teams.byID[link.TeamID]; ok {
				converted, err := toTeam(t)
				if err != nil {
					return nil, err
				}
				row.Team = &converted
			}
			g.Teams = append(g.Teams, row)
		}

		members, err := r.Svc.ListProjectMembers(ctx, p, project.ID)
		if err != nil {
			return nil, err
		}
		g.Members = make([]generated.ProjectMember, 0, len(members))
		for _, member := range members {
			row := toProjectMember(member)
			if u, ok := users.byID[member.UserID]; ok {
				converted, err := toUser(u)
				if err != nil {
					return nil, err
				}
				row.User = &converted
			}
			g.Members = append(g.Members, row)
		}

		milestones, err := r.Svc.ListProjectMilestones(ctx, p, project.ID)
		if err != nil {
			return nil, err
		}
		g.Milestones = make([]generated.ProjectMilestone, 0, len(milestones))
		for _, m := range milestones {
			g.Milestones = append(g.Milestones, toProjectMilestone(m))
		}

		out = append(out, g)
	}
	return out, nil
}

func (r *Resolver) hydrateProjectTeam(ctx context.Context, p *authz.Principal, link model.ProjectTeam) (generated.ProjectTeam, error) {
	row := toProjectTeam(link)
	teams, err := r.loaders(ctx).allTeams(ctx, p)
	if err != nil {
		return generated.ProjectTeam{}, err
	}
	if t, ok := teams.byID[link.TeamID]; ok {
		converted, err := toTeam(t)
		if err != nil {
			return generated.ProjectTeam{}, err
		}
		row.Team = &converted
	}
	return row, nil
}

func (r *Resolver) hydrateProjectMember(ctx context.Context, p *authz.Principal, member model.ProjectMember) (generated.ProjectMember, error) {
	row := toProjectMember(member)
	users, err := r.loaders(ctx).allUsers(ctx, p)
	if err != nil {
		return generated.ProjectMember{}, err
	}
	if u, ok := users.byID[member.UserID]; ok {
		converted, err := toUser(u)
		if err != nil {
			return generated.ProjectMember{}, err
		}
		row.User = &converted
	}
	return row, nil
}

func toInitiative(i model.Initiative) (generated.Initiative, error) {
	status, err := toInitiativeStatus(i.Status)
	if err != nil {
		return generated.Initiative{}, err
	}
	targetG, err := toGranularity(i.TargetDateGranularity)
	if err != nil {
		return generated.Initiative{}, err
	}
	return generated.Initiative{
		ID:                    i.ID,
		WorkspaceID:           i.WorkspaceID,
		Name:                  i.Name,
		Description:           i.Description,
		Status:                status,
		Priority:              int(i.Priority),
		OwnerID:               i.OwnerID,
		LeadTeamID:            i.LeadTeamID,
		SortOrder:             i.SortOrder,
		TargetDate:            fromDate(i.TargetDate),
		TargetDateGranularity: targetG,
		CreatorID:             i.CreatorID,
		ArchivedAt:            i.ArchivedAt,
		DeletedAt:             i.DeletedAt,
		DeletedBy:             i.DeletedBy,
		CreatedAt:             i.CreatedAt,
		UpdatedAt:             i.UpdatedAt,
	}, nil
}

func toInitiativeProject(ip model.InitiativeProject) generated.InitiativeProject {
	return generated.InitiativeProject{
		ID:           ip.ID,
		WorkspaceID:  ip.WorkspaceID,
		InitiativeID: ip.InitiativeID,
		ProjectID:    ip.ProjectID,
		CreatedAt:    ip.CreatedAt,
	}
}

func toProjectDependency(dep model.ProjectDependency) generated.ProjectDependency {
	return generated.ProjectDependency{
		ID:                 dep.ID,
		WorkspaceID:        dep.WorkspaceID,
		BlockingProjectID:  dep.BlockingProjectID,
		BlockedProjectID:   dep.BlockedProjectID,
		CreatedAt:          dep.CreatedAt,
	}
}

func toInitiativeStatus(v string) (generated.InitiativeStatus, error) {
	switch v {
	case model.InitiativeStatusProposed:
		return generated.InitiativeStatusProposed, nil
	case model.InitiativeStatusPlanned:
		return generated.InitiativeStatusPlanned, nil
	case model.InitiativeStatusActive:
		return generated.InitiativeStatusActive, nil
	case model.InitiativeStatusCompleted:
		return generated.InitiativeStatusCompleted, nil
	case model.InitiativeStatusCanceled:
		return generated.InitiativeStatusCanceled, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown initiative status %q", v))
}

func fromInitiativeStatus(s *generated.InitiativeStatus) (string, error) {
	if s == nil {
		return "", nil
	}
	switch *s {
	case generated.InitiativeStatusProposed:
		return model.InitiativeStatusProposed, nil
	case generated.InitiativeStatusPlanned:
		return model.InitiativeStatusPlanned, nil
	case generated.InitiativeStatusActive:
		return model.InitiativeStatusActive, nil
	case generated.InitiativeStatusCompleted:
		return model.InitiativeStatusCompleted, nil
	case generated.InitiativeStatusCanceled:
		return model.InitiativeStatusCanceled, nil
	}
	return "", platform.Validation("status", "status is proposed, planned, active, completed or canceled")
}

func fromCreateInitiativeInput(in generated.CreateInitiativeInput) (domain.CreateInitiativeInput, error) {
	status, err := fromInitiativeStatus(in.Status)
	if err != nil {
		return domain.CreateInitiativeInput{}, err
	}
	targetG, err := fromGranularity(in.TargetDateGranularity)
	if err != nil {
		return domain.CreateInitiativeInput{}, err
	}
	var target *model.Date
	if in.TargetDate != nil {
		target = toDate(in.TargetDate)
	}
	priority := 0
	if in.Priority != nil {
		priority = *in.Priority
	}
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	return domain.CreateInitiativeInput{
		Name:                  in.Name,
		Description:           desc,
		Status:                status,
		Priority:              priority,
		OwnerID:               in.OwnerID,
		LeadTeamID:            in.LeadTeamID,
		TargetDate:            target,
		TargetDateGranularity: targetG,
	}, nil
}

func fromUpdateInitiativeInput(in generated.UpdateInitiativeInput) (domain.UpdateInitiativeInput, error) {
	status, err := fromInitiativeStatus(in.Status)
	if err != nil {
		return domain.UpdateInitiativeInput{}, err
	}
	targetG, err := fromGranularity(in.TargetDateGranularity)
	if err != nil {
		return domain.UpdateInitiativeInput{}, err
	}
	var target *model.Date
	if in.TargetDate != nil {
		target = toDate(in.TargetDate)
	}
	out := domain.UpdateInitiativeInput{
		ID:                    in.ID,
		Name:                  in.Name,
		Description:           in.Description,
		OwnerID:               in.OwnerID,
		ClearOwner:            deref(in.ClearOwner),
		LeadTeamID:            in.LeadTeamID,
		ClearLeadTeam:         deref(in.ClearLeadTeam),
		TargetDate:            target,
		TargetDateGranularity: targetG,
		ClearTarget:           deref(in.ClearTarget),
	}
	if status != "" {
		out.Status = &status
	}
	if in.Priority != nil {
		out.Priority = in.Priority
	}
	return out, nil
}

func toProjectUpdate(pu model.ProjectUpdate) (generated.ProjectUpdate, error) {
	health, err := toProjectUpdateHealth(pu.Health)
	if err != nil {
		return generated.ProjectUpdate{}, err
	}
	return generated.ProjectUpdate{
		ID:          pu.ID,
		WorkspaceID: pu.WorkspaceID,
		ProjectID:   pu.ProjectID,
		Health:      health,
		Body:        pu.Body,
		AuthorID:    pu.AuthorID,
		EditedAt:    pu.EditedAt,
		DeletedAt:   pu.DeletedAt,
		CreatedAt:   pu.CreatedAt,
		UpdatedAt:   pu.UpdatedAt,
	}, nil
}

func toProjectUpdateHealth(v string) (generated.ProjectUpdateHealth, error) {
	switch v {
	case model.ProjectUpdateHealthOnTrack:
		return generated.ProjectUpdateHealthOnTrack, nil
	case model.ProjectUpdateHealthAtRisk:
		return generated.ProjectUpdateHealthAtRisk, nil
	case model.ProjectUpdateHealthOffTrack:
		return generated.ProjectUpdateHealthOffTrack, nil
	default:
		return "", fmt.Errorf("unknown project update health %q", v)
	}
}

func fromProjectUpdateHealth(h generated.ProjectUpdateHealth) (string, error) {
	switch h {
	case generated.ProjectUpdateHealthOnTrack:
		return model.ProjectUpdateHealthOnTrack, nil
	case generated.ProjectUpdateHealthAtRisk:
		return model.ProjectUpdateHealthAtRisk, nil
	case generated.ProjectUpdateHealthOffTrack:
		return model.ProjectUpdateHealthOffTrack, nil
	default:
		return "", fmt.Errorf("unknown project update health %q", h)
	}
}

func fromCreateProjectUpdateInput(in generated.CreateProjectUpdateInput) (domain.CreateProjectUpdateInput, error) {
	health, err := fromProjectUpdateHealth(in.Health)
	if err != nil {
		return domain.CreateProjectUpdateInput{}, err
	}
	out := domain.CreateProjectUpdateInput{
		ProjectID: in.ProjectID,
		Health:    health,
	}
	if in.Body != nil {
		out.Body = *in.Body
	}
	return out, nil
}

func fromUpdateProjectUpdateInput(in generated.UpdateProjectUpdateInput) (domain.UpdateProjectUpdateInput, error) {
	out := domain.UpdateProjectUpdateInput{ID: in.ID}
	if in.Health != nil {
		health, err := fromProjectUpdateHealth(*in.Health)
		if err != nil {
			return domain.UpdateProjectUpdateInput{}, err
		}
		out.Health = &health
	}
	out.Body = in.Body
	return out, nil
}
