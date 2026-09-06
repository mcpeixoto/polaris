package mcp

import (
	"encoding/json"
	"net/http"

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
}

func (s *Server) registry() *tools.Registry {
	if s.Tools != nil {
		return s.Tools
	}
	return defaultRegistry
}

var defaultRegistry = tools.New()

func (s *Server) tools() []toolDef {
	available := s.registry().All()
	if s.ReadOnly {
		available = s.registry().Reads()
	}
	out := make([]toolDef, 0, len(available))
	for _, t := range available {
		out = append(out, toolDef{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema})
	}
	return out
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

	tool, ok := s.registry().Get(params.Name)
	if !ok {
		return toolError("unknown tool " + params.Name), nil
	}

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
