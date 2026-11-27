package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/agent/tools"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The thirteen names tools/list promises in catalog mode, in the order it promises them.
var catalogListNames = []string{
	"get_viewer",
	"list_teams",
	"list_issues",
	"list_my_issues",
	"get_issue",
	"create_issue",
	"update_issue",
	"set_issue_state",
	"create_comment",
	"discover_tools",
	"execute_read",
	"execute_write",
	"execute_destructive",
}

func listedTools(t *testing.T, s *Server) []map[string]any {
	t.Helper()
	out := rpc(t, s, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if _, bad := out["error"]; bad {
		t.Fatalf("tools/list: %v", out["error"])
	}
	result, _ := out["result"].(map[string]any)
	raw, _ := result["tools"].([]any)
	tools := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		tool, _ := item.(map[string]any)
		tools = append(tools, tool)
	}
	return tools
}

func callCatalog(t *testing.T, s *Server, p *authz.Principal, name string, args map[string]any) (any, *rpcError) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"name": name, "arguments": args})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/mcp/catalog", strings.NewReader(""))
	if p != nil {
		req = req.WithContext(authz.WithPrincipal(req.Context(), p))
	}
	return s.callTool(req, p, body)
}

func resultText(t *testing.T, out any) (string, bool) {
	t.Helper()
	result, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("tool result is %T, want an object", out)
	}
	isErr, _ := result["isError"].(bool)
	content, ok := result["content"].([]map[string]any)
	if !ok || len(content) != 1 {
		t.Fatalf("content: %#v", result["content"])
	}
	text, _ := content[0]["text"].(string)
	return text, isErr
}

func TestCatalog_ListsThirteenToolsAndAnnotatesEachOne(t *testing.T) {
	listed := listedTools(t, &Server{Catalog: true})
	if len(listed) != len(catalogListNames) {
		t.Fatalf("listed %d tools, want %d", len(listed), len(catalogListNames))
	}
	for i, tool := range listed {
		name, _ := tool["name"].(string)
		if name != catalogListNames[i] {
			t.Errorf("tool %d is %q, want %q", i, name, catalogListNames[i])
		}
		ann, ok := tool["annotations"].(map[string]any)
		if !ok {
			t.Errorf("%s has no annotations", name)
			continue
		}
		if _, ok := ann["readOnlyHint"].(bool); !ok {
			t.Errorf("%s annotations.readOnlyHint = %v, want a bool", name, ann["readOnlyHint"])
		}
		if _, ok := ann["destructiveHint"].(bool); !ok {
			t.Errorf("%s annotations.destructiveHint = %v, want a bool", name, ann["destructiveHint"])
		}
	}

	byName := map[string]map[string]any{}
	for _, tool := range listed {
		name, _ := tool["name"].(string)
		byName[name] = tool["annotations"].(map[string]any)
	}
	if byName["execute_read"]["readOnlyHint"] != true || byName["execute_read"]["destructiveHint"] != false {
		t.Errorf("execute_read annotations = %v, want read-only and not destructive", byName["execute_read"])
	}
	if byName["execute_destructive"]["destructiveHint"] != true || byName["execute_destructive"]["readOnlyHint"] != false {
		t.Errorf("execute_destructive annotations = %v, want destructive and not read-only", byName["execute_destructive"])
	}
	if byName["discover_tools"]["readOnlyHint"] != true {
		t.Errorf("discover_tools annotations = %v, want read-only", byName["discover_tools"])
	}
	if byName["list_teams"]["readOnlyHint"] != true || byName["create_issue"]["readOnlyHint"] != false {
		t.Errorf("primary hints drifted: list_teams %v, create_issue %v", byName["list_teams"], byName["create_issue"])
	}
}

