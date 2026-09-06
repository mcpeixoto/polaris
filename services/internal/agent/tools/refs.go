package tools

import (
	"context"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Every resolver here takes the same shape: a uuid is matched by id, anything else by the
// name a person would type. They all go through a list the principal is already allowed to
// see, so a ref that names something out of reach comes back as not-found rather than as
// an existence oracle — the same answer the domain layer gives.
//
// Resolution is deliberately not "search". An agent that meant ENG-14 and got the issue
// whose title merely mentions it would file its comment on the wrong row and never notice.

func resolveTeam(ctx context.Context, svc *domain.Service, p *authz.Principal, ref string) (model.Team, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.Team{}, platform.Validation("team", "a team is required")
	}
	teams, err := svc.ListTeams(ctx, p)
	if err != nil {
		return model.Team{}, err
	}
	if id, err := uuid.Parse(ref); err == nil {
		for _, t := range teams {
			if t.ID == id {
				return t, nil
			}
		}
		return model.Team{}, platform.NotFound("team")
	}
	want := strings.ToUpper(ref)
	for _, t := range teams {
		if strings.EqualFold(t.Key, ref) || strings.EqualFold(t.Name, ref) || strings.ToUpper(t.Key) == want {
			return t, nil
		}
	}
	return model.Team{}, platform.NotFound("team")
}

// resolveIssue takes a UUID or an ENG-123 identifier. The empty ref is caught here so the
// caller gets "an issue is required" rather than a bare not-found from the lookup.
func resolveIssue(ctx context.Context, svc *domain.Service, p *authz.Principal, field, ref string) (model.Issue, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.Issue{}, platform.Validation(field, "an issue is required")
	}
	return svc.GetIssueByRef(ctx, p, ref)
}

// resolveUser accepts a UUID, a display name, a full name or an email address. "me" is the
// caller, which is the ref an agent reaches for most and the only one it can be sure of.
func resolveUser(ctx context.Context, svc *domain.Service, p *authz.Principal, field, ref string) (model.User, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.User{}, platform.Validation(field, "a user is required")
	}
	if strings.EqualFold(ref, "me") {
		if p.UserID == uuid.Nil {
			return model.User{}, platform.Validation(field, `"me" needs a user, and this connection has none`)
		}
		return svc.GetUser(ctx, p, p.UserID)
	}
	if id, err := uuid.Parse(ref); err == nil {
		return svc.GetUser(ctx, p, id)
	}
	users, err := svc.ListUsers(ctx, p)
	if err != nil {
		return model.User{}, err
	}
	for _, u := range users {
		if strings.EqualFold(u.DisplayName, ref) || strings.EqualFold(u.Name, ref) ||
			(u.Email != nil && strings.EqualFold(*u.Email, ref)) {
			return u, nil
		}
	}
	return model.User{}, platform.NotFound("user")
}

// resolveState matches within one team's workflow, by id, by name, and finally by category
// — so "completed" finds a team's Done column without the caller knowing what it is called.
func resolveState(
	ctx context.Context, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, ref string,
) (model.WorkflowState, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.WorkflowState{}, platform.Validation("state", "a state is required")
	}
	states, err := svc.ListWorkflowStates(ctx, p, teamID)
	if err != nil {
		return model.WorkflowState{}, err
	}
	if id, err := uuid.Parse(ref); err == nil {
		for _, st := range states {
			if st.ID == id {
				return st, nil
			}
		}
		return model.WorkflowState{}, platform.NotFound("workflow state")
	}
	for _, st := range states {
		if strings.EqualFold(st.Name, ref) {
			return st, nil
		}
	}
	for _, st := range states {
		if strings.EqualFold(st.Category, ref) {
			return st, nil
		}
	}
	return model.WorkflowState{}, platform.NotFound("workflow state")
}

