// Package filter is the Go half of the one filter grammar.
//
// A filter is written once — in the view bar, in a saved view, in a search, in an export —
// and must mean the same thing every time. There are two evaluators, because the client
// filters its local replica in under a millisecond and the server has to filter issues the
// client never replicated. There is exactly one grammar: this package and web/src/filter
// read the same AST, implement the same semantics, and are pinned to each other by
// schema/filter-conformance.json, which both test suites run. When the two disagree one of
// them fails, rather than both passing and the product being wrong.
//
// filter.go holds the AST, its JSON shape and validation. compile.go turns a validated AST
// into a parameterised SQL fragment. Nothing here opens a connection: the package produces
// SQL text and arguments and internal/domain executes them, which is also why it does not
// import internal/store — see scripts/lint-imports.sh.
//
// Validation is strict, and that is the whole design. An unknown field, an operator the
// field's type does not support, an isNull carrying values: every one is a hard error. An
// ignored clause silently widens the result set, and a filter that quietly matches more
// than it says is the exact bug that makes people stop trusting filters.
//
// See docs/03-architecture/06-filter-grammar.md.
package filter

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Field is the left-hand side of a clause.
type Field string

// The fields the grammar knows. Anything else is a hard error, deliberately: an unknown
// field that was skipped would turn a four-clause filter into a three-clause one and
// return issues the user never asked for.
const (
	FieldState         Field = "state"
	FieldStateCategory Field = "stateCategory"
	FieldAssignee      Field = "assignee"
	FieldCreator       Field = "creator"
	FieldSubscriber    Field = "subscriber"
	FieldPriority      Field = "priority"
	FieldLabel         Field = "label"
	FieldTeam          Field = "team"
	FieldEstimate      Field = "estimate"
	FieldDueDate       Field = "dueDate"
	FieldCreatedAt     Field = "createdAt"
	FieldUpdatedAt     Field = "updatedAt"
	FieldCompletedAt   Field = "completedAt"
	FieldTitle         Field = "title"
	FieldDescription   Field = "description"
	FieldParent        Field = "parent"
	FieldBlockedBy     Field = "blockedBy"
	FieldBlocking      Field = "blocking"
	FieldArchived      Field = "archived"
	FieldDeleted       Field = "deleted"
	FieldTemplate      Field = "template"
	FieldRecurring     Field = "recurring"
)

// Op is the comparison a clause performs.
type Op string

const (
	OpEq          Op = "eq"
	OpNeq         Op = "neq"
	OpIn          Op = "in"
	OpNotIn       Op = "notIn"
	OpContains    Op = "contains"
	OpNotContains Op = "notContains"
	OpGt          Op = "gt"
	OpGte         Op = "gte"
	OpLt          Op = "lt"
	OpLte         Op = "lte"
	OpIsNull      Op = "isNull"
	OpIsNotNull   Op = "isNotNull"
)

// Conj joins the children of a group.
type Conj string

const (
	ConjAnd Conj = "and"
	ConjOr  Conj = "or"
)

// stateCategories are fixed by the product. A team creates, renames and reorders statuses
// within a category; it cannot invent one, because cycle completion, insights, triage and
// the git integrations all branch on them. Filtering by category is what lets a saved view
// survive a team renaming "Todo" to "Up next".
var stateCategories = map[string]bool{
	"triage":    true,
	"backlog":   true,
	"unstarted": true,
	"started":   true,
	"completed": true,
	"canceled":  true,
	"duplicate": true,
}

// Node is one node of the filter AST: either a clause or a group.
//
// The two are told apart by their keys and not by a discriminator field, exactly as the
// JSON is: a clause carries Field, a group carries Nodes. A discriminator would be a third
// thing to keep in step between the two evaluators and the stored views, and the first
// time one of them wrote it wrongly the node would be read as the other shape.
//
// The zero Node is the canonical empty filter: a group with no children and no
// conjunction, which is an AND over nothing and therefore matches everything. That is not
// an accident — view.filter defaults to '{}' in the database, and a freshly created view
// has to open.
type Node struct {
	// Field, Op and Values make a clause.
	Field  Field    `json:"field,omitempty"`
	Op     Op       `json:"op,omitempty"`
	Values []string `json:"values,omitempty"`

	// Conj and Nodes make a group. Conj is optional and defaults to ConjAnd.
	Conj  Conj   `json:"conj,omitempty"`
	Nodes []Node `json:"nodes,omitempty"`
}

