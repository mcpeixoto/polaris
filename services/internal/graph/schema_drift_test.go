package graph

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

// The model structs and the GraphQL types are two descriptions of the same entity, and
// this test is what stops them becoming two different entities.
//
// model.* is written into change_log.payload, streamed at bootstrap and stored by the
// client. If a field exists there and not on the GraphQL type, the sync stream carries
// something the API cannot return: the client renders a value no query can fetch, the SDK
// and every integration are blind to it, and the first anybody hears of it is a support
// question about a field the product plainly has.
//
// The check is one-directional on purpose. The GraphQL type legitimately has more — the
// nested relations (state, team, comments) are resolved rather than stored, and storing
// them would mean writing an issue's whole team into every change row.
func TestSchemaDrift_EveryModelFieldExistsOnItsGraphQLType(t *testing.T) {
	pairs := []struct {
		name  string
		model any
		wire  any
	}{
		{"Issue", model.Issue{}, generated.Issue{}},
		{"Team", model.Team{}, generated.Team{}},
		{"User", model.User{}, generated.User{}},
		{"WorkflowState", model.WorkflowState{}, generated.WorkflowState{}},
		{"Comment", model.Comment{}, generated.Comment{}},
		{"Workspace", model.Workspace{}, generated.Workspace{}},
	}

	for _, pair := range pairs {
		t.Run(pair.name, func(t *testing.T) {
			for _, problem := range driftProblems(reflect.TypeOf(pair.model), reflect.TypeOf(pair.wire)) {
				t.Errorf("model.%s and GraphQL %s have drifted: %s", pair.name, pair.name, problem)
			}
		})
	}
}

// A test that cannot fail is worse than no test, and this one would silently pass if
// jsonFields ever stopped seeing fields.
func TestSchemaDrift_DetectorNamesTheOffendingField(t *testing.T) {
	type stored struct {
		ID       uuid.UUID `json:"id"`
		Estimate int       `json:"estimate"`
		Title    string    `json:"title"`
	}
	type exposed struct {
		ID    uuid.UUID `json:"id"`
		Title []string  `json:"title"`
	}

	problems := strings.Join(driftProblems(reflect.TypeOf(stored{}), reflect.TypeOf(exposed{})), "\n")
	if !strings.Contains(problems, "estimate") {
		t.Errorf("a field the sync stream carries and the API does not must be reported by name; got: %s", problems)
	}
	if !strings.Contains(problems, "title") {
		t.Errorf("a field whose shape changed between the two must be reported by name; got: %s", problems)
	}
}

func driftProblems(stored, exposed reflect.Type) []string {
	var problems []string
	exposedFields := jsonFields(exposed)

	for name, storedType := range jsonFields(stored) {
		exposedType, ok := exposedFields[name]
		if !ok {
			problems = append(problems, fmt.Sprintf(
				"the sync stream carries %q and the GraphQL type does not expose it — "+
					"a field only the change log carries is one the API silently cannot return", name))
			continue
		}
		if !compatibleKinds(storedType, exposedType) {
			problems = append(problems, fmt.Sprintf(
				"%q is %s on the sync stream and %s on the wire — "+
					"the client stores one shape and the API answers with another", name, storedType, exposedType))
		}
	}
	return problems
}

// jsonFields maps a struct's JSON field names to their types, following the rules
// encoding/json follows — the tag when there is one, the Go name when there is not —
// because the JSON name is what actually reaches a client.
func jsonFields(t reflect.Type) map[string]reflect.Type {
	out := make(map[string]reflect.Type, t.NumField())
	for i := range t.NumField() {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		name := f.Name
		if tag, ok := f.Tag.Lookup("json"); ok {
			tagName, _, _ := strings.Cut(tag, ",")
			if tagName == "-" {
				continue
			}
			if tagName != "" {
				name = tagName
			}
		}
		out[name] = f.Type
	}
	return out
}

// compatibleKinds asks whether the two sides serialise to the same JSON shape.
//
// Optionality and width may differ: a pointer and a value marshal identically once a
// value is present, and an issue number is int64 in the database and int on the wire
// because that is what a GraphQL Int maps to. A change of shape may not — a string
// becoming a list, an object becoming a scalar — because that is the drift that breaks a
// client holding the old shape in IndexedDB.
func compatibleKinds(stored, exposed reflect.Type) bool {
	for stored.Kind() == reflect.Pointer {
		stored = stored.Elem()
	}
	for exposed.Kind() == reflect.Pointer {
		exposed = exposed.Elem()
	}
	// time.Time is a struct that marshals as a string; comparing kinds alone would call a
	// timestamp and an object interchangeable.
	if isTime(stored) != isTime(exposed) {
		return false
	}
	if isInteger(stored) && isInteger(exposed) {
		return true
	}
	return stored.Kind() == exposed.Kind()
}

func isTime(t reflect.Type) bool { return t == reflect.TypeOf(time.Time{}) }

func isInteger(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return true
	}
	return false
}
