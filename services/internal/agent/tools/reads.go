package tools

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// scanIssueCap bounds the fan-out in listIssues when a filter has to be applied in memory.
// See the comment on listIssues for why there is a fan-out at all.
const scanIssueCap = 2000

var readTools = []Tool{
	{
		Name:        "list_issues",
		Description: "List issues the caller can see. Pass team as a key (ENG), name, or UUID.",
		InputSchema: objectSchema(map[string]any{
			"team":     stringSchema("Team key, name, or UUID"),
			"query":    stringSchema("Search title and description"),
			"limit":    intSchema("Max results (default 25, max 100)"),
			"state":    stringSchema("Workflow state name, category (backlog, unstarted, started, completed, canceled), or UUID"),
			"assignee": stringSchema(`User display name, email, UUID, "me", or "none" for unassigned`),
			"label":    stringSchema("Label name or UUID"),
			"cycle":    stringSchema("Cycle name, number, or UUID. Needs team to be unambiguous"),
		}, nil),
		ReadOnly: true,
		Run:      listIssues,
	},
	{
		Name:        "get_issue",
		Description: "Get one issue by UUID or identifier (ENG-123).",
		InputSchema: objectSchema(map[string]any{
			"id": stringSchema("Issue UUID or ENG-123 identifier"),
		}, []string{"id"}),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := svc.GetIssueByRef(ctx, p, strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			return issueJSON(issue), nil
		},
	},
	{
		Name:        "list_comments",
		Description: "List comments on an issue.",
		InputSchema: objectSchema(map[string]any{
			"id": stringSchema("Issue UUID or ENG-123 identifier"),
		}, []string{"id"}),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := svc.GetIssueByRef(ctx, p, strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			comments, err := svc.ListComments(ctx, p, issue.ID)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(comments))
			for _, c := range comments {
				out = append(out, commentJSON(c))
			}
			return out, nil
		},
	},
	{
		Name:        "list_teams",
		Description: "List teams the caller can see.",
		InputSchema: objectSchema(map[string]any{}, nil),
		ReadOnly:    true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, _ map[string]any) (any, error) {
			teams, err := svc.ListTeams(ctx, p)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(teams))
			for _, t := range teams {
				out = append(out, teamJSON(t))
			}
			return out, nil
		},
	},
	{
		Name:        "list_projects",
		Description: "List projects the caller can see.",
		InputSchema: objectSchema(map[string]any{}, nil),
		ReadOnly:    true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, _ map[string]any) (any, error) {
			projects, err := svc.ListProjects(ctx, p)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(projects))
			for _, proj := range projects {
				out = append(out, projectJSON(proj))
			}
			return out, nil
		},
	},
	{
		Name:        "get_viewer",
		Description: "The authenticated user and workspace.",
		InputSchema: objectSchema(map[string]any{}, nil),
		ReadOnly:    true,
		Run: func(_ context.Context, _ *domain.Service, p *authz.Principal, _ map[string]any) (any, error) {
			return map[string]any{
				"userId":      p.UserID.String(),
				"workspaceId": p.WorkspaceID.String(),
				"role":        string(p.Role),
			}, nil
		},
	},
	{
		Name:        "list_users",
		Description: "List members of the workspace. Use a display name or email as an assignee ref.",
		InputSchema: objectSchema(map[string]any{}, nil),
		ReadOnly:    true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, _ map[string]any) (any, error) {
			users, err := svc.ListUsers(ctx, p)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(users))
			for _, u := range users {
				out = append(out, userJSON(u))
			}
			return out, nil
		},
	},
	{
		Name:        "list_workflow_states",
		Description: "List a team's workflow states, in board order.",
		InputSchema: objectSchema(map[string]any{
			"team": stringSchema("Team key, name, or UUID"),
		}, []string{"team"}),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			team, err := resolveTeam(ctx, svc, p, strArg(args, "team"))
			if err != nil {
				return nil, err
			}
			states, err := svc.ListWorkflowStates(ctx, p, team.ID)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(states))
			for _, st := range states {
				out = append(out, stateJSON(st))
			}
			return out, nil
		},
	},
	{
		Name:        "list_labels",
		Description: "List labels. Pass team to see only that team's labels plus the workspace-wide ones.",
		InputSchema: objectSchema(map[string]any{
			"team": stringSchema("Team key, name, or UUID"),
		}, nil),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			var teamID *uuid.UUID
			if ref := strArg(args, "team"); ref != "" {
				team, err := resolveTeam(ctx, svc, p, ref)
				if err != nil {
					return nil, err
				}
				teamID = &team.ID
			}
			labels, err := svc.ListLabels(ctx, p)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(labels))
			for _, l := range labels {
				// A workspace label applies to every team, so it stays in a team-narrowed
				// listing: it is one of the labels that team can actually use.
				if teamID != nil && l.TeamID != nil && *l.TeamID != *teamID {
					continue
				}
				out = append(out, labelJSON(l))
			}
			return out, nil
		},
	},
	{
		Name:        "list_cycles",
		Description: "List a team's cycles. Cycle numbers restart per team, so a team is required.",
		InputSchema: objectSchema(map[string]any{
			"team": stringSchema("Team key, name, or UUID"),
		}, []string{"team"}),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			team, err := resolveTeam(ctx, svc, p, strArg(args, "team"))
			if err != nil {
				return nil, err
			}
			cycles, err := svc.ListCycles(ctx, p, team.ID)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(cycles))
			for _, c := range cycles {
				out = append(out, cycleJSON(c))
			}
			return out, nil
		},
	},
	{
		Name:        "list_my_issues",
		Description: "Issues assigned to the caller. Completed ones are left out unless asked for.",
		InputSchema: objectSchema(map[string]any{
			"includeCompleted": boolSchema("Include done and canceled issues (default false)"),
		}, nil),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issues, err := svc.MyIssues(ctx, p, boolArg(args, "includeCompleted", false))
			if err != nil {
				return nil, err
			}
			return issuesJSON(issues), nil
		},
	},
	{
		Name:        "get_project",
		Description: "Get one project by UUID or name.",
		InputSchema: objectSchema(map[string]any{
			"id": stringSchema("Project UUID or name"),
		}, []string{"id"}),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			proj, err := resolveProject(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			return projectDetailJSON(proj), nil
		},
	},
	{
		Name:        "list_milestones",
		Description: "List a project's milestones.",
		InputSchema: objectSchema(map[string]any{
			"project": stringSchema("Project UUID or name"),
		}, []string{"project"}),
		ReadOnly: true,
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			proj, err := resolveProject(ctx, svc, p, "project", strArg(args, "project"))
			if err != nil {
				return nil, err
			}
			milestones, err := svc.ListProjectMilestones(ctx, p, proj.ID)
			if err != nil {
				return nil, err
			}
			out := make([]map[string]any, 0, len(milestones))
			for _, m := range milestones {
				out = append(out, milestoneJSON(m))
			}
			return out, nil
		},
	},
}