// IsClause reports whether this node is a clause rather than a group.
func (n Node) IsClause() bool { return n.Field != "" }

// Conjunction is Conj with the default applied. An absent conj means "and", because that
// is what a filter bar builds when the user has not touched the any/all toggle.
func (n Node) Conjunction() Conj {
	if n.Conj == "" {
		return ConjAnd
	}
	return n.Conj
}

// clauseKeys and groupKeys are the only keys a node may carry. Held here rather than
// inferred from the struct tags so that the "neither a clause nor a group" error can name
// both sets, which is the difference between a usable message and "unexpected field".
var (
	clauseKeys = map[string]bool{"field": true, "op": true, "values": true}
	groupKeys  = map[string]bool{"conj": true, "nodes": true}
)

// UnmarshalJSON reads a node and rejects anything that is neither shape.
//
// Decoding into the struct alone would not do: encoding/json ignores unknown keys, so
// {"feild":"assignee",...} would arrive as an empty group matching every issue in the
// workspace. A typo must not silently become "show everything".
func (n *Node) UnmarshalJSON(data []byte) error {
	*n = Node{}

	var keys map[string]json.RawMessage
	if err := json.Unmarshal(data, &keys); err != nil {
		return fmt.Errorf("filter: a node must be an object holding a clause or a group: %w", err)
	}
	// JSON null is how an absent optional filter arrives from GraphQL. It means "no
	// filter", which is the canonical empty group, not a parse error.
	if keys == nil {
		return nil
	}

	var hasClause, hasGroup bool
	for k := range keys {
		switch {
		case clauseKeys[k]:
			hasClause = true
		case groupKeys[k]:
			hasGroup = true
		default:
			return fmt.Errorf(
				"filter: %q is neither a clause key (field, op, values) nor a group key (conj, nodes)", k)
		}
	}
	if hasClause && hasGroup {
		return fmt.Errorf("filter: a node is a clause or a group, never both: %s", strings.Join(sortedKeys(keys), ", "))
	}

	// A shadow type, so unmarshalling the body does not recurse into this method. The
	// Nodes slice still does, which is how nested groups are checked to the same standard.
	type nodeBody struct {
		Field  Field    `json:"field"`
		Op     Op       `json:"op"`
		Values []string `json:"values"`
		Conj   Conj     `json:"conj"`
		Nodes  []Node   `json:"nodes"`
	}
	var body nodeBody
	if err := json.Unmarshal(data, &body); err != nil {
		// Values arrive as strings on the wire whatever the field's type is, and the
		// field decides how to read them. One representation means the client and the
		// server cannot disagree about whether 3 and "3" are the same priority.
		return fmt.Errorf("filter: %w (field, op and values are strings; values is an array of strings)", err)
	}

	if hasClause && body.Field == "" {
		return fmt.Errorf("filter: a clause needs a field: %s", strings.Join(sortedKeys(keys), ", "))
	}

	n.Field = body.Field
	n.Op = body.Op
	n.Values = body.Values
	n.Conj = body.Conj
	n.Nodes = body.Nodes
	return nil
}

// MarshalJSON writes a node back in the shape it was read, and in canonical form.
//
// Hand-written because the struct tags cannot express it. With omitempty on Conj and
// Nodes, an empty OR group serialises to {} and reads back as an empty AND — matching
// everything where the original matched nothing. The AST is normally stored and forwarded
// as raw bytes so this path is rare, and a rare lossy path is one that gets discovered by
// a user rather than by a test.
func (n Node) MarshalJSON() ([]byte, error) {
	if n.IsClause() {
		// values is omitted when empty so isNull and isNotNull write the shape the spec
		// describes, with the key absent rather than present and empty.
		return json.Marshal(struct {
			Field  Field    `json:"field"`
			Op     Op       `json:"op"`
			Values []string `json:"values,omitempty"`
		}{n.Field, n.Op, n.Values})
	}
	nodes := n.Nodes
	if nodes == nil {
		nodes = []Node{}
	}
	return json.Marshal(struct {
		Conj  Conj   `json:"conj"`
		Nodes []Node `json:"nodes"`
	}{n.Conjunction(), nodes})
}

