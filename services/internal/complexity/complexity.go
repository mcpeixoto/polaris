// Package complexity scores a GraphQL operation by the model the API documents.
//
// docs/03-platform/01-graphql-api.md states it exactly, and integrations calibrate against
// it, so it is a published contract rather than an implementation detail:
//
//	each property = 0.1 point, each object = 1 point, each connection multiplies its
//	children by the pagination argument (default 50), rounded up. Maximum complexity of a
//	single query: 10,000 points.
//
// It was not implemented. gqlgen's default scores every field at childComplexity+1 unless a
// Complexity function is supplied for it, and none were — so `issues { id }` and
// `issues { id title description comments { body } }` cost 2 and 6 rather than 60 and 5,566,
// and the 10,000 ceiling was unreachable by any query a person could type. A published
// number that the server does not compute is worse than no number: an integration author
// budgets against it, sizes their page requests by it, and discovers the truth from a
// production incident.
//
// # Why this walks the schema rather than filling in gqlgen's table
//
// gqlgen expects per-field complexity functions in the generated ComplexityRoot — 406 of
// them for this schema, hand-written, one per field. Every field added later that nobody
// remembers to add an entry for silently falls back to +1, which is the same bug as today
// arriving one field at a time. Deriving the cost from the field's *type* instead means a
// new field is scored correctly the moment it exists, because the rule is about what a field
// returns and not about its name.
//
// # Units
//
// Everything here is in TENTHS of a documented point, because a property costs 0.1 and
// integers are the only thing that can be compared without deciding how floating-point
// error rounds. Callers convert once, with Points, and the conversion rounds up exactly
// where the documentation says it does. Nothing outside this package should see a tenth.
package complexity

import (
	"github.com/vektah/gqlparser/v2/ast"
)

const (
	// propertyUnits is 0.1 of a point: a scalar or enum field.
	//
	// A LIST of scalars costs the same as one, and deliberately. `ApiKey.scopes: [String!]!`
	// is one column read once; charging it the connection multiplier would price a string
	// array at 50 points, five times an object with children. The documented multiplier is
	// about connections — things with a page of *entities* behind them — and a scalar list
	// has no children to multiply.
	propertyUnits = 1

	// objectUnits is 1 point: a field that resolves to a composite type.
	objectUnits = 10

	// DefaultPageSize is what a list field costs when the caller has not said how many rows
	// they want. It is the documented default and it is deliberately not small: the whole
	// point of the number is that a caller who declines to paginate is charged as though
	// they had asked for a page, because that is what the server will do.
	DefaultPageSize = 50

	// MaxPoints is the ceiling on ONE operation, in documented points.
	//
	// It is a ceiling on a single request and nothing more — this limit is equally happy to
	// serve a thousand 9,999-point queries a second, which is what the per-caller budget in
	// internal/httpapi is for.
	MaxPoints = 10000
)

// paginationArgs are the argument names that mean "how many rows".
//
// `first` is the one this schema uses. `limit` is here because it is the other spelling a
// schema drifts into, and a field that paginates under a name this list does not know would
// be charged the default rather than what it asked for — which is wrong in the direction
// that under-charges, so the list is generous rather than exact.
var paginationArgs = []string{"first", "limit", "last", "take"}

// PaginationArgs is the same list, for the test that walks the real schema looking for an
// Int argument this package would not recognise. Exported rather than duplicated, because
// two copies of a list are two lists.
var PaginationArgs = paginationArgs

// Points converts internal units to documented points, rounding up.
//
// Up, not to nearest: the documentation says "rounded up", and a `user { name }` that came
// out as 1 instead of 2 would be a published example the server disagrees with.
func Points(units int) int {
	if units <= 0 {
		return 0
	}
	return (units + 9) / 10
}

// Score returns the cost of one operation, in units.
//
// vars carries the request's variables so that `first: $n` is charged what the caller
// actually asked for rather than the default. A variable that is absent or not a number
// falls back to the default, which is the safe direction: it over-charges a malformed
// request rather than under-charging a crafted one.
func Score(op *ast.OperationDefinition, vars map[string]any) int {
	if op == nil {
		return 0
	}
	return selectionSetUnits(op.SelectionSet, vars, 0, 0)
}

// maxFragmentDepth bounds the walk.
//
// The validator rejects cyclic fragment spreads before this runs, so a cycle should be
// impossible — and "should be impossible" is not a reason to let a scorer recurse without a
// bound on input an attacker writes. Hitting the bound stops descending rather than
// erroring: the cost accumulated so far is already enormous and the cap will refuse it.
const maxFragmentDepth = 64