// listIssues fans out over the caller's teams because the domain layer has no filtered
// issue query: Search needs text to match, and ListIssuesForTeam is one team at a time and
// takes no predicate. So the filters below are applied here, to rows already in memory.
//
// Two consequences worth knowing before relying on this: without a text query the result is
// the first `limit` issues found while walking teams in ListTeams order, not the newest or
// the most relevant; and with a filter the walk stops after scanIssueCap rows, so a
// workspace larger than that can report fewer matches than it holds. Both go away the day
// the domain layer grows a paged, filtered issue query — that is the fix, not more code
// here.
func listIssues(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	limit := intArg(args, "limit", 25)
	if limit > 100 {
		limit = 100
	}
	f := issueFilter{
		state:    strArg(args, "state"),
		assignee: strArg(args, "assignee"),
		label:    strArg(args, "label"),
		cycle:    strArg(args, "cycle"),
	}

	query := strArg(args, "query")
	if query != "" {
		res, err := svc.Search(ctx, p, domain.SearchInput{Query: query, First: limit})
		if err != nil {
			return nil, err
		}
		issues, err := filterIssues(ctx, svc, p, res.Issues, f)
		if err != nil {
			return nil, err
		}
		return issuesJSON(issues), nil
	}

	teamRef := strArg(args, "team")
	var teams []model.Team
	if teamRef != "" {
		team, err := resolveTeam(ctx, svc, p, teamRef)
		if err != nil {
			return nil, err
		}
		teams = []model.Team{team}
	} else {
		var err error
		teams, err = svc.ListTeams(ctx, p)
		if err != nil {
			return nil, err
		}
	}

	if f.empty() {
		// The unfiltered walk, unchanged: stop the moment the limit is reached, without
		// querying the teams after it.
		var out []model.Issue
		for _, team := range teams {
			if len(out) >= limit {
				break
			}
			issues, err := svc.ListIssuesForTeam(ctx, p, team.ID)
			if err != nil {
				return nil, err
			}
			for _, issue := range issues {
				if issue.DeletedAt != nil {
					continue
				}
				out = append(out, issue)
				if len(out) >= limit {
					break
				}
			}
		}
		return issuesJSON(out), nil
	}

	// Filtered: the whole pool has to be gathered before anything can be truncated,
	// because a team's first rows are not necessarily its matching ones.
	var pool []model.Issue
	for _, team := range teams {
		if len(pool) >= scanIssueCap {
			break
		}
		issues, err := svc.ListIssuesForTeam(ctx, p, team.ID)
		if err != nil {
			return nil, err
		}
		for _, issue := range issues {
			if issue.DeletedAt != nil {
				continue
			}
			pool = append(pool, issue)
			if len(pool) >= scanIssueCap {
				break
			}
		}
	}
	matched, err := filterIssues(ctx, svc, p, pool, f)
	if err != nil {
		return nil, err
	}
	if len(matched) > limit {
		matched = matched[:limit]
	}
	return issuesJSON(matched), nil
}

