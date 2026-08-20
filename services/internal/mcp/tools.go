package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

type toolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func (s *Server) tools() []toolDef {
	read := []toolDef{
		{
			Name:        "list_issues",
			Description: "List issues the caller can see. Pass team as a key (ENG), name, or UUID.",
			InputSchema: objectSchema(map[string]any{
				"team":  map[string]any{"type": "string", "description": "Team key, name, or UUID"},
				"query": map[string]any{"type": "string", "description": "Search title and description"},
				"limit": map[string]any{"type": "integer", "description": "Max results (default 25, max 100)"},
			}, nil),
		},
		{
			Name:        "get_issue",
			Description: "Get one issue by UUID or identifier (ENG-123).",
			InputSchema: objectSchema(map[string]any{
				"id": map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
			}, []string{"id"}),
		},
		{
			Name:        "list_comments",
			Description: "List comments on an issue.",
			InputSchema: objectSchema(map[string]any{
				"id": map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
			}, []string{"id"}),
		},
		{
			Name:        "list_teams",
			Description: "List teams the caller can see.",
			InputSchema: objectSchema(map[string]any{}, nil),
		},
		{
			Name:        "list_projects",
			Description: "List projects the caller can see.",
			InputSchema: objectSchema(map[string]any{}, nil),
		},
		{
			Name:        "get_viewer",
			Description: "The authenticated user and workspace.",
			InputSchema: objectSchema(map[string]any{}, nil),
		},
	}
	if s.ReadOnly {
		return read
	}
	write := []toolDef{
		{
			Name:        "create_issue",
			Description: "Create an issue. team is required (key, name, or UUID).",
			InputSchema: objectSchema(map[string]any{
				"title":       map[string]any{"type": "string"},
				"team":        map[string]any{"type": "string", "description": "Team key, name, or UUID"},
				"description": map[string]any{"type": "string"},
				"priority":    map[string]any{"type": "integer", "description": "0 none, 1 urgent, 2 high, 3 medium, 4 low"},
				"assigneeId":  map[string]any{"type": "string"},
			}, []string{"title", "team"}),
		},
		{
			Name:        "update_issue",
			Description: "Update an issue's title, description, or priority.",
			InputSchema: objectSchema(map[string]any{
				"id":          map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
				"title":       map[string]any{"type": "string"},
				"description": map[string]any{"type": "string"},
				"priority":    map[string]any{"type": "integer"},
			}, []string{"id"}),
		},
		{
			Name:        "create_comment",
			Description: "Comment on an issue.",
			InputSchema: objectSchema(map[string]any{
				"id":   map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
				"body": map[string]any{"type": "string"},
			}, []string{"id", "body"}),
		},
	}
	return append(read, write...)
}

