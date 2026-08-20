// Package mcp is Polaris exposed as a remote MCP server.
//
// Linear's own server is Streamable HTTP at /mcp (read-write) and /mcp/readonly.
// This package is that surface, as an extra route on api rather than a sixth
// container: the tools call domain.Service, so an issue created from Claude Code
// is the same issue the web client would have created — same validation, same
// change log, same notifications.
//
// Auth is the existing bearer path (API key or OAuth token). Interactive OAuth
// 2.1 DCR is deferred: the settings page documents the API-key hop, which is
// how Jules and any client that can set a header already connect to Linear.
package mcp

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

const protocolVersion = "2025-03-26"

type Server struct {
	Svc       *domain.Service
	PublicURL string
	ReadOnly  bool
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.handlePOST(w, r)
	case http.MethodGet:
		// Streamable HTTP's GET is the optional SSE stream of server-initiated
		// messages. v1 has none, so an empty stream that closes is honest rather
		// than a 405 that some clients treat as "this is not MCP".
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
	case http.MethodDelete:
		w.WriteHeader(http.StatusNoContent)
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE, OPTIONS")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handlePOST(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeRPC(w, r, rpcResponse{
			JSONRPC: "2.0",
			Error:   &rpcError{Code: -32700, Message: "parse error"},
		})
		return
	}

	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		writeRPC(w, r, rpcResponse{
			JSONRPC: "2.0",
			Error:   &rpcError{Code: -32600, Message: "batched requests are not supported"},
		})
		return
	}

	var req rpcRequest
	if err := json.Unmarshal(body, &req); err != nil || req.JSONRPC != "2.0" || req.Method == "" {
		writeRPC(w, r, rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &rpcError{Code: -32600, Message: "invalid request"},
		})
		return
	}

	// Notifications have no id and get no response.
	if len(req.ID) == 0 || string(req.ID) == "null" {
		return
	}

	p, _ := authz.PrincipalFrom(r.Context())
	result, rpcErr := s.dispatch(r, p, req)
	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	writeRPC(w, r, resp)
}

func (s *Server) dispatch(r *http.Request, p *authz.Principal, req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		return s.initialize(), nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": s.tools()}, nil
	case "tools/call":
		if p == nil {
			return nil, &rpcError{Code: -32001, Message: "authentication required"}
		}
		return s.callTool(r, p, req.Params)
	case "resources/list":
		return map[string]any{"resources": []any{}}, nil
	case "prompts/list":
		return map[string]any{"prompts": []any{}}, nil
	default:
		return nil, &rpcError{Code: -32601, Message: "method not found"}
	}
}

func (s *Server) initialize() map[string]any {
	return map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities": map[string]any{
			"tools":     map[string]any{},
			"resources": map[string]any{},
			"prompts":   map[string]any{},
		},
		"serverInfo": map[string]any{
			"name":    "polaris",
			"version": "1",
			"title":   "Polaris",
		},
		"instructions": "Polaris issue tracker. Use list_issue / get_issue to read, create_issue and update_issue to write. Identifiers like ENG-123 work anywhere an id is accepted.",
	}
}

func writeRPC(w http.ResponseWriter, r *http.Request, resp rpcResponse) {
	payload, err := json.Marshal(resp)
	if err != nil {
		http.Error(w, "encode failed", http.StatusInternalServerError)
		return
	}
	accept := r.Header.Get("Accept")
	if strings.Contains(accept, "text/event-stream") && !strings.Contains(accept, "application/json") {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write([]byte("event: message\ndata: "))
		_, _ = w.Write(payload)
		_, _ = w.Write([]byte("\n\n"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(payload)
}

// Unauthorized writes the MCP OAuth challenge. Clients that support interactive
// login fetch the resource metadata URL; clients that pass a bearer token never
// see this.
func Unauthorized(w http.ResponseWriter, publicURL string) {
	resource := strings.TrimRight(publicURL, "/") + "/.well-known/oauth-protected-resource"
	w.Header().Set("WWW-Authenticate", `Bearer realm="Polaris", resource_metadata="`+resource+`"`)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":             "invalid_token",
		"error_description": "provide an API key or OAuth access token as Authorization: Bearer …",
	})
}

// WellKnownProtectedResource is GET /.well-known/oauth-protected-resource.
func WellKnownProtectedResource(publicURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		base := strings.TrimRight(publicURL, "/")
		writeJSON(w, http.StatusOK, map[string]any{
			"resource":                 base + "/mcp",
			"authorization_servers":    []string{base},
			"bearer_methods_supported": []string{"header"},
			"scopes_supported":         []string{"read", "write"},
		})
	}
}

// WellKnownAuthorizationServer is GET /.well-known/oauth-authorization-server.
func WellKnownAuthorizationServer(publicURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		base := strings.TrimRight(publicURL, "/")
		writeJSON(w, http.StatusOK, map[string]any{
			"issuer":                                base,
			"authorization_endpoint":                base + "/oauth/authorize",
			"token_endpoint":                        base + "/oauth/token",
			"revocation_endpoint":                   base + "/oauth/revoke",
			"response_types_supported":              []string{"code"},
			"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
			"code_challenge_methods_supported":      []string{"S256", "plain"},
			"token_endpoint_auth_methods_supported": []string{"client_secret_post", "client_secret_basic", "none"},
			"scopes_supported":                      []string{"read", "write"},
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
