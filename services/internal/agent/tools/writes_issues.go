package tools

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The single-field setters below exist alongside update_issue on purpose. A model asked to
// "put ENG-14 in review" reliably calls set_issue_state; asked to do it through
// update_issue it has to know that a state is named by a uuid it does not have, and the
// usual failure is a plausible-looking uuid invented on the spot. One verb, one argument,
// resolved from the name a person would say.

var issueWriteTools = []Tool{
	{
		Name:        "create_issue",
		Description: "Create an issue. team is required (key, name, or UUID).",
		InputSchema: objectSchema(map[string]any{
			"title":       map[string]any{"type": "string"},
			"team":        stringSchema("Team key, name, or UUID"),
			"description": map[string]any{"type": "string"},
			"priority":    intSchema("0 none, 1 urgent, 2 high, 3 medium, 4 low"),
			"assigneeId":  map[string]any{"type": "string"},
		}, []string{"title", "team"}),
		Run: createIssue,
	},
	{
		Name:        "update_issue",
		Description: "Update an issue's title, description, or priority.",
		InputSchema: objectSchema(map[string]any{
			"id":          stringSchema("Issue UUID or ENG-123 identifier"),
			"title":       map[string]any{"type": "string"},
			"description": map[string]any{"type": "string"},
			"priority":    map[string]any{"type": "integer"},
		}, []string{"id"}),
		Run: updateIssue,
	},
	{
		Name:        "assign_issue",
		Description: "Assign an issue, or unassign it by leaving assignee out.",
		InputSchema: objectSchema(map[string]any{
			"id":       stringSchema("Issue UUID or ENG-123 identifier"),
			"assignee": stringSchema(`User display name, email, UUID, or "me". Omit to unassign`),
		}, []string{"id"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			in := domain.UpdateIssueInput{ID: issue.ID}
			if ref := strArg(args, "assignee"); ref != "" {
				u, err := resolveUser(ctx, svc, p, "assignee", ref)
				if err != nil {
					return nil, err
				}
				id := u.ID
				in.AssigneeID = &id
			} else {
				in.ClearAssignee = true
			}
			updated, _, err := svc.UpdateIssue(ctx, p, in)
			if err != nil {
				return nil, err
			}
			return issueDetailJSON(updated), nil
		},
	},
	{
		Name:        "set_issue_state",
		Description: "Move an issue to a workflow state, named or by category (backlog, unstarted, started, completed, canceled).",
		InputSchema: objectSchema(map[string]any{
			"id":    stringSchema("Issue UUID or ENG-123 identifier"),
			"state": stringSchema("Workflow state name, category, or UUID"),
		}, []string{"id", "state"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			// Resolved against the issue's own team: a state belongs to one workflow, and
			// the same name in another team is a different row.
			st, err := resolveState(ctx, svc, p, issue.TeamID, strArg(args, "state"))
			if err != nil {
				return nil, err
			}
			updated, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, StateID: &st.ID})
			if err != nil {
				return nil, err
			}
			return issueDetailJSON(updated), nil
		},
	},
	{
		Name:        "set_issue_labels",
		Description: "Replace an issue's labels with exactly this set. An empty list removes them all.",
		InputSchema: objectSchema(map[string]any{
			"id":     stringSchema("Issue UUID or ENG-123 identifier"),
			"labels": stringListSchema("Label names or UUIDs. This is the complete set, not an addition"),
		}, []string{"id", "labels"}),
		Run: setIssueLabels,
	},
	{
		Name:        "set_issue_estimate",
		Description: "Set an issue's estimate in points. Omit estimate to clear it — unestimated is not zero.",
		InputSchema: objectSchema(map[string]any{
			"id":       stringSchema("Issue UUID or ENG-123 identifier"),
			"estimate": intSchema("Points, 0 to 1000. Omit to clear"),
		}, []string{"id"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			in := domain.UpdateIssueInput{ID: issue.ID}
			if present(args, "estimate") {
				n := intArg(args, "estimate", 0)
				in.Estimate = &n
			} else {
				in.ClearEstimate = true
			}
			updated, _, err := svc.UpdateIssue(ctx, p, in)
			if err != nil {
				return nil, err
			}
			return issueDetailJSON(updated), nil
		},
	},
	{
		Name:        "set_issue_due_date",
		Description: "Set an issue's due date as a calendar day. Omit dueDate to clear it.",
		InputSchema: objectSchema(map[string]any{
			"id":      stringSchema("Issue UUID or ENG-123 identifier"),
			"dueDate": stringSchema("Calendar day, 2006-01-02. Omit to clear"),
		}, []string{"id"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			in := domain.UpdateIssueInput{ID: issue.ID}
			if raw := strArg(args, "dueDate"); raw != "" {
				// Not parsed here. The domain layer owns the format and its message names
				// it; a second parser would be a second answer to the same question.
				day := model.Date(raw)
				in.DueDate = &day
			} else {
				in.ClearDueDate = true
			}
			updated, _, err := svc.UpdateIssue(ctx, p, in)
			if err != nil {
				return nil, err
			}
			return issueDetailJSON(updated), nil
		},
	},
	{
		Name:        "create_sub_issue",
		Description: "Create an issue underneath another. Defaults to the parent's team; cross-team is allowed.",
		InputSchema: objectSchema(map[string]any{
			"parent":      stringSchema("Parent issue UUID or ENG-123 identifier"),
			"title":       map[string]any{"type": "string"},
			"description": map[string]any{"type": "string"},
			"team":        stringSchema("Team key, name, or UUID. Defaults to the parent's team"),
			"priority":    intSchema("0 none, 1 urgent, 2 high, 3 medium, 4 low"),
			"assignee":    stringSchema(`User display name, email, UUID, or "me"`),
		}, []string{"parent", "title"}),
		Run: createSubIssue,
	},
	{
		Name:        "link_issues",
		Description: "Relate two issues: blocks, related, or duplicate.",
		InputSchema: objectSchema(map[string]any{
			"id":        stringSchema("Issue UUID or ENG-123 identifier"),
			"relatedId": stringSchema("The other issue, UUID or ENG-123 identifier"),
			"type": map[string]any{
				"type":        "string",
				"enum":        []string{model.RelationBlocks, model.RelationRelated, model.RelationDuplicate},
				"description": "blocks means id blocks relatedId",
			},
		}, []string{"id", "relatedId", "type"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			related, err := resolveIssue(ctx, svc, p, "relatedId", strArg(args, "relatedId"))
			if err != nil {
				return nil, err
			}
			rel, _, err := svc.CreateIssueRelation(ctx, p, issue.ID, related.ID, strArg(args, "type"))
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"id":             rel.ID.String(),
				"issueId":        rel.IssueID.String(),
				"relatedIssueId": rel.RelatedIssueID.String(),
				"type":           rel.Type,
			}, nil
		},
	},
	{
		Name:        "archive_issue",
		Description: "Archive an issue, or restore it with archived false. Archiving is not deleting.",
		InputSchema: objectSchema(map[string]any{
			"id":       stringSchema("Issue UUID or ENG-123 identifier"),
			"archived": boolSchema("True to archive (default), false to restore"),
		}, []string{"id"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			archived := boolArg(args, "archived", true)
			if _, err := svc.ArchiveIssue(ctx, p, issue.ID, archived); err != nil {
				return nil, err
			}
			return map[string]any{
				"id":         issue.ID.String(),
				"identifier": issue.Identifier,
				"archived":   archived,
			}, nil
		},
	},
	{
		Name:        "add_issue_to_project",
		Description: "Put an issue in a project, optionally on one of its milestones.",
		InputSchema: objectSchema(map[string]any{
			"id":        stringSchema("Issue UUID or ENG-123 identifier"),
			"project":   stringSchema("Project UUID or name"),
			"milestone": stringSchema("Milestone UUID or name, within that project"),
		}, []string{"id", "project"}),
		Run: func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
			issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
			if err != nil {
				return nil, err
			}
			proj, err := resolveProject(ctx, svc, p, "project", strArg(args, "project"))
			if err != nil {
				return nil, err
			}
			in := domain.UpdateIssueInput{ID: issue.ID, ProjectID: &proj.ID}
			if ref := strArg(args, "milestone"); ref != "" {
				m, err := resolveMilestone(ctx, svc, p, proj.ID, ref)
				if err != nil {
					return nil, err
				}
				in.ProjectMilestoneID = &m.ID
			}
			updated, _, err := svc.UpdateIssue(ctx, p, in)
			if err != nil {
				return nil, err
			}
			return issueDetailJSON(updated), nil
		},
	},
}

func createIssue(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	team, err := resolveTeam(ctx, svc, p, strArg(args, "team"))
	if err != nil {
		return nil, err
	}
	in := domain.CreateIssueInput{
		TeamID:      team.ID,
		Title:       strArg(args, "title"),
		Description: strArg(args, "description"),
		Priority:    intArg(args, "priority", 0),
	}
	if raw := strArg(args, "assigneeId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return nil, platform.Validation("assigneeId", "must be a UUID")
		}
		in.AssigneeID = &id
	}
	issue, _, err := svc.CreateIssue(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return issueJSON(issue), nil
}

func updateIssue(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	issue, err := svc.GetIssueByRef(ctx, p, strArg(args, "id"))
	if err != nil {
		return nil, err
	}
	in := domain.UpdateIssueInput{ID: issue.ID}
	if v, ok := args["title"].(string); ok {
		in.Title = &v
	}
	if v, ok := args["description"].(string); ok {
		in.Description = &v
	}
	if _, ok := args["priority"]; ok {
		n := intArg(args, "priority", 0)
		in.Priority = &n
	}
	updated, _, err := svc.UpdateIssue(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return issueJSON(updated), nil
}

func createSubIssue(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	parent, err := resolveIssue(ctx, svc, p, "parent", strArg(args, "parent"))
	if err != nil {
		return nil, err
	}
	teamID := parent.TeamID
	if ref := strArg(args, "team"); ref != "" {
		team, err := resolveTeam(ctx, svc, p, ref)
		if err != nil {
			return nil, err
		}
		teamID = team.ID
	}
	in := domain.CreateIssueInput{
		TeamID:      teamID,
		Title:       strArg(args, "title"),
		Description: strArg(args, "description"),
		Priority:    intArg(args, "priority", 0),
		ParentID:    &parent.ID,
	}
	if ref := strArg(args, "assignee"); ref != "" {
		u, err := resolveUser(ctx, svc, p, "assignee", ref)
		if err != nil {
			return nil, err
		}
		id := u.ID
		in.AssigneeID = &id
	}
	issue, _, err := svc.CreateIssue(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return issueDetailJSON(issue), nil
}

// setIssueLabels is declarative: the caller says what the label set should be and the diff
// happens here. The alternative — add and remove verbs — makes an agent read the current
// set, compute the difference and issue N calls, and it gets that wrong the moment two of
// them run against the same issue.
func setIssueLabels(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error) {
	issue, err := resolveIssue(ctx, svc, p, "id", strArg(args, "id"))
	if err != nil {
		return nil, err
	}

	want := map[uuid.UUID]bool{}
	ordered := make([]uuid.UUID, 0, 4)
	for _, ref := range strSliceArg(args, "labels") {
		l, err := resolveLabelForTeam(ctx, svc, p, issue.TeamID, ref)
		if err != nil {
			return nil, err
		}
		if !want[l.ID] {
			want[l.ID] = true
			ordered = append(ordered, l.ID)
		}
	}

	current, err := svc.ListIssueLabels(ctx, p, issue.ID)
	if err != nil {
		return nil, err
	}
	have := map[uuid.UUID]bool{}
	for _, applied := range current {
		have[applied.LabelID] = true
	}

	// Removals first. A label group allows one member per issue, so replacing "P2" with
	// "P1" has to let go of the old one before it can take the new.
	for _, applied := range current {
		if !want[applied.LabelID] {
			if _, _, err := svc.RemoveIssueLabel(ctx, p, issue.ID, applied.LabelID); err != nil {
				return nil, err
			}
		}
	}
	for _, id := range ordered {
		if have[id] {
			continue
		}
		if _, _, err := svc.AddIssueLabel(ctx, p, issue.ID, id); err != nil {
			return nil, err
		}
	}

	out := issueDetailJSON(issue)
	labelIDs := make([]string, 0, len(ordered))
	for _, id := range ordered {
		labelIDs = append(labelIDs, id.String())
	}
	out["labelIds"] = labelIDs
	return out, nil
}