// sortedKeys names the keys a rejected node carried. Sorted because map order is random
// and an error message that changes between identical runs is one nobody trusts.
func sortedKeys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

// Parse reads a filter AST and validates it in one step.
//
// This is the entry point every caller should use. Unmarshalling without validating leaves
// a node that looks fine and compiles to SQL that quietly means something else.
func Parse(data []byte) (Node, error) {
	var n Node
	if err := json.Unmarshal(data, &n); err != nil {
		return Node{}, err
	}
	if err := n.Validate(); err != nil {
		return Node{}, err
	}
	return n, nil
}

// Validate reports the first thing wrong with the tree.
//
// Nothing is tolerated and nothing is dropped. The alternative — skipping a clause that
// does not make sense — widens the result set, and the user is never told, which is how a
// filter ends up returning issues it plainly says it excludes.
func (n Node) Validate() error {
	if !n.IsClause() {
		switch n.Conjunction() {
		case ConjAnd, ConjOr:
		default:
			return fmt.Errorf("filter: unknown conjunction %q, expected \"and\" or \"or\"", n.Conj)
		}
		for _, child := range n.Nodes {
			if err := child.Validate(); err != nil {
				return err
			}
		}
		return nil
	}
	_, err := n.bind()
	return err
}

// valueKind is what a field holds, and therefore which operators apply to it and how its
// values are read.
type valueKind uint8

const (
	kindUUID valueKind = iota
	kindCategory
	kindInt
	kindText
	kindBool
	kindDate
	kindTimestamp
)

func (k valueKind) String() string {
	switch k {
	case kindUUID:
		return "a uuid"
	case kindCategory:
		return "a state category"
	case kindInt:
		return "a number"
	case kindText:
		return "text"
	case kindBool:
		return "a boolean"
	case kindDate:
		return "a date"
	case kindTimestamp:
		return "a timestamp"
	}
	return "unknown"
}

// fieldSpec is everything the grammar and the compiler need to know about one field.
type fieldSpec struct {
	kind valueKind

	// nullable decides whether isNull and isNotNull apply, and — far more importantly —
	// whether a negative operator has to be written so that NULL rows survive it. See
	// compiler.negate.
	nullable bool

	// column is the issue column the field reads. Empty for the fields that live in
	// another table.
	column string

	// membership is the EXISTS form for the fields that are not columns of issue: a
	// format string taking the issue alias and the array placeholder. Rendering these as
	// EXISTS rather than as a join is what makes `label notIn` mean "has no label from
	// this set"; a join would return a row per *other* label and match nearly everything.
	membership string

	// flag marks fields the user sees as booleans and the schema stores as a nullable
	// column: archived/deleted as timestamps, recurring as the schedule id. Presence is
	// true; NULL is false.
	flag bool
}

