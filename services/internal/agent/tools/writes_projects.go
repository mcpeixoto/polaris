package tools

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

var projectWriteTools = []Tool{
	{
		Name:        "create_project",
		Description: "Create a project. At least one team is required — a project with none is invisible to everyone.",
		InputSchema: objectSchema(map[string]any{
			"name":        map[string]any{"type": "string"},
			"teams":       stringListSchema("Team keys, names, or UUIDs. At least one"),
			"summary":     stringSchema("One line shown in listings"),
			"description": map[string]any{"type": "string"},
			"priority":    intSchema("0 none, 1 urgent, 2 high, 3 medium, 4 low"),
			"lead":        stringSchema(`User display name, email, UUID, or "me"`),
			"startDate":   stringSchema("Calendar day, 2006-01-02"),
			"targetDate":  stringSchema("Calendar day, 2006-01-02"),
		}, []string{"name", "teams"}),
		Run: createProject,
	},
	{
		Name:        "update_project",
		Description: "Update a project's name, summary, description, priority, lead or dates.",
		InputSchema: objectSchema(map[string]any{
			"id":          stringSchema("Project UUID or name"),
			"name":        map[string]any{"type": "string"},
			"summary":     map[string]any{"type": "string"},
			"description": map[string]any{"type": "string"},
			"priority":    map[string]any{"type": "integer"},
			"lead":        stringSchema(`User display name, email, UUID, "me", or "none" to clear`),
			"startDate":   stringSchema("Calendar day, 2006-01-02"),
			"targetDate":  stringSchema("Calendar day, 2006-01-02"),
		}, []string{"id"}),
		Run: updateProject,
	},
}

func createProject(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	refs := strSliceArg(args, "teams")
	if len(refs) == 0 {
		return nil, platform.Validation("teams", "a project needs at least one team")
	}
	teamIDs := make([]uuid.UUID, 0, len(refs))
	for _, ref := range refs {
		team, err := resolveTeam(ctx, svc, p, ref)
		if err != nil {
			return nil, err
		}
		teamIDs = append(teamIDs, team.ID)
	}

	in := domain.CreateProjectInput{
		Name:        strArg(args, "name"),
		Description: strArg(args, "description"),
		Priority:    intArg(args, "priority", 0),
		TeamIDs:     teamIDs,
	}
	if v := strArg(args, "summary"); v != "" {
		in.Summary = &v
	}
	if ref := strArg(args, "lead"); ref != "" {
		u, err := resolveUser(ctx, svc, p, "lead", ref)
		if err != nil {
			return nil, err
		}
		id := u.ID
		in.LeadID = &id
	}
	if v := strArg(args, "startDate"); v != "" {
		d := model.Date(v)
		in.StartDate = &d
	}
	if v := strArg(args, "targetDate"); v != "" {
		d := model.Date(v)
		in.TargetDate = &d
	}

	proj, _, err := svc.CreateProject(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return projectDetailJSON(proj), nil
}

func updateProject(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	proj, err := resolveProject(ctx, svc, p, "id", strArg(args, "id"))
	if err != nil {
		return nil, err
	}
	in := domain.UpdateProjectInput{ID: proj.ID}
	if v, ok := args["name"].(string); ok {
		in.Name = &v
	}
	if v, ok := args["summary"].(string); ok {
		in.Summary = &v
	}
	if v, ok := args["description"].(string); ok {
		in.Description = &v
	}
	if present(args, "priority") {
		n := intArg(args, "priority", 0)
		in.Priority = &n
	}
	if present(args, "lead") {
		ref := strArg(args, "lead")
		// "none" rather than an empty string, because an empty string is what a caller
		// sends when it meant to send nothing at all.
		if ref == "" || ref == "none" {
			in.ClearLead = true
		} else {
			u, err := resolveUser(ctx, svc, p, "lead", ref)
			if err != nil {
				return nil, err
			}
			id := u.ID
			in.LeadID = &id
		}
	}
	if v := strArg(args, "startDate"); v != "" {
		d := model.Date(v)
		in.StartDate = &d
	}
	if v := strArg(args, "targetDate"); v != "" {
		d := model.Date(v)
		in.TargetDate = &d
	}

	updated, _, err := svc.UpdateProject(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return projectDetailJSON(updated), nil
}
