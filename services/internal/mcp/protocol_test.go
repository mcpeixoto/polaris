package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Version negotiation is the first thing a client does and the cheapest thing to get
// wrong: answer with our own version unconditionally and a client pinned to an older
// revision cannot tell "newer than you" from "not an MCP server".

func rpc(t *testing.T, s *Server, header, body string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	if header != "" {
		req.Header.Set("MCP-Protocol-Version", header)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return out
}

func TestInitialize_NegotiatesTheClientsProtocolVersion(t *testing.T) {
	s := &Server{}

	cases := []struct {
		requested string
		want      string
	}{
		{latestProtocolVersion, latestProtocolVersion},
		{priorProtocolVersion, priorProtocolVersion},
		// Unknown: answer with the newest we speak, which is what lets a client decide
		// whether it can carry on.
		{"2099-01-01", latestProtocolVersion},
		{"", latestProtocolVersion},
	}
	for _, tc := range cases {
		t.Run("requested="+tc.requested, func(t *testing.T) {
			body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"` +
				tc.requested + `"}}`
			out := rpc(t, s, "", body)
			result, ok := out["result"].(map[string]any)
			if !ok {
				t.Fatalf("no result: %v", out)
			}
			if got := result["protocolVersion"]; got != tc.want {
				t.Errorf("protocolVersion %v, want %v", got, tc.want)
			}
		})
	}
}

func TestPost_RefusesAnUnsupportedProtocolHeader(t *testing.T) {
	out := rpc(t, &Server{}, "1999-01-01", `{"jsonrpc":"2.0","id":1,"method":"ping"}`)

	rpcErr, ok := out["error"].(map[string]any)
	if !ok {
		t.Fatalf("a request stating an unsupported protocol version was served: %v", out)
	}
	if msg, _ := rpcErr["message"].(string); !strings.Contains(msg, "1999-01-01") {
		t.Errorf("message %q should name the version it refused", msg)
	}
}

func TestPost_AcceptsASupportedProtocolHeader(t *testing.T) {
	out := rpc(t, &Server{}, latestProtocolVersion, `{"jsonrpc":"2.0","id":1,"method":"ping"}`)

	if _, bad := out["error"]; bad {
		t.Fatalf("a request stating a supported protocol version was refused: %v", out)
	}
}

// A read-only connection must not even describe the write tools: a client that lists them
// will call them, and the refusal arrives after the model has already planned around it.
func TestToolsList_ReadOnlyHidesWriteTools(t *testing.T) {
	out := rpc(t, &Server{ReadOnly: true}, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)

	result, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result: %v", out)
	}
	listed, _ := result["tools"].([]any)
	if len(listed) == 0 {
		t.Fatal("a read-only connection listed no tools at all")
	}
	for _, raw := range listed {
		tool, _ := raw.(map[string]any)
		name, _ := tool["name"].(string)
		if strings.HasPrefix(name, "create_") || strings.HasPrefix(name, "update_") {
			t.Errorf("read-only connection listed the write tool %q", name)
		}
	}
}

func TestPrompts_ListedAndRenderedWithArguments(t *testing.T) {
	out := rpc(t, &Server{}, "", `{"jsonrpc":"2.0","id":1,"method":"prompts/list"}`)
	result, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result: %v", out)
	}
	listed, _ := result["prompts"].([]any)
	if len(listed) != 6 {
		t.Fatalf("listed %d prompts, want the 6 documented workflows", len(listed))
	}

	got := rpc(t, &Server{}, "",
		`{"jsonrpc":"2.0","id":2,"method":"prompts/get","params":{"name":"cycle_summary","arguments":{"team":"ENG"}}}`)
	res, ok := got["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result: %v", got)
	}
	messages, _ := res["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("got %d messages, want 1", len(messages))
	}
	msg, _ := messages[0].(map[string]any)
	content, _ := msg["content"].(map[string]any)
	text, _ := content["text"].(string)
	if !strings.Contains(text, "ENG") {
		t.Errorf("rendered prompt did not substitute the team: %q", text)
	}
	if strings.Contains(text, "{{") {
		t.Errorf("rendered prompt still contains a placeholder: %q", text)
	}
}

func TestPrompts_MissingRequiredArgumentIsRefused(t *testing.T) {
	out := rpc(t, &Server{}, "",
		`{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"cycle_summary","arguments":{}}}`)

	if _, bad := out["error"]; !bad {
		t.Fatalf("a prompt missing its required argument was rendered anyway: %v", out)
	}
}

// Offering an instruction that ends in "this connection is read-only" wastes a turn and
// teaches the model the server is unreliable.
func TestPrompts_ReadOnlyHidesTheOnesThatWrite(t *testing.T) {
	out := rpc(t, &Server{ReadOnly: true}, "", `{"jsonrpc":"2.0","id":1,"method":"prompts/list"}`)
	result, _ := out["result"].(map[string]any)
	listed, _ := result["prompts"].([]any)

	for _, raw := range listed {
		p, _ := raw.(map[string]any)
		if name, _ := p["name"].(string); name == "roadmap_planning" || name == "standup_notes" {
			t.Errorf("read-only connection listed the writing prompt %q", name)
		}
	}
	if len(listed) == 0 {
		t.Fatal("a read-only connection listed no prompts at all")
	}
}

// The read-only gate used to be a list of three tool names kept in this package. Every
// write added after it was written — fourteen of them — would have sailed through a
// read-only connection. It asks the tool now, and this is the test that says so.
func TestToolsCall_ReadOnlyRefusesEveryWriteTool(t *testing.T) {
	s := &Server{ReadOnly: true}
	p := &authz.Principal{Scopes: []string{domain.APIKeyScopeWrite}}

	for _, tool := range s.registry().All() {
		if tool.ReadOnly {
			continue
		}
		t.Run(tool.Name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/mcp/readonly", strings.NewReader(""))
			req = req.WithContext(authz.WithPrincipal(req.Context(), p))

			raw, _ := json.Marshal(map[string]any{"name": tool.Name, "arguments": map[string]any{}})
			out, rpcErr := s.callTool(req, p, raw)
			if rpcErr != nil {
				t.Fatalf("unexpected rpc error: %v", rpcErr)
			}
			result, _ := out.(map[string]any)
			if result["isError"] != true {
				t.Fatalf("read-only connection ran the write tool %q", tool.Name)
			}
		})
	}
}

// The same gate, the other way round: a token without the write scope cannot write even on
// the read-write endpoint.
func TestToolsCall_AReadScopedTokenCannotWrite(t *testing.T) {
	s := &Server{}
	p := &authz.Principal{Scopes: []string{"read"}}

	raw, _ := json.Marshal(map[string]any{"name": "create_issue", "arguments": map[string]any{}})
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(""))
	out, rpcErr := s.callTool(req, p, raw)
	if rpcErr != nil {
		t.Fatalf("unexpected rpc error: %v", rpcErr)
	}
	if result, _ := out.(map[string]any); result["isError"] != true {
		t.Fatal("a read-scoped token was allowed to call create_issue")
	}
}