// fields is the grammar. Adding one here is the only place it needs adding on this side;
// web/src/filter has the mirror, and the conformance fixture is what keeps them honest.
var fields = map[Field]fieldSpec{
	FieldState: {kind: kindUUID, column: "state_id"},
	FieldStateCategory: {kind: kindCategory, membership: `EXISTS (SELECT 1 FROM workflow_state f_state` +
		` WHERE f_state.id = %[1]s.state_id AND f_state.category = ANY(%[2]s))`},
	FieldAssignee: {kind: kindUUID, column: "assignee_id", nullable: true},
	FieldCreator:  {kind: kindUUID, column: "creator_id", nullable: true},
	// An unsubscribe is a row with a flag, not a missing row, so "is subscribed" has to
	// exclude it. Reading only the presence of the row would make the unsubscribe button
	// stop working the moment anything re-subscribed the user.
	FieldSubscriber: {kind: kindUUID, membership: `EXISTS (SELECT 1 FROM issue_subscription f_sub` +
		` WHERE f_sub.issue_id = %[1]s.id AND f_sub.unsubscribed = false AND f_sub.user_id = ANY(%[2]s))`},
	FieldPriority: {kind: kindInt, column: "priority"},
	FieldLabel: {kind: kindUUID, membership: `EXISTS (SELECT 1 FROM issue_label f_label` +
		` WHERE f_label.issue_id = %[1]s.id AND f_label.label_id = ANY(%[2]s))`},
	FieldTeam:        {kind: kindUUID, column: "team_id"},
	FieldEstimate:    {kind: kindInt, column: "estimate", nullable: true},
	FieldDueDate:     {kind: kindDate, column: "due_date", nullable: true},
	FieldCreatedAt:   {kind: kindTimestamp, column: "created_at"},
	FieldUpdatedAt:   {kind: kindTimestamp, column: "updated_at"},
	FieldCompletedAt: {kind: kindTimestamp, column: "completed_at", nullable: true},
	FieldTitle:       {kind: kindText, column: "title"},
	FieldDescription: {kind: kindText, column: "description"},
	FieldParent:      {kind: kindUUID, column: "parent_id", nullable: true},
	// Only `blocks` is stored; "blocked by" is the same row read from the other end. Two
	// stored directions could disagree, and an issue that blocks another without the other
	// being blocked by it is a state no user can explain or repair.
	FieldBlockedBy: {kind: kindUUID, membership: `EXISTS (SELECT 1 FROM issue_relation f_rel` +
		` WHERE f_rel.related_issue_id = %[1]s.id AND f_rel.type = 'blocks' AND f_rel.issue_id = ANY(%[2]s))`},
	FieldBlocking: {kind: kindUUID, membership: `EXISTS (SELECT 1 FROM issue_relation f_rel` +
		` WHERE f_rel.issue_id = %[1]s.id AND f_rel.type = 'blocks' AND f_rel.related_issue_id = ANY(%[2]s))`},
	FieldArchived:  {kind: kindBool, column: "archived_at", flag: true},
	FieldDeleted:   {kind: kindBool, column: "deleted_at", flag: true},
	FieldTemplate:  {kind: kindUUID, column: "template_id", nullable: true},
	FieldRecurring: {kind: kindBool, column: "recurring_issue_id", flag: true},
}

// knownOps exists so that an operator nobody has heard of reports itself as unknown
// rather than as "does not apply to this field", which sends the reader looking for a
// type problem that is not there.
var knownOps = map[Op]bool{
	OpEq: true, OpNeq: true, OpIn: true, OpNotIn: true,
	OpContains: true, OpNotContains: true,
	OpGt: true, OpGte: true, OpLt: true, OpLte: true,
	OpIsNull: true, OpIsNotNull: true,
}

// allows reports whether an operator means anything for this kind of field.
func (s fieldSpec) allows(op Op) bool {
	switch op {
	case OpEq, OpNeq, OpIn, OpNotIn:
		return true
	case OpContains, OpNotContains:
		return s.kind == kindText
	case OpGt, OpGte, OpLt, OpLte:
		return s.kind == kindInt || s.kind == kindDate || s.kind == kindTimestamp
	case OpIsNull, OpIsNotNull:
		return s.nullable
	}
	return false
}

// bound is a clause whose field, operator, arity and values have all been checked.
type bound struct {
	field Field
	op    Op
	spec  fieldSpec

	// values are the parsed literals in wire order. Date and timestamp fields hold
	// temporal values here, still unresolved: a relative token becomes an instant in
	// Compile, against the caller's clock and location, never here.
	values []any
}

