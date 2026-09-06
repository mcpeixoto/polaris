package tools_test

import (
	"reflect"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/agent/tools"
)

func TestRegistry_ReadsComeFirstAndTheOrderIsStable(t *testing.T) {
	first := tools.New().All()
	second := tools.New().All()

	if len(first) != len(second) {
		t.Fatalf("two registries had %d and %d tools", len(first), len(second))
	}
	for i := range first {
		if first[i].Name != second[i].Name {
			t.Fatalf("position %d was %q then %q — the order is not stable", i, first[i].Name, second[i].Name)
		}
	}

	sawWrite := false
	for _, tool := range first {
		if !tool.ReadOnly {
			sawWrite = true
			continue
		}
		if sawWrite {
			t.Fatalf("read tool %q came after a write tool", tool.Name)
		}
	}
	if !sawWrite {
		t.Fatal("the registry has no write tools at all")
	}
}

func TestRegistry_ReadsIsTheReadOnlySubsetInTheSameOrder(t *testing.T) {
	r := tools.New()
	reads := r.Reads()

	var want []string
	for _, tool := range r.All() {
		if tool.ReadOnly {
			want = append(want, tool.Name)
		}
	}
	got := make([]string, 0, len(reads))
	for _, tool := range reads {
		if !tool.ReadOnly {
			t.Fatalf("Reads returned %q, which is a write tool", tool.Name)
		}
		got = append(got, tool.Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Reads = %v, want %v", got, want)
	}
}

// The read/write split is what a read-only connection is enforced with, so it is asserted
// by name rather than left to whatever the definitions happen to say.
func TestRegistry_ClassifiesEveryToolCorrectly(t *testing.T) {
	reads := map[string]bool{
		"list_issues": true, "get_issue": true, "list_comments": true,
		"list_teams": true, "list_projects": true, "get_viewer": true,
		"list_users": true, "list_workflow_states": true, "list_labels": true,
		"list_cycles": true, "list_my_issues": true, "get_project": true,
		"list_milestones": true,
	}
	writes := map[string]bool{
		"create_issue": true, "update_issue": true, "assign_issue": true,
		"set_issue_state": true, "set_issue_labels": true, "set_issue_estimate": true,
		"set_issue_due_date": true, "create_sub_issue": true, "link_issues": true,
		"archive_issue": true, "add_issue_to_project": true,
		"create_comment": true, "update_comment": true, "delete_comment": true,
		"add_reaction": true, "create_project": true, "update_project": true,
	}

	seen := map[string]bool{}
	for _, tool := range tools.New().All() {
		if seen[tool.Name] {
			t.Fatalf("%q is registered twice", tool.Name)
		}
		seen[tool.Name] = true

		switch {
		case reads[tool.Name]:
			if !tool.ReadOnly {
				t.Errorf("%q must be read-only", tool.Name)
			}
		case writes[tool.Name]:
			if tool.ReadOnly {
				t.Errorf("%q is a write and must not be marked read-only", tool.Name)
			}
		default:
			t.Errorf("%q is not classified — add it to this test as a read or a write", tool.Name)
		}
	}
	for name := range reads {
		if !seen[name] {
			t.Errorf("read tool %q is missing from the registry", name)
		}
	}
	for name := range writes {
		if !seen[name] {
			t.Errorf("write tool %q is missing from the registry", name)
		}
	}
}

func TestRegistry_EveryToolIsRunnableAndDescribed(t *testing.T) {
	for _, tool := range tools.New().All() {
		if tool.Run == nil {
			t.Errorf("%q has no Run", tool.Name)
		}
		if tool.Description == "" {
			t.Errorf("%q has no description", tool.Name)
		}
		if tool.InputSchema["type"] != "object" {
			t.Errorf("%q input schema is %v, want an object schema", tool.Name, tool.InputSchema["type"])
		}
		if tool.InputSchema["additionalProperties"] != false {
			t.Errorf("%q allows additional properties", tool.Name)
		}
		props, ok := tool.InputSchema["properties"].(map[string]any)
		if !ok {
			t.Fatalf("%q has no properties map", tool.Name)
		}
		for _, req := range required(t, tool.InputSchema) {
			if _, ok := props[req]; !ok {
				t.Errorf("%q requires %q, which it does not declare", tool.Name, req)
			}
		}
	}
}

func TestRegistry_GetKnowsWhatItHasAndWhatItDoesNot(t *testing.T) {
	r := tools.New()
	if _, ok := r.Get("get_issue"); !ok {
		t.Fatal("get_issue is missing")
	}
	if _, ok := r.Get("delete_workspace"); ok {
		t.Fatal("Get invented a tool that does not exist")
	}
}

// The nine tools below shipped to external MCP clients before this package existed. Their
// names and argument shapes are a contract: a client that sends `team` and gets told the
// property is unknown is a client that broke on an upgrade it did not ask for.
func TestRegistry_KeepsTheOriginalMCPSchemas(t *testing.T) {
	want := map[string]map[string]any{
		"get_issue": {
			"type": "object", "additionalProperties": false,
			"required": []string{"id"},
			"properties": map[string]any{
				"id": map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
			},
		},
		"list_comments": {
			"type": "object", "additionalProperties": false,
			"required": []string{"id"},
			"properties": map[string]any{
				"id": map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
			},
		},
		"list_teams": {
			"type": "object", "additionalProperties": false,
			"properties": map[string]any{},
		},
		"list_projects": {
			"type": "object", "additionalProperties": false,
			"properties": map[string]any{},
		},
		"get_viewer": {
			"type": "object", "additionalProperties": false,
			"properties": map[string]any{},
		},
		"create_issue": {
			"type": "object", "additionalProperties": false,
			"required": []string{"title", "team"},
			"properties": map[string]any{
				"title":       map[string]any{"type": "string"},
				"team":        map[string]any{"type": "string", "description": "Team key, name, or UUID"},
				"description": map[string]any{"type": "string"},
				"priority":    map[string]any{"type": "integer", "description": "0 none, 1 urgent, 2 high, 3 medium, 4 low"},
				"assigneeId":  map[string]any{"type": "string"},
			},
		},
		"update_issue": {
			"type": "object", "additionalProperties": false,
			"required": []string{"id"},
			"properties": map[string]any{
				"id":          map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
				"title":       map[string]any{"type": "string"},
				"description": map[string]any{"type": "string"},
				"priority":    map[string]any{"type": "integer"},
			},
		},
		"create_comment": {
			"type": "object", "additionalProperties": false,
			"required": []string{"id", "body"},
			"properties": map[string]any{
				"id":   map[string]any{"type": "string", "description": "Issue UUID or ENG-123 identifier"},
				"body": map[string]any{"type": "string"},
			},
		},
	}

	r := tools.New()
	for name, schema := range want {
		tool, ok := r.Get(name)
		if !ok {
			t.Errorf("%q is missing", name)
			continue
		}
		if !reflect.DeepEqual(tool.InputSchema, schema) {
			t.Errorf("%q schema changed:\n got %#v\nwant %#v", name, tool.InputSchema, schema)
		}
	}

	// list_issues is the one that was deliberately widened, so it is checked by rule
	// rather than by equality: the three original properties survive, unchanged.
	listIssues, _ := r.Get("list_issues")
	props := listIssues.InputSchema["properties"].(map[string]any)
	original := map[string]any{
		"team":  map[string]any{"type": "string", "description": "Team key, name, or UUID"},
		"query": map[string]any{"type": "string", "description": "Search title and description"},
		"limit": map[string]any{"type": "integer", "description": "Max results (default 25, max 100)"},
	}
	for key, schema := range original {
		if !reflect.DeepEqual(props[key], schema) {
			t.Errorf("list_issues.%s changed:\n got %#v\nwant %#v", key, props[key], schema)
		}
	}
	if _, ok := listIssues.InputSchema["required"]; ok {
		t.Error("list_issues gained a required argument; it had none")
	}
}

func required(t *testing.T, schema map[string]any) []string {
	t.Helper()
	raw, ok := schema["required"]
	if !ok {
		return nil
	}
	out, ok := raw.([]string)
	if !ok {
		t.Fatalf("required is %T, want []string", raw)
	}
	return out
}