func objectSchema(properties map[string]any, required []string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func (s *Server) callTool(r *http.Request, p *authz.Principal, raw json.RawMessage) (any, *rpcError) {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || params.Name == "" {
		return nil, &rpcError{Code: -32602, Message: "tools/call needs name"}
	}
	args := map[string]any{}
	if len(params.Arguments) > 0 {
		if err := json.Unmarshal(params.Arguments, &args); err != nil {
			return nil, &rpcError{Code: -32602, Message: "arguments must be an object"}
		}
	}

	write := map[string]bool{
		"create_issue":   true,
		"update_issue":   true,
		"create_comment": true,
	}
	if write[params.Name] {
		if s.ReadOnly || !p.HasScope(domain.APIKeyScopeWrite) {
			return toolError("this connection is read-only"), nil
		}
	}

	ctx := r.Context()
	out, err := s.runTool(ctx, p, params.Name, args)
	if err != nil {
		return toolError(err.Error()), nil
	}
	return toolText(out), nil
}

func (s *Server) runTool(ctx context.Context, p *authz.Principal, name string, args map[string]any) (any, error) {
	switch name {
	case "get_viewer":
		return map[string]any{
			"userId":      p.UserID.String(),
			"workspaceId": p.WorkspaceID.String(),
			"role":        string(p.Role),
		}, nil
	case "list_teams":
		teams, err := s.Svc.ListTeams(ctx, p)
		if err != nil {
			return nil, err
		}
		out := make([]map[string]any, 0, len(teams))
		for _, t := range teams {
			out = append(out, map[string]any{
				"id": t.ID.String(), "key": t.Key, "name": t.Name, "private": t.Private,
			})
		}
		return out, nil
	case "list_projects":
		projects, err := s.Svc.ListProjects(ctx, p)
		if err != nil {
			return nil, err
		}
		out := make([]map[string]any, 0, len(projects))
		for _, proj := range projects {
			out = append(out, map[string]any{
				"id": proj.ID.String(), "name": proj.Name,
			})
		}
		return out, nil
	case "get_issue":
		issue, err := s.Svc.GetIssueByRef(ctx, p, strArg(args, "id"))
		if err != nil {
			return nil, err
		}
		return issueJSON(issue), nil
	case "list_comments":
		issue, err := s.Svc.GetIssueByRef(ctx, p, strArg(args, "id"))
		if err != nil {
			return nil, err
		}
		comments, err := s.Svc.ListComments(ctx, p, issue.ID)
		if err != nil {
			return nil, err
		}
		out := make([]map[string]any, 0, len(comments))
		for _, c := range comments {
			out = append(out, map[string]any{
				"id": c.ID.String(), "issueId": c.IssueID.String(), "body": c.Body,
				"createdAt": c.CreatedAt,
			})
		}
		return out, nil
	case "list_issues":
		return s.listIssues(ctx, p, args)
	case "create_issue":
		return s.createIssue(ctx, p, args)
	case "update_issue":
		return s.updateIssue(ctx, p, args)
	case "create_comment":
		issue, err := s.Svc.GetIssueByRef(ctx, p, strArg(args, "id"))
		if err != nil {
			return nil, err
		}
		row, _, err := s.Svc.CreateComment(ctx, p, domain.CreateCommentInput{
			IssueID: issue.ID,
			Body:    strArg(args, "body"),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": row.ID.String(), "issueId": row.IssueID.String(), "body": row.Body}, nil
	default:
		return nil, platform.Validation("name", fmt.Sprintf("unknown tool %q", name))
	}
}

func (s *Server) listIssues(ctx context.Context, p *authz.Principal, args map[string]any) (any, error) {
	limit := intArg(args, "limit", 25)
	if limit > 100 {
		limit = 100
	}
	query := strArg(args, "query")
	if query != "" {
		res, err := s.Svc.Search(ctx, p, domain.SearchInput{Query: query, First: limit})
		if err != nil {
			return nil, err
		}
		return issuesJSON(res.Issues), nil
	}
	teamRef := strArg(args, "team")
	var teams []model.Team
	if teamRef != "" {
		team, err := s.resolveTeam(ctx, p, teamRef)
		if err != nil {
			return nil, err
		}
		teams = []model.Team{team}
	} else {
		var err error
		teams, err = s.Svc.ListTeams(ctx, p)
		if err != nil {
			return nil, err
		}
	}
	var out []model.Issue
	for _, team := range teams {
		if len(out) >= limit {
			break
		}
		issues, err := s.Svc.ListIssuesForTeam(ctx, p, team.ID)
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

func (s *Server) createIssue(ctx context.Context, p *authz.Principal, args map[string]any) (any, error) {
	team, err := s.resolveTeam(ctx, p, strArg(args, "team"))
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
	issue, _, err := s.Svc.CreateIssue(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return issueJSON(issue), nil
}

func (s *Server) updateIssue(ctx context.Context, p *authz.Principal, args map[string]any) (any, error) {
	issue, err := s.Svc.GetIssueByRef(ctx, p, strArg(args, "id"))
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
	updated, _, err := s.Svc.UpdateIssue(ctx, p, in)
	if err != nil {
		return nil, err
	}
	return issueJSON(updated), nil
}

func (s *Server) resolveTeam(ctx context.Context, p *authz.Principal, ref string) (model.Team, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return model.Team{}, platform.Validation("team", "a team is required")
	}
	teams, err := s.Svc.ListTeams(ctx, p)
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

func toolText(v any) map[string]any {
	raw, _ := json.MarshalIndent(v, "", "  ")
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": string(raw)}},
		"isError": false,
	}
}

func toolError(msg string) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": msg}},
		"isError": true,
	}
}

func strArg(args map[string]any, key string) string {
	v, _ := args[key].(string)
	return strings.TrimSpace(v)
}

func intArg(args map[string]any, key string, fallback int) int {
	switch v := args[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return n
		}
	}
	return fallback
}
