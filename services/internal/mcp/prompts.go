package mcp

import (
	"encoding/json"
	"strings"
)

// The six workflows the MCP documentation holds up as what good looks like, shipped as
// prompts rather than left in a docs page.
//
// They are here because the failure mode of a tool server is not a missing tool, it is a
// model that has every tool and no idea which combination the product expects. Each of
// these encodes the same two habits: show the structure before creating anything, and say
// what is uncertain instead of inventing it. A model that follows them makes the kind of
// mess a person can review; one improvising does not.

type promptArg struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

type promptDef struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Arguments   []promptArg `json:"arguments,omitempty"`

	// Rendered with {{arg}} substitution. Unfilled optional arguments collapse to nothing,
	// so the instruction still reads as a sentence.
	template string
}

func prompts() []promptDef {
	return []promptDef{
		{
			Name:        "roadmap_planning",
			Description: "Turn a planning document into a project with issues and milestones.",
			Arguments: []promptArg{
				{Name: "document", Description: "The planning document or notes", Required: true},
				{Name: "team", Description: "Team key the work belongs to, e.g. ENG"},
			},
			template: `Read the planning document below and turn it into Polaris structure{{team_clause}}.

Before creating anything, show me the proposed structure: the project, its milestones, and
the issues under each, with the relations between them. Wait for my approval.

Where the document is ambiguous about scope, ownership or sequencing, list the ambiguity.
Do not invent a dependency the document does not state.

Document:
{{document}}`,
		},
		{
			Name:        "standup_notes",
			Description: "Match standup notes to existing issues and comment on the confident matches.",
			Arguments: []promptArg{
				{Name: "notes", Description: "The standup notes", Required: true},
			},
			template: `Match each line of the notes below to an existing issue, using the issue
identifier where one is given and otherwise the title, owner and context.

Comment only on matches you are confident about. List every note you could not match
rather than attaching it to the nearest issue — a comment on the wrong issue costs more
than one that was never posted.

Notes:
{{notes}}`,
		},
		{
			Name:        "bug_investigation",
			Description: "Investigate a reported bug and post a summary of the likely cause.",
			Arguments: []promptArg{
				{Name: "issue", Description: "Issue identifier, e.g. ENG-123", Required: true},
			},
			template: `Start from {{issue}}. Read the issue, its comments and any issues it
relates to.

Work out the most likely root cause and post it as a comment, with the evidence that
supports it. Where you are uncertain, say so in the comment — a stated maybe is useful and
a confident wrong answer sends somebody down a dead end.`,
		},
		{
			Name:        "cycle_summary",
			Description: "Summarise the most recently completed cycle for a team.",
			Arguments: []promptArg{
				{Name: "team", Description: "Team key, e.g. ENG", Required: true},
			},
			template: `Summarise the most recently completed cycle for {{team}}.

Focus on what actually completed and the themes across it, not a list of every issue.
Call out work that carried over and why, if the issues say why.`,
		},
		{
			Name:        "timeline",
			Description: "Build a chronological history of the work around a topic.",
			Arguments: []promptArg{
				{Name: "topic", Description: "The subject to trace", Required: true},
			},
			template: `Build a chronological history of the work around {{topic}} from issue and
project activity.

Where the record has a gap, flag the gap. Do not infer an event that nothing records.`,
		},
		{
			Name:        "implementation_plan",
			Description: "Draft an approach, get approval, then create the issues for it.",
			Arguments: []promptArg{
				{Name: "goal", Description: "What needs building", Required: true},
				{Name: "team", Description: "Team key the work belongs to, e.g. ENG"},
			},
			template: `Draft an approach for: {{goal}}

Show me the plan first and wait for approval. Once approved, create a parent issue{{team_clause}}
with one sub-issue per step.

Delegate work only where I have explicitly asked for it.`,
		},
	}
}

func (s *Server) listPrompts() map[string]any {
	defs := prompts()
	out := make([]promptDef, 0, len(defs))
	for _, d := range defs {
		// A read-only connection cannot carry out the half of these that create issues,
		// and offering an instruction the connection will refuse is worse than not
		// offering it.
		if s.ReadOnly && promptWrites(d.Name) {
			continue
		}
		out = append(out, d)
	}
	return map[string]any{"prompts": out}
}

func promptWrites(name string) bool {
	switch name {
	case "roadmap_planning", "standup_notes", "bug_investigation", "implementation_plan":
		return true
	default:
		return false
	}
}

func (s *Server) getPrompt(raw json.RawMessage) (any, *rpcError) {
	var params struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil || params.Name == "" {
		return nil, &rpcError{Code: -32602, Message: "prompts/get needs name"}
	}
	for _, d := range prompts() {
		if d.Name != params.Name {
			continue
		}
		if s.ReadOnly && promptWrites(d.Name) {
			return nil, &rpcError{Code: -32602, Message: "this connection is read-only"}
		}
		for _, arg := range d.Arguments {
			if arg.Required && strings.TrimSpace(params.Arguments[arg.Name]) == "" {
				return nil, &rpcError{Code: -32602, Message: "missing required argument: " + arg.Name}
			}
		}
		return map[string]any{
			"description": d.Description,
			"messages": []map[string]any{{
				"role":    "user",
				"content": map[string]any{"type": "text", "text": renderPrompt(d, params.Arguments)},
			}},
		}, nil
	}
	return nil, &rpcError{Code: -32602, Message: "unknown prompt: " + params.Name}
}

func renderPrompt(d promptDef, args map[string]string) string {
	text := d.template
	// The team clause reads as a sentence whether or not a team was supplied, which is
	// why it is a phrase rather than a bare substitution.
	clause := ""
	if team := strings.TrimSpace(args["team"]); team != "" {
		clause = " in team " + team
	}
	text = strings.ReplaceAll(text, "{{team_clause}}", clause)
	for _, arg := range d.Arguments {
		text = strings.ReplaceAll(text, "{{"+arg.Name+"}}", strings.TrimSpace(args[arg.Name]))
	}
	return text
}