func selectionSetUnits(set ast.SelectionSet, vars map[string]any, depth, inherited int) int {
	if depth > maxFragmentDepth {
		return 0
	}
	total := 0
	for _, selection := range set {
		switch s := selection.(type) {
		case *ast.Field:
			total += fieldUnits(s, vars, depth, inherited)
		case *ast.InlineFragment:
			// Costed flat rather than as an object. `... on Issue { title }` selects a
			// property of the thing already being paid for; charging a point for the
			// fragment itself would make a query cost more for being written in the style
			// the schema requires.
			total += selectionSetUnits(s.SelectionSet, vars, depth+1, inherited)
		case *ast.FragmentSpread:
			if s.Definition != nil {
				total += selectionSetUnits(s.Definition.SelectionSet, vars, depth+1, inherited)
			}
		}
	}
	return total
}

func fieldUnits(field *ast.Field, vars map[string]any, depth, inherited int) int {
	// A page size named on this field governs its whole subtree, which is what "multiplies
	// its children" means: in this schema the argument and the list are frequently not the
	// same field — `search(input: {first: 10})` bounds `SearchResults.issues`, one level
	// down — so the number has to travel with the selection rather than sit on it. An
	// explicit argument nearer the leaves wins, being the more specific statement.
	page := inherited
	if own, ok := pageFromArguments(field, vars); ok {
		page = own
	}

	child := selectionSetUnits(field.SelectionSet, vars, depth+1, page)

	// A field with no sub-selection cannot be composite — the validator rejects that — so
	// the selection set decides leaf-ness and this scorer needs no access to the schema's
	// type map. That also covers the meta-fields the validator resolves itself, `__typename`
	// and introspection, which have no definition to consult and read nothing.
	if field.Definition == nil || len(field.SelectionSet) == 0 {
		return propertyUnits
	}

	if _, isList := unwrap(field.Definition.Type); !isList {
		return objectUnits + child
	}

	// The connection rule: the whole subtree, once per row the caller may receive.
	if page == 0 {
		page = DefaultPageSize
	}
	return page * (objectUnits + child)
}

// unwrap strips NonNull and List wrappers, reporting whether any List was among them.
func unwrap(t *ast.Type) (*ast.Type, bool) {
	isList := false
	for t != nil && t.Elem != nil {
		isList = true
		t = t.Elem
	}
	return t, isList
}

// pageFromArguments reads a page size off this field's own arguments, if it names one.
//
// Two shapes, because the schema has both: an argument on the field itself
// (`notifications(first: Int)`), and an argument nested one level inside an input object
// (`search(input: SearchInput!)`, whose `first` bounds SearchResults.issues). Only one level
// deep — a limit buried deeper than that is not something a caller could be expected to find
// either, and guessing at it would make a published number depend on a traversal nobody
// documented.
func pageFromArguments(field *ast.Field, vars map[string]any) (int, bool) {
	for _, arg := range field.Arguments {
		if contains(paginationArgs, arg.Name) {
			if n, ok := intValue(arg.Value, vars); ok {
				return clampPage(n), true
			}
			continue
		}
		if arg.Value == nil || arg.Value.Kind != ast.ObjectValue {
			continue
		}
		for _, child := range arg.Value.Children {
			if !contains(paginationArgs, child.Name) {
				continue
			}
			if n, ok := intValue(child.Value, vars); ok {
				return clampPage(n), true
			}
		}
	}
	return 0, false
}

// clampPage keeps a page size at one or more.
//
// `first: 0` is a caller asking for nothing, and charging zero for it would make a whole
// subtree free — including its children, which are multiplied by this number. A request that
// returns no rows still costs a query.
func clampPage(n int) int {
	if n < 1 {
		return 1
	}
	return n
}

// intValue reads an integer out of a literal or a variable.
func intValue(v *ast.Value, vars map[string]any) (int, bool) {
	if v == nil {
		return 0, false
	}
	if v.Kind == ast.Variable {
		raw, ok := vars[v.Raw]
		if !ok {
			return 0, false
		}
		switch n := raw.(type) {
		case int:
			return n, true
		case int32:
			return int(n), true
		case int64:
			return int(n), true
		case float64:
			// JSON numbers arrive as float64 through encoding/json, which is how every
			// variable in a real request gets here.
			return int(n), true
		}
		return 0, false
	}
	if v.Kind != ast.IntValue {
		return 0, false
	}
	n, err := v.Value(vars)
	if err != nil {
		return 0, false
	}
	switch parsed := n.(type) {
	case int64:
		return int(parsed), true
	case int:
		return parsed, true
	case float64:
		return int(parsed), true
	}
	return 0, false
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
