package graph

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
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
		{"Project", model.Project{}, generated.Project{}},
		{"ProjectStatus", model.ProjectStatus{}, generated.ProjectStatus{}},
		{"ProjectTeam", model.ProjectTeam{}, generated.ProjectTeam{}},
		{"ProjectMember", model.ProjectMember{}, generated.ProjectMember{}},
		{"ProjectMilestone", model.ProjectMilestone{}, generated.ProjectMilestone{}},
		{"Cycle", model.Cycle{}, generated.Cycle{}},
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

// The test above proves the two shapes agree. It cannot prove that anything carries a value
// from one to the other, and that is exactly the failure it missed: toIssue copied eighteen
// fields and skipped six, toTeam skipped the whole estimate configuration, toUser skipped the
// notification preferences. Every one of those was a field both sides declared, both sides
// agreed about, and nothing filled in — so the drift check passed while the API returned null
// for values the database plainly held.
//
// This closes that. It fills a model struct with values that are all distinguishable from the
// zero value, runs the converter, and insists that every field the two shapes share came out
// non-zero. A converter that forgets a field leaves the zero value there, and a zero value is
// what a client receives as null — or, for a non-null enum, as the empty string, which is not
// a member of it and which gqlgen serialises without a word of complaint.
//
// No database and no fixtures: the converters are pure, and the point of this test is to fail
// in the second it takes to compile rather than in the minute it takes to reach Postgres.
func TestSchemaDrift_TheConvertersCarryEveryFieldTheTwoShapesShare(t *testing.T) {
	cases := []struct {
		name    string
		model   any
		convert func(any) (any, error)
	}{
		{"Issue", model.Issue{}, func(v any) (any, error) { return toIssue(v.(model.Issue)) }},
		{"Team", model.Team{}, func(v any) (any, error) { return toTeam(v.(model.Team)) }},
		{"User", model.User{}, func(v any) (any, error) { return toUser(v.(model.User)) }},
		{"Project", model.Project{}, func(v any) (any, error) { return toProject(v.(model.Project)) }},
		{"ProjectStatus", model.ProjectStatus{}, func(v any) (any, error) { return toProjectStatus(v.(model.ProjectStatus)) }},
		{"ProjectTeam", model.ProjectTeam{}, func(v any) (any, error) { return toProjectTeam(v.(model.ProjectTeam)), nil }},
		{"ProjectMember", model.ProjectMember{}, func(v any) (any, error) { return toProjectMember(v.(model.ProjectMember)), nil }},
		{"ProjectMilestone", model.ProjectMilestone{}, func(v any) (any, error) { return toProjectMilestone(v.(model.ProjectMilestone)), nil }},
		{"Cycle", model.Cycle{}, func(v any) (any, error) { return toCycle(v.(model.Cycle)), nil }},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			filled := reflect.New(reflect.TypeOf(c.model)).Elem()
			fillNonZero(t, filled, "")

			converted, err := c.convert(filled.Interface())
			if err != nil {
				t.Fatalf("converting a fully populated model.%s failed: %v\n"+
					"Every value it holds is a legal one; if an enum conversion refused, enumValues needs the field.",
					c.name, err)
			}

			stored := jsonFields(reflect.TypeOf(c.model))
			wire := reflect.ValueOf(converted)
			for i := range wire.NumField() {
				name, skip := jsonName(wire.Type().Field(i))
				if skip {
					continue
				}
				if _, shared := stored[name]; !shared {
					// A relation the GraphQL type adds and the stored row does not carry.
					// Filled by loaders.go, not here.
					continue
				}
				if wire.Field(i).IsZero() {
					t.Errorf("to%s does not copy %q.\n"+
						"model.%s carries it and GraphQL %s declares it, so the sync stream and the schema both "+
						"promise it — and the converter between them returns the zero value, which reaches a client "+
						"as null.", c.name, name, c.name, c.name)
				}
			}
		})
	}
}

// enumValues are the fields whose value has to be a member of a closed set, because the
// converters refuse anything else — which is deliberate, and covered by their own tests. Any
// old string would make this test fail for the wrong reason.
var enumValues = map[string]string{
	"dueDateSource":          model.DueDateManual,
	"estimateScale":          model.EstimateScaleFibonacci,
	"role":                   string(authz.RoleMember),
	"status":                 "active",
	"kind":                   "human",
	"category":               model.ProjectCategoryStarted,
	"startDateGranularity":   model.GranularityQuarter,
	"targetDateGranularity":  model.GranularityQuarter,
}

// fillNonZero writes a distinguishable value into every field of v, recursively.
//
// Distinguishable rather than realistic: nothing here asserts on the values, only on whether
// they survived, so what each one needs to be is "not what a forgotten field would leave
// behind". name is the JSON name of the field being filled, and is the only reason this
// knows a due date source from a description.
func fillNonZero(t *testing.T, v reflect.Value, name string) {
	t.Helper()

	switch v.Type() {
	case reflect.TypeOf(uuid.UUID{}):
		v.Set(reflect.ValueOf(uuid.Must(uuid.NewV7())))
		return
	case reflect.TypeOf(time.Time{}):
		v.Set(reflect.ValueOf(time.Now().UTC()))
		return
	case reflect.TypeOf(json.RawMessage{}):
		v.Set(reflect.ValueOf(json.RawMessage(`{"filled":true}`)))
		return
	}

	switch v.Kind() {
	case reflect.Pointer:
		p := reflect.New(v.Type().Elem())
		fillNonZero(t, p.Elem(), name)
		v.Set(p)
	case reflect.String:
		if enum, ok := enumValues[name]; ok {
			v.SetString(enum)
			return
		}
		v.SetString("filled")
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(7)
	case reflect.Slice:
		elem := reflect.New(v.Type().Elem()).Elem()
		fillNonZero(t, elem, name)
		v.Set(reflect.Append(reflect.MakeSlice(v.Type(), 0, 1), elem))
	case reflect.Struct:
		for i := range v.NumField() {
			f := v.Type().Field(i)
			if !f.IsExported() {
				continue
			}
			fieldName, skip := jsonName(f)
			if skip {
				continue
			}
			fillNonZero(t, v.Field(i), fieldName)
		}
	default:
		// A kind nothing in these structs uses yet. Failing beats filling nothing and
		// reporting a pass for a field this never touched.
		t.Fatalf("fillNonZero does not know how to populate %s (field %q); teach it before adding one", v.Kind(), name)
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
		name, skip := jsonName(f)
		if skip {
			continue
		}
		out[name] = f.Type
	}
	return out
}

// jsonName is the name one field reaches a client under, and whether it reaches one at all.
func jsonName(f reflect.StructField) (name string, skip bool) {
	name = f.Name
	tag, ok := f.Tag.Lookup("json")
	if !ok {
		return name, false
	}
	tagName, _, _ := strings.Cut(tag, ",")
	if tagName == "-" {
		return "", true
	}
	if tagName != "" {
		name = tagName
	}
	return name, false
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
