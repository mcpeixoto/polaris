// Package mcp is Polaris exposed as a remote MCP server.
//
// Linear's own server is Streamable HTTP at /mcp (read-write) and /mcp/readonly.
// This package is that surface, as an extra route on api rather than a sixth
// container: the tools call domain.Service, so an issue created from Claude Code
// is the same issue the web client would have created — same validation, same
// change log, same notifications.
//
// Auth is the bearer path (API key or OAuth token), reached either by pasting a
// key or by the interactive OAuth 2.1 flow: this package serves the discovery
// documents, /oauth/register does dynamic client registration, and the consent
// screen is the SPA. The whole of that surface answers a browser preflight with
// a non-credentialed wildcard — see isPublicCORSPath in httpapi/cors.go, without
// which a client like Claude cannot register at all.
package mcp

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/agent/tools"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// The newest revision we implement, and the one we answer with when a client does not ask
// for a particular one. 2025-06-18 is what current clients negotiate; 2025-03-26 stays
// supported because the clients pinned to it are exactly the ones least likely to update.
const (
	latestProtocolVersion = "2025-06-18"
	priorProtocolVersion  = "2025-03-26"
)

func supportedProtocol(v string) bool {
	return v == latestProtocolVersion || v == priorProtocolVersion
}

type Server struct {
	Svc       *domain.Service
	PublicURL string
	ReadOnly  bool

	// Tools overrides the shared catalogue. Nil in production, where every server uses the
	// same registry; tests set it to exercise the transport against a known set.
	Tools *tools.Registry
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
	// From 2025-06-18 a client states the negotiated version on every subsequent request.
	// A version we do not implement is refused here rather than half-served: the frames
	// would parse and the semantics would not match.
	if v := strings.TrimSpace(r.Header.Get("MCP-Protocol-Version")); v != "" && !supportedProtocol(v) {
		writeRPC(w, r, rpcResponse{
			JSONRPC: "2.0",
			Error:   &rpcError{Code: -32600, Message: "unsupported MCP-Protocol-Version: " + v},
		})
		return
	}

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
		return s.initialize(req.Params), nil
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
		return s.listPrompts(), nil
	case "prompts/get":
		return s.getPrompt(req.Params)
	default:
		return nil, &rpcError{Code: -32601, Message: "method not found"}
	}
}

// initialize echoes the client's protocol version when we speak it, and otherwise names
// the newest one we do. Answering with our own version unconditionally is what makes an
// older client give up: it has no way to tell "newer than you" from "not MCP".
func (s *Server) initialize(raw json.RawMessage) map[string]any {
	negotiated := latestProtocolVersion
	if len(raw) > 0 {
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		if err := json.Unmarshal(raw, &params); err == nil && supportedProtocol(params.ProtocolVersion) {
			negotiated = params.ProtocolVersion
		}
	}
	return map[string]any{
		"protocolVersion": negotiated,
		"capabilities": map[string]any{
			"tools":     map[string]any{},
			"resources": map[string]any{},
			"prompts":   map[string]any{},
		},
		"serverInfo":   s.serverInfo(),
		"instructions": "Polaris issue tracker. Use list_issues / get_issue to read, create_issue and update_issue to write. Identifiers like ENG-123 work anywhere an id is accepted, and a team, state, label or person can be named instead of given as a UUID.",
	}
}

// serverInfo is the Implementation object a client shows in its connector UI.
//
// name/version/title are the 2025-06-18 fields. description, websiteUrl and icons arrive
// with 2025-11-25; they are sent unconditionally because a client that predates them
// ignores members it does not know, and the alternative — withholding an icon until the
// negotiated revision is new enough — leaves every current client showing its own generic
// placeholder, which is what Polaris looked like before this.
//
// The icons are the marks the web client already serves from the same origin, so there is
// one set of artwork rather than a second that drifts. They are absolute by requirement:
// the client fetching them is not the browser that loaded the site and has no base URL to
// resolve against.
func (s *Server) serverInfo() map[string]any {
	base := strings.TrimRight(s.PublicURL, "/")
	return map[string]any{
		"name":        "polaris",
		"version":     "1",
		"title":       "Polaris",
		"description": "Issues, cycles, projects and documents in a Polaris workspace.",
		"websiteUrl":  base,
		"icons": []map[string]any{
			{"src": base + "/icon.svg", "mimeType": "image/svg+xml", "sizes": []string{"any"}},
			{"src": base + "/icon-512.png", "mimeType": "image/png", "sizes": []string{"512x512"}},
			{"src": base + "/icon-192.png", "mimeType": "image/png", "sizes": []string{"192x192"}},
		},
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
			"resource": base + "/mcp",
			// RFC 9728's human-readable name. Some clients label the consent step with it
			// rather than with the host, and "polaris.peixotolabs.com" is a worse label
			// than "Polaris" for the person deciding whether to approve.
			"resource_name":            "Polaris",
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
			"issuer":                           base,
			"authorization_endpoint":           base + "/oauth/authorize",
			"token_endpoint":                   base + "/oauth/token",
			"revocation_endpoint":              base + "/oauth/revoke",
			"registration_endpoint":            base + "/oauth/register",
			"response_types_supported":         []string{"code"},
			"grant_types_supported":            []string{"authorization_code", "refresh_token"},
			"code_challenge_methods_supported": []string{"S256", "plain"},
			// none first: it is what dynamic registration issues, and a client that takes
			// the head of this list should land on the method it will actually be given.
			// The secret-based two stay because they are true of the token endpoint —
			// hand-registered confidential applications do authenticate with a secret.
			"token_endpoint_auth_methods_supported": []string{"none", "client_secret_post", "client_secret_basic"},
			"scopes_supported":                      []string{"read", "write"},
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