func TestToolsList_AnnotationsMarkArchiveIssueDestructive(t *testing.T) {
	listed := listedTools(t, &Server{})
	var archive, create map[string]any
	for _, tool := range listed {
		ann, ok := tool["annotations"].(map[string]any)
		if !ok {
			t.Fatalf("%v was listed without annotations", tool["name"])
		}
		if _, ok := ann["readOnlyHint"].(bool); !ok {
			t.Errorf("%v readOnlyHint = %v, want a bool", tool["name"], ann["readOnlyHint"])
		}
		if _, ok := ann["destructiveHint"].(bool); !ok {
			t.Errorf("%v destructiveHint = %v, want a bool", tool["name"], ann["destructiveHint"])
		}
		switch tool["name"] {
		case "archive_issue":
			archive = ann
		case "create_issue":
			create = ann
		}
	}
	if archive["destructiveHint"] != true || archive["readOnlyHint"] != false {
		t.Fatalf("archive_issue annotations = %v, want destructiveHint true", archive)
	}
	if create["destructiveHint"] != false {
		t.Fatalf("create_issue annotations = %v, want destructiveHint false", create)
	}
}

func TestCatalog_DiscoverToolsReturnsEveryRegistryToolAndFiltersByQuery(t *testing.T) {
	s := &Server{Catalog: true}
	p := &authz.Principal{Scopes: []string{domain.APIKeyScopeWrite}}

	out, rpcErr := callCatalog(t, s, p, "discover_tools", map[string]any{})
	if rpcErr != nil {
		t.Fatalf("rpc error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if isErr {
		t.Fatalf("discover_tools: %s", text)
	}
	var rows []struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		InputSchema map[string]any `json:"inputSchema"`
		Tier        string         `json:"tier"`
	}
	if err := json.Unmarshal([]byte(text), &rows); err != nil {
		t.Fatalf("decode %s: %v", text, err)
	}

	reg := tools.New()
	all := reg.All()
	if len(rows) != len(all) {
		t.Fatalf("discover_tools returned %d tools, registry has %d", len(rows), len(all))
	}
	for i, row := range rows {
		tool := all[i]
		if row.Name != tool.Name {
			t.Errorf("row %d is %q, registry has %q", i, row.Name, tool.Name)
		}
		if row.Description != tool.Description {
			t.Errorf("%s description drifted", row.Name)
		}
		if row.InputSchema == nil {
			t.Errorf("%s has no inputSchema", row.Name)
		}
		want := "write"
		switch {
		case tool.Destructive:
			want = "destructive"
		case tool.ReadOnly:
			want = "read"
		}
		if row.Tier != want {
			t.Errorf("%s tier %q, want %q", row.Name, row.Tier, want)
		}
	}

	filtered, rpcErr := callCatalog(t, s, p, "discover_tools", map[string]any{"query": "ArChIvE"})
	if rpcErr != nil {
		t.Fatalf("rpc error: %v", rpcErr)
	}
	text, isErr = resultText(t, filtered)
	if isErr {
		t.Fatalf("filtered discover_tools: %s", text)
	}
	var matches []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal([]byte(text), &matches); err != nil {
		t.Fatalf("decode %s: %v", text, err)
	}
	if len(matches) == 0 || len(matches) >= len(all) {
		t.Fatalf("query ArChIvE matched %d tools, want a non-empty subset of %d", len(matches), len(all))
	}
	sawArchive := false
	for _, row := range matches {
		haystack := strings.ToLower(row.Name + " " + row.Description)
		if !strings.Contains(haystack, "archive") {
			t.Errorf("query ArChIvE returned %q, which does not match", row.Name)
		}
		if row.Name == "archive_issue" {
			sawArchive = true
		}
	}
	if !sawArchive {
		t.Fatal("query ArChIvE did not return archive_issue")
	}
}