// bind is the whole of clause validation, and it returns what the compiler needs so the
// work is not repeated. Validate throws the result away; Compile keeps it.
func (n Node) bind() (bound, error) {
	spec, ok := fields[n.Field]
	if !ok {
		return bound{}, fmt.Errorf("filter: unknown field %q", n.Field)
	}
	if !knownOps[n.Op] {
		return bound{}, fmt.Errorf("filter: unknown operator %q on field %q", n.Op, n.Field)
	}
	if !spec.allows(n.Op) {
		return bound{}, fmt.Errorf("filter: operator %q does not apply to field %q, which holds %s",
			n.Op, n.Field, spec.kind)
	}

	switch n.Op {
	case OpIsNull, OpIsNotNull:
		// The spec says values must be absent. An empty array carries nothing either, and
		// treating the two as different would make a client that always emits the key
		// fail for no reason a user could act on.
		if len(n.Values) != 0 {
			return bound{}, fmt.Errorf("filter: operator %q takes no values, values holds %d",
				n.Op, len(n.Values))
		}
	case OpIn, OpNotIn:
		// Any length, zero included. An empty in-list matches nothing and an empty
		// not-in-list matches everything; both are meaningful and neither is an error.
	default:
		if len(n.Values) != 1 {
			return bound{}, fmt.Errorf("filter: operator %q takes exactly one value, values holds %d",
				n.Op, len(n.Values))
		}
	}

	b := bound{field: n.Field, op: n.Op, spec: spec}
	for _, raw := range n.Values {
		v, err := parseValue(n.Field, spec.kind, raw)
		if err != nil {
			return bound{}, err
		}
		b.values = append(b.values, v)
	}
	return b, nil
}

// parseValue reads one wire value according to the field's type.
//
// Every failure here is a rejection rather than a skip. "priority eq high" is a filter
// somebody wrote wrongly; returning every issue in the workspace instead of saying so is
// not a kindness.
func parseValue(field Field, kind valueKind, raw string) (any, error) {
	switch kind {
	case kindUUID:
		id, err := uuid.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("filter: field %q takes a uuid, got %q", field, raw)
		}
		return id, nil

	case kindCategory:
		if !stateCategories[raw] {
			return nil, fmt.Errorf("filter: unknown state category %q on field %q", raw, field)
		}
		return raw, nil

	case kindInt:
		n, err := strconv.ParseInt(raw, 10, 32)
		if err != nil {
			return nil, fmt.Errorf("filter: field %q takes a number, got %q", field, raw)
		}
		return int32(n), nil

	case kindText:
		return raw, nil

	case kindBool:
		switch raw {
		case "true":
			return true, nil
		case "false":
			return false, nil
		}
		return nil, fmt.Errorf("filter: field %q takes true or false, got %q", field, raw)

	case kindDate:
		if rel, ok := parseRelative(raw); ok {
			// `now` names an instant and a DATE column holds no instants. The client
			// resolves every token to both an instant and a calendar day, and a date field
			// reads the day — so `now` against a due date means today there. Left as an
			// instant here it would compare a DATE against the middle of the afternoon,
			// which Postgres widens to midnight, and `dueDate eq now` would match nothing
			// for all but the first second of every day.
			rel.clock = false
			return temporal{relative: rel, isRelative: true}, nil
		}
		t, err := time.Parse(dateLayout, raw)
		if err != nil {
			return nil, fmt.Errorf(
				"filter: field %q takes a date as 2006-01-02 or a relative token such as \"-7d\", got %q",
				field, raw)
		}
		return temporal{literal: t}, nil

	case kindTimestamp:
		if rel, ok := parseRelative(raw); ok {
			return temporal{relative: rel, isRelative: true}, nil
		}
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return nil, fmt.Errorf(
				"filter: field %q takes an RFC 3339 timestamp or a relative token such as \"-7d\", got %q",
				field, raw)
		}
		return temporal{literal: t}, nil
	}
	return nil, fmt.Errorf("filter: field %q has no value parser", field)
}

const dateLayout = "2006-01-02"

// temporal is a date or timestamp that has been parsed but not yet pinned to an instant.
//
// The distinction is the point of the type. A relative token is stored as a recipe and
// resolved at evaluation time; storing the resolved instant instead is how a view called
// "Updated this week" comes to mean the week it was saved in, which is worse than useless
// because it looks right until somebody checks.
type temporal struct {
	literal    time.Time
	relative   relative
	isRelative bool
}

