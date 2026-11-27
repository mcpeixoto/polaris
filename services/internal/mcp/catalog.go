package mcp

import (
	"net/http"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/authz"
)

// catalogPrimary is the everyday set tools/list names in catalog mode, in the order
// a person would reach for them: who am I, what teams exist, then the issue verbs.
// The rest of the registry stays callable — by the name a client already knows, or
// through discover_tools and execute_* — but it does not ride along in the prompt.
var catalogPrimary = []string{
	"get_viewer",
	"list_teams",
	"list_issues",
	"list_my_issues",
	"get_issue",
	"create_issue",
	"update_issue",
	"set_issue_state",
	"create_comment",
}

// executeTier is which registry tier each execute_* verb is willing to run. The
// check is the point of having three of them: a model that only has execute_read
// in front of it cannot archive an issue by naming it.
var executeTier = map[string]string{
	"execute_read":        "read",
	"execute_write":       "write",
	"execute_destructive": "destructive",
}

func (s *Server) catalogTools() []toolDef {
	reg := s.registry()
	out := make([]toolDef, 0, len(catalogPrimary)+4)
	for _, name := range catalogPrimary {
		t, ok := reg.Get(name)
		if !ok {
			// A stand-in registry in a test may not define the verb. Advertising a
			// name that tools/call would then call unknown is a worse list than a
			// shorter one.
			continue
		}
		out = append(out, toolDefFrom(t))
	}
	out = append(out,
		toolDef{
			Name: "discover_tools",
			// COPY: tool description shown to MCP clients on /mcp/catalog.
			Description: "List every tool this server can run. Pass query to keep only tools whose name or description matches.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{
						"type": "string",
						// COPY: schema description shown to MCP clients.
						"description": "Case-insensitive match against the tool name and description. Omit it to list every tool.",
					},
				},
				"additionalProperties": false,
			},
			Annotations: &toolAnnotations{ReadOnlyHint: true},
		},
		toolDef{
			Name: "execute_read",
			// COPY: tool description shown to MCP clients on /mcp/catalog.
			Description: "Run a read tool by name. The named tool must be a read tool.",
			InputSchema: executeInputSchema(),
			Annotations: &toolAnnotations{ReadOnlyHint: true},
		},
		toolDef{
			Name: "execute_write",
			// COPY: tool description shown to MCP clients on /mcp/catalog.
			Description: "Run a write tool by name. The named tool must be a write that does not archive or delete, and this connection must be allowed to write.",
			InputSchema: executeInputSchema(),
			Annotations: &toolAnnotations{},
		},
		toolDef{
			Name: "execute_destructive",
			// COPY: tool description shown to MCP clients on /mcp/catalog.
			Description: "Run a destructive tool by name. The named tool must be one that archives or deletes, and this connection must be allowed to write.",
			InputSchema: executeInputSchema(),
			Annotations: &toolAnnotations{DestructiveHint: true},
		},
	)
	return out
}

func executeInputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tool": map[string]any{
				"type": "string",
				// COPY: schema description shown to MCP clients.
				"description": "Name of the registry tool to run",
			},
			"arguments": map[string]any{
				"type": "object",
				// COPY: schema description shown to MCP clients.
				"description": "Arguments for that tool",
			},
		},
		"required":             []string{"tool", "arguments"},
		"additionalProperties": false,
	}
}

func (s *Server) discoverTools(args map[string]any) (any, *rpcError) {
	query := ""
	if v, ok := args["query"]; ok && v != nil {
		text, ok := v.(string)
		if !ok {
			// COPY: shown when discover_tools is given a query that is not a string.
			return toolError("query must be a string"), nil
		}
		query = strings.ToLower(strings.TrimSpace(text))
	}

	var rows []map[string]any
	for _, t := range s.registry().All() {
		if query != "" &&
			!strings.Contains(strings.ToLower(t.Name), query) &&
			!strings.Contains(strings.ToLower(t.Description), query) {
			continue
		}
		rows = append(rows, map[string]any{
			"name":        t.Name,
			"description": t.Description,
			"inputSchema": t.InputSchema,
			"tier":        toolTier(t),
		})
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return toolText(rows), nil
}

func (s *Server) executeCatalog(r *http.Request, p *authz.Principal, via string, args map[string]any) (any, *rpcError) {
	name := stringArg(args, "tool")
	if name == "" {
		// COPY: shown when execute_* is called without naming a tool.
		return toolError(via + " needs a tool name"), nil
	}
	inner, ok := objectArg(args, "arguments")
	if !ok {
		// Same sentence callTool uses when the outer arguments are not an object.
		return toolError("arguments must be an object"), nil
	}

	tool, found := s.registry().Get(name)
	if !found {
		return toolError("unknown tool " + name), nil
	}
	want := executeTier[via]
	if got := toolTier(tool); got != want {
		// COPY: shown when execute_* is aimed at a tool of a different tier.
		return toolError(name + " is a " + got + " tool, not a " + want + " tool"), nil
	}
	// The tier matched. The write gate is still runTool's, unchanged.
	return s.runTool(r, p, tool, inner)
}

// objectArg reads a nested object. A missing key is an empty object, which is what
// a read tool with no parameters needs; an explicit non-object is a refusal.
func objectArg(args map[string]any, key string) (map[string]any, bool) {
	v, ok := args[key]
	if !ok || v == nil {
		return map[string]any{}, true
	}
	m, ok := v.(map[string]any)
	return m, ok
}