func TestCatalog_ExecuteReadRunsListTeams(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	s := &Server{Svc: domain.NewService(db), Catalog: true}

	out, rpcErr := callCatalog(t, s, f.Principal(), "execute_read", map[string]any{
		"tool":      "list_teams",
		"arguments": map[string]any{},
	})
	if rpcErr != nil {
		t.Fatalf("rpc error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if isErr {
		t.Fatalf("execute_read list_teams: %s", text)
	}
	if !strings.Contains(text, `"key": "ENG"`) {
		t.Fatalf("list_teams result did not include the fixture team: %s", text)
	}
}

func TestCatalog_ExecuteReadRefusesCreateIssueForTierMismatch(t *testing.T) {
	s := &Server{Catalog: true}
	p := &authz.Principal{Scopes: []string{domain.APIKeyScopeWrite}}

	out, rpcErr := callCatalog(t, s, p, "execute_read", map[string]any{
		"tool":      "create_issue",
		"arguments": map[string]any{"title": "nope", "team": "ENG"},
	})
	if rpcErr != nil {
		t.Fatalf("a tier mismatch came back as a protocol error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if !isErr {
		t.Fatalf("execute_read ran create_issue: %s", text)
	}
	if !strings.Contains(text, "not a read tool") {
		t.Fatalf("refusal %q should say the tier does not match", text)
	}
}

func TestCatalog_ExecuteDestructiveArchivesWithWriteScope(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	s := &Server{Svc: svc, Catalog: true}

	writer := f.Principal()
	writer.Scopes = []string{domain.APIKeyScopeWrite}

	tool, ok := tools.New().Get("create_issue")
	if !ok {
		t.Fatal("create_issue missing from the registry")
	}
	raw, runErr := tool.Run(context.Background(), svc, writer, map[string]any{
		"title": "Archive me",
		"team":  "ENG",
	})
	if runErr != nil {
		t.Fatalf("create_issue: %v", runErr)
	}
	issue, _ := raw.(map[string]any)
	id, _ := issue["identifier"].(string)
	if id == "" {
		t.Fatalf("create_issue returned no identifier: %#v", raw)
	}

	out, rpcErr := callCatalog(t, s, writer, "execute_destructive", map[string]any{
		"tool":      "archive_issue",
		"arguments": map[string]any{"id": id},
	})
	if rpcErr != nil {
		t.Fatalf("rpc error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if isErr {
		t.Fatalf("execute_destructive archive_issue: %s", text)
	}
	if !strings.Contains(text, `"archived": true`) || !strings.Contains(text, id) {
		t.Fatalf("archive result: %s", text)
	}
}

// Catalog mode shares the read-only server flag with /mcp. execute_destructive is
// not a way around a connection that was opened read-only.
func TestCatalog_ReadOnlyServerRefusesExecuteDestructive(t *testing.T) {
	s := &Server{Catalog: true, ReadOnly: true}
	writer := &authz.Principal{Scopes: []string{domain.APIKeyScopeWrite}}

	out, rpcErr := callCatalog(t, s, writer, "execute_destructive", map[string]any{
		"tool":      "archive_issue",
		"arguments": map[string]any{"id": "ENG-1"},
	})
	if rpcErr != nil {
		t.Fatalf("a read-only refusal came back as a protocol error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if !isErr || !strings.Contains(text, "read-only") {
		t.Fatalf("read-only catalog execute_destructive: isError=%v text=%q", isErr, text)
	}
}

func TestCatalog_ExecuteDestructiveRefusesAReadScopedPrincipal(t *testing.T) {
	s := &Server{Catalog: true}
	reader := &authz.Principal{Scopes: []string{"read"}}

	out, rpcErr := callCatalog(t, s, reader, "execute_destructive", map[string]any{
		"tool":      "archive_issue",
		"arguments": map[string]any{"id": "ENG-1"},
	})
	if rpcErr != nil {
		t.Fatalf("a scope refusal came back as a protocol error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if !isErr || !strings.Contains(text, "read-only") {
		t.Fatalf("read-scoped execute_destructive: isError=%v text=%q", isErr, text)
	}
}

// A client that learned list_projects from an earlier tools/list still calls it by
// name. Catalog mode must run it, through the same gate, rather than pretending the
// verb does not exist because it was left off the short list.
func TestCatalog_ACachedNonPrimaryNameStillRuns(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	s := &Server{Svc: domain.NewService(db), Catalog: true}

	out, rpcErr := callCatalog(t, s, f.Principal(), "list_projects", map[string]any{})
	if rpcErr != nil {
		t.Fatalf("rpc error: %v", rpcErr)
	}
	text, isErr := resultText(t, out)
	if isErr {
		t.Fatalf("list_projects on a catalog server: %s", text)
	}
}