// relative is a resolved-later date: a base day, then an offset.
type relative struct {
	// anchor is the day the offset is measured from — today, or the first day of the week,
	// month or year containing it.
	//
	// An enum rather than the three booleans it replaced, because the three are mutually
	// exclusive and a struct that can express "start of the week and also of the year" is a
	// struct somebody eventually constructs.
	anchor anchor

	// clock makes this the current instant rather than the start of a day. Only `now` sets
	// it. Every other token in the grammar names a day, deliberately — see the comment on
	// RELATIVE_KEYWORDS in web/src/filter/relative.ts for why a token whose meaning each
	// side picks for itself is not allowed in here.
	clock bool

	days   int
	months int
	years  int
}

// anchor is the day a relative token measures from.
type anchor uint8

const (
	anchorToday anchor = iota
	anchorWeekStart
	anchorMonthStart
	anchorYearStart
)

// parseRelative reads the relative token forms the grammar defines: the seven keywords in
// RELATIVE_KEYWORDS, and a signed count of days, weeks, months or years.
//
// Only these, and only in step with the client. A token one side understands and the other
// does not is a filter that returns different issues depending on where it was evaluated,
// which is the failure the single grammar exists to prevent — so the set grows in the spec
// first, not here. It grew here second: the client shipped `now`, `yesterday`, `tomorrow`,
// `startOfMonth` and `startOfYear` and this function refused all five, so the filter bar
// could build a filter that worked against the replica and that `CreateView` then declined
// to save. TestRelativeTokens_TheClientEmitsTokensTheServerRefuses reads both sides and
// fails in either direction, which is what makes the rule above enforceable rather than
// merely stated.
//
// `yesterday` and `tomorrow` are exact synonyms of `-1d` and `+1d`. They are here because
// the client offers them by name and the two implementations have to accept the same
// alphabet, not because they add anything the offsets could not say.
func parseRelative(s string) (relative, bool) {
	switch s {
	case "now":
		return relative{clock: true}, true
	case "today":
		return relative{}, true
	case "yesterday":
		return relative{days: -1}, true
	case "tomorrow":
		return relative{days: 1}, true
	case "startOfWeek":
		return relative{anchor: anchorWeekStart}, true
	case "startOfMonth":
		return relative{anchor: anchorMonthStart}, true
	case "startOfYear":
		return relative{anchor: anchorYearStart}, true
	}

	// [+-] digits unit, so at minimum three characters.
	if len(s) < 3 {
		return relative{}, false
	}
	sign := 1
	switch s[0] {
	case '+':
	case '-':
		sign = -1
	default:
		return relative{}, false
	}
	n, err := strconv.Atoi(s[1 : len(s)-1])
	if err != nil || n < 0 {
		return relative{}, false
	}
	n *= sign

	// M is months and m is not accepted, because m reads as minutes to everybody who has
	// used a duration string and these fields are days.
	switch s[len(s)-1] {
	case 'd':
		return relative{days: n}, true
	case 'w':
		return relative{days: 7 * n}, true
	case 'M':
		return relative{months: n}, true
	case 'y':
		return relative{years: n}, true
	}
	return relative{}, false
}

// resolve turns a relative token into an instant, in the caller's location.
//
// It resolves to the START of the day, not to "now minus N days". "-10d" means "since the
// beginning of the day ten days ago", which is what a person means by "in the last ten
// days"; subtracting 240 hours from the current instant would drop everything created
// earlier in the day ten days ago and the boundary would move as the day went on.
func (r relative) resolve(now time.Time, loc *time.Location) time.Time {
	local := now.In(loc)

	// `now` is the one token that is not a day, so it is the one token that does not snap.
	// It carries no offset either — the grammar has no `now - 3d`, because that is `-3d`.
	if r.clock {
		return local
	}

	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	switch r.anchor {
	case anchorWeekStart:
		// Monday. Go numbers Sunday as 0, so Sunday is six days into the week here and
		// not the start of it — the week starts on Monday for a European product, and
		// getting this wrong moves every "this week" view by a day for one seventh of it.
		day = day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
	case anchorMonthStart:
		day = time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, loc)
	case anchorYearStart:
		day = time.Date(local.Year(), 1, 1, 0, 0, 0, 0, loc)
	case anchorToday:
	}
	return day.AddDate(r.years, r.months, r.days)
}