// resolveLabels maps each ref to the label ids it could mean. A name is only unique inside
// a team, and workspace labels sit beside team ones, so one ref legitimately matches
// several rows; callers that need a single id narrow by team themselves.
func resolveLabels(
	ctx context.Context, svc *domain.Service, p *authz.Principal, refs []string,
) (map[string][]model.Label, error) {
	out := make(map[string][]model.Label, len(refs))
	if len(refs) == 0 {
		return out, nil
	}
	labels, err := svc.ListLabels(ctx, p)
	if err != nil {
		return nil, err
	}
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		var matched []model.Label
		if id, err := uuid.Parse(ref); err == nil {
			for _, l := range labels {
				if l.ID == id {
					matched = append(matched, l)
				}
			}
		} else {
			for _, l := range labels {
				if strings.EqualFold(l.Name, ref) {
					matched = append(matched, l)
				}
			}
		}
		if len(matched) == 0 {
			return nil, platform.NotFound("label " + ref)
		}
		out[ref] = matched
	}
	return out, nil
}

// resolveLabelForTeam picks the one label a ref means for an issue in this team: the team's
// own label wins over the workspace-wide one of the same name, which is the precedence a
// person reading the label picker would expect.
func resolveLabelForTeam(
	ctx context.Context, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, ref string,
) (model.Label, error) {
	byRef, err := resolveLabels(ctx, svc, p, []string{ref})
	if err != nil {
		return model.Label{}, err
	}
	candidates := byRef[strings.TrimSpace(ref)]
	for _, l := range candidates {
		if l.TeamID != nil && *l.TeamID == teamID {
			return l, nil
		}
	}
	for _, l := range candidates {
		if l.TeamID == nil {
			return l, nil
		}
	}
	return model.Label{}, platform.NotFound("label " + ref)
}

// resolveCycle matches a team's cycle by id, name, or the number a person says out loud
// ("cycle 4"). Numbers restart per team, which is why this needs the team.
func resolveCycle(
	ctx context.Context, svc *domain.Service, p *authz.Principal, teamID uuid.UUID, ref string,
) (model.Cycle, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.Cycle{}, platform.Validation("cycle", "a cycle is required")
	}
	cycles, err := svc.ListCycles(ctx, p, teamID)
	if err != nil {
		return model.Cycle{}, err
	}
	if id, err := uuid.Parse(ref); err == nil {
		for _, c := range cycles {
			if c.ID == id {
				return c, nil
			}
		}
		return model.Cycle{}, platform.NotFound("cycle")
	}
	for _, c := range cycles {
		if strings.EqualFold(c.Name, ref) {
			return c, nil
		}
	}
	if n, err := strconv.Atoi(ref); err == nil {
		for _, c := range cycles {
			if c.Number == n {
				return c, nil
			}
		}
	}
	return model.Cycle{}, platform.NotFound("cycle")
}

func resolveProject(
	ctx context.Context, svc *domain.Service, p *authz.Principal, field, ref string,
) (model.Project, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.Project{}, platform.Validation(field, "a project is required")
	}
	if id, err := uuid.Parse(ref); err == nil {
		return svc.GetProject(ctx, p, id)
	}
	projects, err := svc.ListProjects(ctx, p)
	if err != nil {
		return model.Project{}, err
	}
	for _, proj := range projects {
		if strings.EqualFold(proj.Name, ref) {
			return proj, nil
		}
	}
	return model.Project{}, platform.NotFound("project")
}

func resolveMilestone(
	ctx context.Context, svc *domain.Service, p *authz.Principal, projectID uuid.UUID, ref string,
) (model.ProjectMilestone, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.ProjectMilestone{}, platform.Validation("milestone", "a milestone is required")
	}
	milestones, err := svc.ListProjectMilestones(ctx, p, projectID)
	if err != nil {
		return model.ProjectMilestone{}, err
	}
	if id, err := uuid.Parse(ref); err == nil {
		for _, m := range milestones {
			if m.ID == id {
				return m, nil
			}
		}
		return model.ProjectMilestone{}, platform.NotFound("milestone")
	}
	for _, m := range milestones {
		if strings.EqualFold(m.Name, ref) {
			return m, nil
		}
	}
	return model.ProjectMilestone{}, platform.NotFound("milestone")
}

// commentID is the one ref with no human-friendly form: comments have no identifier, so a
// UUID is the only thing that can name one.
func commentID(args map[string]any) (uuid.UUID, error) {
	raw := strArg(args, "id")
	if raw == "" {
		return uuid.Nil, platform.Validation("id", "a comment id is required")
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, platform.Validation("id", "a comment is named by its UUID")
	}
	return id, nil
}
