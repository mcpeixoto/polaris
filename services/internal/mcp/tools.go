package mcp

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/agent/tools"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// The MCP half of the tool surface: JSON-RPC in, JSON-RPC out. What the tools actually do
// lives in internal/agent/tools, because the catalogue is not a property of this
// transport — the in-app agent calls the same verbs without going near an HTTP handler.

type toolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	// Annotations is the 2025-03-26 tool-annotation object. Emitted for every tool
	// in every mode: a client that only speaks an older revision ignores members it
	// does not know, and one that speaks this revision uses the hints to decide
	// whether to ask before calling.
	Annotations *toolAnnotations `json:"annotations,omitempty"`
}

// toolAnnotations is the subset of the MCP tool annotation object this server fills in.
// readOnlyHint and destructiveHint are always sent, including when false: an omitted
// hint and an explicit false are different claims, and we know which one is true.
type toolAnnotations struct {
	ReadOnlyHint    bool `json:"readOnlyHint"`
	DestructiveHint bool `json:"destructiveHint"`
}

func (s *Server) registry() *tools.Registry {
	if s.Tools != nil {
		return s.Tools
	}
	return defaultRegistry
}

var defaultRegistry = tools.New()

func (s *Server) tools() []toolDef {
	if s.Catalog {
		return s.catalogTools()
	}
	available := s.registry().All()
	if s.ReadOnly {
		available = s.registry().Reads()
	}
	out := make([]toolDef, 0, len(available))
	for _, t := range available {
		out = append(out, toolDefFrom(t))
	}
	return out
}

func toolDefFrom(t tools.Tool) toolDef {
	return toolDef{
		Name:        t.Name,
		Description: t.Description,
		InputSchema: t.InputSchema,
		Annotations: &toolAnnotations{
			ReadOnlyHint:    t.ReadOnly,
			DestructiveHint: t.Destructive,
		},
	}
}

// toolTier is how catalog mode groups a verb. Destructive wins over read-only: a tool
// that both archived and claimed to be read-only would be the dangerous one, and the
// execute_read door is the one that must stay shut.
func toolTier(t tools.Tool) string {
	switch {
	case t.Destructive:
		return "destructive"
	case t.ReadOnly:
		return "read"
	default:
		return "write"
	}
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

	// Catalog's own verbs are not in the registry. Everything else, including a name
	// that tools/list did not advertise, falls through to the registry: a client may
	// have cached it, and refusing a name we can run would punish that cache.
	if s.Catalog {
		switch params.Name {
		case "discover_tools":
			return s.discoverTools(args)
		case "execute_read", "execute_write", "execute_destructive":
			return s.executeCatalog(r, p, params.Name, args)
		}
	}

	tool, ok := s.registry().Get(params.Name)
	if !ok {
		return toolError("unknown tool " + params.Name), nil
	}
	return s.runTool(r, p, tool, args)
}

// runTool is the gate every write goes through, whichever door the caller used.
// Catalog mode calls it too, so execute_write cannot outrank a read-only connection
// or a token that was only granted read.
func (s *Server) runTool(r *http.Request, p *authz.Principal, tool tools.Tool, args map[string]any) (any, *rpcError) {
	// Asked of the tool rather than of a list kept here. The list was the bug waiting to
	// happen: it named three writes, and every write added after it was written would have
	// passed this gate on a read-only connection.
	if !tool.ReadOnly {
		if s.ReadOnly || !p.HasScope(domain.APIKeyScopeWrite) {
			return toolError("this connection is read-only"), nil
		}
	}

	out, err := tool.Run(r.Context(), s.Svc, p, args)
	if err != nil {
		return toolError(err.Error()), nil
	}
	return toolText(out), nil
}

func stringArg(args map[string]any, key string) string {
	v, _ := args[key].(string)
	return strings.TrimSpace(v)
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
