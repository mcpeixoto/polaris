package tools

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
)

// The shapes below are the tool output contract. They are hand-written rather than
// json.Marshal of the model, because a model struct gains fields as the product does and a
// tool result that grew a field per release would keep re-teaching every agent that reads
// it. Optional keys are omitted rather than sent as null, so a reader can branch on
// presence.
//
// issueJSON in particular is depended on by external MCP clients. Adding a key is safe;
// renaming or removing one is not.

func issueJSON(issue model.Issue) map[string]any {
	out := map[string]any{
		"id":         issue.ID.String(),
		"identifier": issue.Identifier,
		"title":      issue.Title,
		"priority":   issue.Priority,
		"teamId":     issue.TeamID.String(),
		"stateId":    issue.StateID.String(),
		"url":        "/issue/" + issue.Identifier,
	}
	if issue.Description != "" {
		out["description"] = issue.Description
	}
	if issue.AssigneeID != nil {
		out["assigneeId"] = issue.AssigneeID.String()
	}
	return out
}

func issuesJSON(issues []model.Issue) []map[string]any {
	out := make([]map[string]any, 0, len(issues))
	for _, issue := range issues {
		out = append(out, issueJSON(issue))
	}
	return out
}

// issueDetailJSON is issueJSON plus the fields a single-issue read can afford to carry.
// Kept separate so a list of a hundred issues does not pay for them.
func issueDetailJSON(issue model.Issue) map[string]any {
	out := issueJSON(issue)
	if issue.Estimate != nil {
		out["estimate"] = *issue.Estimate
	}
	if issue.DueDate != nil {
		out["dueDate"] = string(*issue.DueDate)
	}
	if issue.ParentID != nil {
		out["parentId"] = issue.ParentID.String()
	}
	if issue.ProjectID != nil {
		out["projectId"] = issue.ProjectID.String()
	}
	if issue.ProjectMilestoneID != nil {
		out["projectMilestoneId"] = issue.ProjectMilestoneID.String()
	}
	if issue.CycleID != nil {
		out["cycleId"] = issue.CycleID.String()
	}
	if issue.ArchivedAt != nil {
		out["archivedAt"] = issue.ArchivedAt
	}
	return out
}

func teamJSON(t model.Team) map[string]any {
	return map[string]any{
		"id": t.ID.String(), "key": t.Key, "name": t.Name, "private": t.Private,
	}
}

func projectJSON(proj model.Project) map[string]any {
	out := map[string]any{
		"id": proj.ID.String(), "name": proj.Name,
	}
	return out
}

// projectDetailJSON is what get_project and the project writes return. list_projects keeps
// the two-key shape it has always had.
func projectDetailJSON(proj model.Project) map[string]any {
	out := map[string]any{
		"id":       proj.ID.String(),
		"name":     proj.Name,
		"statusId": proj.StatusID.String(),
		"priority": proj.Priority,
		"url":      "/project/" + proj.ID.String(),
	}
	if proj.Summary != nil {
		out["summary"] = *proj.Summary
	}
	if proj.Description != "" {
		out["description"] = proj.Description
	}
	if proj.LeadID != nil {
		out["leadId"] = proj.LeadID.String()
	}
	if proj.StartDate != nil {
		out["startDate"] = string(*proj.StartDate)
	}
	if proj.TargetDate != nil {
		out["targetDate"] = string(*proj.TargetDate)
	}
	if proj.ArchivedAt != nil {
		out["archivedAt"] = proj.ArchivedAt
	}
	return out
}

func commentJSON(c model.Comment) map[string]any {
	return map[string]any{
		"id": c.ID.String(), "issueId": c.IssueID.String(), "body": c.Body,
		"createdAt": c.CreatedAt,
	}
}

func userJSON(u model.User) map[string]any {
	out := map[string]any{
		"id":          u.ID.String(),
		"name":        u.Name,
		"displayName": u.DisplayName,
		"role":        u.Role,
		"status":      u.Status,
	}
	// Only the viewer's own address and, for an admin, everyone's — the domain layer has
	// already decided that, so copying it through is the whole rule.
	if u.Email != nil {
		out["email"] = *u.Email
	}
	return out
}

func stateJSON(st model.WorkflowState) map[string]any {
	return map[string]any{
		"id":        st.ID.String(),
		"teamId":    st.TeamID.String(),
		"name":      st.Name,
		"category":  st.Category,
		"color":     st.Color,
		"isDefault": st.IsDefault,
	}
}

func labelJSON(l model.Label) map[string]any {
	out := map[string]any{
		"id":      l.ID.String(),
		"name":    l.Name,
		"color":   l.Color,
		"isGroup": l.IsGroup,
	}
	if l.TeamID != nil {
		out["teamId"] = l.TeamID.String()
	}
	return out
}

func cycleJSON(c model.Cycle) map[string]any {
	out := map[string]any{
		"id":       c.ID.String(),
		"teamId":   c.TeamID.String(),
		"number":   c.Number,
		"name":     c.Name,
		"startsAt": c.StartsAt,
		"endsAt":   c.EndsAt,
	}
	if c.CompletedAt != nil {
		out["completedAt"] = c.CompletedAt
	}
	return out
}

func milestoneJSON(m model.ProjectMilestone) map[string]any {
	out := map[string]any{
		"id":        m.ID.String(),
		"projectId": m.ProjectID.String(),
		"name":      m.Name,
	}
	if m.Description != nil {
		out["description"] = *m.Description
	}
	if m.TargetDate != nil {
		out["targetDate"] = string(*m.TargetDate)
	}
	return out
}