type issueFilter struct {
	state    string
	assignee string
	label    string
	cycle    string
}

func (f issueFilter) empty() bool {
	return f.state == "" && f.assignee == "" && f.label == "" && f.cycle == ""
}

// filterIssues applies the in-memory filters, preserving the order it was given.
//
// State, label and cycle are team-scoped, so a ref is resolved once per team present in the
// input. A team in which the ref names nothing simply contributes no matches — "In
// Progress" existing in one team and not another is normal — but if no team resolves it at
// all, that is a typo and the caller is told so rather than handed an empty list.
func filterIssues(
	ctx context.Context, svc *domain.Service, p *authz.Principal, issues []model.Issue, f issueFilter,
) ([]model.Issue, error) {
	if f.empty() || len(issues) == 0 {
		return issues, nil
	}

	// Users are workspace-wide, so the assignee resolves once.
	var wantAssignee *uuid.UUID
	wantUnassigned := false
	if f.assignee != "" {
		switch strings.ToLower(f.assignee) {
		case "none", "unassigned", "nobody":
			wantUnassigned = true
		default:
			u, err := resolveUser(ctx, svc, p, "assignee", f.assignee)
			if err != nil {
				return nil, err
			}
			id := u.ID
			wantAssignee = &id
		}
	}

	teamIDs := make([]uuid.UUID, 0, 4)
	seen := map[uuid.UUID]bool{}
	for _, issue := range issues {
		if !seen[issue.TeamID] {
			seen[issue.TeamID] = true
			teamIDs = append(teamIDs, issue.TeamID)
		}
	}

	states := map[uuid.UUID]uuid.UUID{} // team -> matching state
	cycles := map[uuid.UUID]uuid.UUID{} // team -> matching cycle
	labels := map[uuid.UUID]uuid.UUID{} // team -> matching label
	for _, teamID := range teamIDs {
		if f.state != "" {
			if st, err := resolveState(ctx, svc, p, teamID, f.state); err == nil {
				states[teamID] = st.ID
			} else if platform.CodeOf(err) != platform.CodeNotFound {
				return nil, err
			}
		}
		if f.cycle != "" {
			if c, err := resolveCycle(ctx, svc, p, teamID, f.cycle); err == nil {
				cycles[teamID] = c.ID
			} else if platform.CodeOf(err) != platform.CodeNotFound {
				return nil, err
			}
		}
		if f.label != "" {
			if l, err := resolveLabelForTeam(ctx, svc, p, teamID, f.label); err == nil {
				labels[teamID] = l.ID
			} else if platform.CodeOf(err) != platform.CodeNotFound {
				return nil, err
			}
		}
	}
	if f.state != "" && len(states) == 0 {
		return nil, platform.NotFound("workflow state")
	}
	if f.cycle != "" && len(cycles) == 0 {
		return nil, platform.NotFound("cycle")
	}
	if f.label != "" && len(labels) == 0 {
		return nil, platform.NotFound("label " + f.label)
	}

	// Labels need one extra read, batched over everything that survived the cheap
	// predicates rather than issue by issue.
	candidates := make([]model.Issue, 0, len(issues))
	for _, issue := range issues {
		if wantUnassigned && issue.AssigneeID != nil {
			continue
		}
		if wantAssignee != nil && (issue.AssigneeID == nil || *issue.AssigneeID != *wantAssignee) {
			continue
		}
		if f.state != "" && issue.StateID != states[issue.TeamID] {
			continue
		}
		if f.cycle != "" && (issue.CycleID == nil || *issue.CycleID != cycles[issue.TeamID]) {
			continue
		}
		candidates = append(candidates, issue)
	}
	if f.label == "" || len(candidates) == 0 {
		return candidates, nil
	}

	ids := make([]uuid.UUID, 0, len(candidates))
	for _, issue := range candidates {
		ids = append(ids, issue.ID)
	}
	byIssue, err := svc.ListIssueLabelsForIssues(ctx, p, ids)
	if err != nil {
		return nil, err
	}
	out := make([]model.Issue, 0, len(candidates))
	for _, issue := range candidates {
		want, ok := labels[issue.TeamID]
		if !ok {
			continue
		}
		for _, applied := range byIssue[issue.ID] {
			if applied.LabelID == want {
				out = append(out, issue)
				break
			}
		}
	}
	return out, nil
}
