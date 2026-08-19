package filter

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Compiled is a SQL WHERE fragment and the arguments its placeholders bind to.
//
// SQL is the fragment, already parenthesised, so it can be dropped into any position of a
// larger WHERE without the caller reasoning about precedence. Args are positional and go
// straight to pgx.
//
// No value the user typed ever reaches SQL. Every literal is a placeholder, including the
// ones that look harmless — a priority is a number until somebody sends "1; DROP", and a
// compiler with one interpolated branch is a compiler with an injection.
type Compiled struct {
	SQL  string
	Args []any
}

// Options is what the compiler cannot work out for itself.
type Options struct {
	// Alias is how the issue table is named in the caller's query. Empty means "issue",
	// which is what an unaliased FROM issue gives you.
	Alias string

	// Now is the instant relative tokens resolve against. Zero means time.Now().
	//
	// A parameter rather than a call to the clock so tests are reproducible and so a
	// single request resolves "today" once — a query that asked the clock twice could
	// straddle midnight and return a set that satisfies neither answer.
	Now time.Time

	// Location is the workspace's timezone, which is what "today" and "startOfWeek" are
	// relative to. Nil means UTC.
	//
	// Getting this from the workspace rather than from the server is the whole point: a
	// Lisbon team's "due today" must not roll over when a machine in Virginia says so.
	Location *time.Location

	// ArgOffset is how many placeholders the caller has already bound. The fragment
	// numbers its own from ArgOffset+1, so a caller that starts with
	// "workspace_id = $1" passes 1 and appends Compiled.Args to its own.
	ArgOffset int
}

// aliasPattern is the one string in this package that reaches SQL text uninterpolated.
// It comes from the caller and not from a user, but "comes from the caller" is exactly
// what every injection was believed to be, so it is checked rather than trusted.
var aliasPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// sqlTrue and sqlFalse are the compiled forms of "matches everything" and "matches
// nothing". They exist as literals because both are real answers that must be emitted:
// an empty in-list matches nothing, and skipping the clause instead would turn "assigned
// to nobody in this list" into no filter at all.
const (
	sqlTrue  = "true"
	sqlFalse = "false"
)

// Compile turns a filter AST into a WHERE fragment over the issue table.
//
// It validates first. Compiling an unvalidated tree would mean a clause the grammar does
// not accept could still produce SQL, and the point of strict validation is that there is
// no path around it.
func Compile(root Node, opts Options) (Compiled, error) {
	if err := root.Validate(); err != nil {
		return Compiled{}, err
	}

	alias := opts.Alias
	if alias == "" {
		alias = "issue"
	}
	if !aliasPattern.MatchString(alias) {
		return Compiled{}, fmt.Errorf("filter: %q is not a usable table alias", alias)
	}

	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	loc := opts.Location
	if loc == nil {
		loc = time.UTC
	}

	c := &compiler{alias: alias, now: now, loc: loc, offset: opts.ArgOffset}

	predicate, err := c.node(root)
	if err != nil {
		return Compiled{}, err
	}

	// Archived and deleted are excluded by default, and the default is a property of the
	// whole query rather than of the group the clause sits in.
	//
	// Scoping it per group would let an OR resurrect deleted issues into a view that never
	// asked for them: {or: [priority eq 1, deleted eq true]} would return live urgent
	// issues plus the entire recycle bin, and the person who wrote the first half would
	// never understand where the rest came from.
	//
	// The two are tracked separately: someone asking to see archived issues has not asked
	// to see deleted ones.
	parts := []string{predicate}
	if !mentions(root, FieldArchived) {
		parts = append(parts, alias+".archived_at IS NULL")
	}
	if !mentions(root, FieldDeleted) {
		parts = append(parts, alias+".deleted_at IS NULL")
	}
	if !mentions(root, FieldState) && !mentions(root, FieldStateCategory) {
		// Triage is a category, not a view. An empty filter that pulled unreviewed work
		// into the backlog would mix two queues, and a view would have to remember to
		// exclude it — which is how it would sometimes forget. Naming state or
		// stateCategory is how a triage inbox, or a view that wants those issues, asks.
		parts = append(parts, "NOT EXISTS (SELECT 1 FROM workflow_state ws WHERE ws.id = "+
			alias+".state_id AND ws.category = 'triage')")
	}

	return Compiled{SQL: "(" + strings.Join(parts, " AND ") + ")", Args: c.args}, nil
}

// mentions reports whether any clause anywhere in the tree names this field.
func mentions(n Node, f Field) bool {
	if n.IsClause() {
		return n.Field == f
	}
	for _, child := range n.Nodes {
		if mentions(child, f) {
			return true
		}
	}
	return false
}

type compiler struct {
	alias  string
	now    time.Time
	loc    *time.Location
	offset int
	args   []any
}

// placeholder appends an argument and returns the $n that reads it. The only way a value
// gets into the fragment.
func (c *compiler) placeholder(v any) string {
	c.args = append(c.args, v)
	return "$" + strconv.Itoa(c.offset+len(c.args))
}

func (c *compiler) node(n Node) (string, error) {
	if n.IsClause() {
		return c.clause(n)
	}
	return c.group(n)
}

func (c *compiler) group(n Node) (string, error) {
	// An AND over nothing is vacuously true and an OR over nothing is vacuously false.
	// The first is the canonical empty filter and has to match everything, because
	// view.filter defaults to '{}' and a freshly created view must open.
	if len(n.Nodes) == 0 {
		if n.Conjunction() == ConjOr {
			return sqlFalse, nil
		}
		return sqlTrue, nil
	}

	joiner := " AND "
	if n.Conjunction() == ConjOr {
		joiner = " OR "
	}

	parts := make([]string, 0, len(n.Nodes))
	for _, child := range n.Nodes {
		sql, err := c.node(child)
		if err != nil {
			return "", err
		}
		parts = append(parts, sql)
	}
	return "(" + strings.Join(parts, joiner) + ")", nil
}

func (c *compiler) clause(n Node) (string, error) {
	b, err := n.bind()
	if err != nil {
		return "", err
	}

	// Relative tokens become instants here and nowhere earlier, against the clock and the
	// location this call was given.
	values := make([]any, 0, len(b.values))
	for _, v := range b.values {
		if t, ok := v.(temporal); ok {
			if t.isRelative {
				values = append(values, t.relative.resolve(c.now, c.loc))
				continue
			}
			values = append(values, t.literal)
			continue
		}
		values = append(values, v)
	}

	switch {
	case b.spec.flag:
		return c.flag(b, values), nil
	case b.spec.membership != "":
		return c.membership(b, values), nil
	default:
		return c.column(b, values), nil
	}
}

// flag compiles archived, deleted and recurring, which the user sees as booleans and the
// schema stores as a nullable column (a timestamp, or a schedule id).
//
// Reduced to the set of boolean values the clause accepts, so eq, neq, in and notIn all
// come out of one place. Writing four branches instead invites the empty-list cases to be
// forgotten in exactly one of them.
func (c *compiler) flag(b bound, values []any) string {
	wantTrue, wantFalse := false, false
	switch b.op {
	case OpEq:
		wantTrue = values[0].(bool)
		wantFalse = !wantTrue
	case OpNeq:
		wantTrue = !values[0].(bool)
		wantFalse = !wantTrue
	case OpIn:
		for _, v := range values {
			if v.(bool) {
				wantTrue = true
			} else {
				wantFalse = true
			}
		}
	case OpNotIn:
		wantTrue, wantFalse = true, true
		for _, v := range values {
			if v.(bool) {
				wantTrue = false
			} else {
				wantFalse = false
			}
		}
	}

	col := c.alias + "." + b.spec.column
	switch {
	case wantTrue && wantFalse:
		return sqlTrue
	case wantTrue:
		return col + " IS NOT NULL"
	case wantFalse:
		return col + " IS NULL"
	default:
		return sqlFalse
	}
}

// membership compiles the fields that are not columns of issue: labels, subscribers and
// the two relation directions.
//
// EXISTS, never a join. `label notIn ['bug']` means "has no label from this set"; a join
// asking for a row whose label is not 'bug' matches every issue that has any other label,
// which is nearly all of them and is never what was asked for.
func (c *compiler) membership(b bound, values []any) string {
	negative := b.op == OpNeq || b.op == OpNotIn

	if len(values) == 0 {
		// Reachable only through in/notIn, since eq and neq are checked to carry exactly
		// one value. Nothing is a member of the empty set, so an empty in-list matches
		// nothing and an empty not-in-list matches everything.
		if negative {
			return sqlTrue
		}
		return sqlFalse
	}

	exists := fmt.Sprintf(b.spec.membership, c.alias, c.placeholder(listArg(b.spec.kind, values)))
	if negative {
		// EXISTS is never NULL, so a plain NOT is correct here and the three-valued
		// caution that column comparisons need does not apply.
		return "NOT " + exists
	}
	return exists
}

// column compiles the fields that are columns of issue.
func (c *compiler) column(b bound, values []any) string {
	col := c.alias + "." + b.spec.column

	switch b.op {
	case OpEq:
		return col + " = " + c.placeholder(values[0])

	case OpNeq:
		return c.negate(col, b.spec.nullable, col+" = "+c.placeholder(values[0]))

	case OpIn:
		if len(values) == 0 {
			return sqlFalse
		}
		return col + " = ANY(" + c.placeholder(listArg(b.spec.kind, values)) + ")"

	case OpNotIn:
		if len(values) == 0 {
			return sqlTrue
		}
		return c.negate(col, b.spec.nullable, col+" = ANY("+c.placeholder(listArg(b.spec.kind, values))+")")

	case OpGt:
		return col + " > " + c.placeholder(values[0])
	case OpGte:
		return col + " >= " + c.placeholder(values[0])
	case OpLt:
		return col + " < " + c.placeholder(values[0])
	case OpLte:
		return col + " <= " + c.placeholder(values[0])

	case OpIsNull:
		return col + " IS NULL"
	case OpIsNotNull:
		return col + " IS NOT NULL"

	case OpContains:
		return c.contains(col, values[0].(string))
	case OpNotContains:
		return c.negate(col, b.spec.nullable, c.contains(col, values[0].(string)))
	}

	// Unreachable: bind rejects every operator not handled above, and the switch covers
	// all of them. It fails closed rather than open on the day that stops being true —
	// a clause that matches nothing is visible, and one that matches everything is not.
	return sqlFalse
}

// negate wraps a positive predicate so that NULL rows survive it.
//
// SQL's three-valued logic makes NOT (NULL = 'ada') evaluate to NULL rather than to true,
// so the straightforward negation drops every unassigned issue from "everything not
// assigned to Ada" — the opposite of what the words mean, and invisible until somebody
// counts. Every negative operator over a nullable column goes through here.
func (c *compiler) negate(col string, nullable bool, positive string) string {
	if !nullable {
		return "NOT (" + positive + ")"
	}
	return "(" + col + " IS NULL OR NOT (" + positive + "))"
}

// contains is a folded substring match.
//
// search_fold is the same function migration 000017 builds the search vectors and the
// folded trigram indexes from, so a search and a saved view typed with the same words fold
// identically. Two foldings would mean the two return different issues, which is the bug
// the single grammar exists to prevent, one layer further down.
//
// Someone typing "acao" is looking for "Ação" and is not asking for a different issue.
func (c *compiler) contains(col, needle string) string {
	return "search_fold(" + col + ") LIKE '%' || search_fold(" + c.placeholder(escapeLike(needle)) + `) || '%' ESCAPE '\'`
}

// likeEscaper neutralises the wildcards in a search term.
//
// A Replacer rather than three ReplaceAll calls because it makes one pass and never
// rescans what it has already written: escaping % first and \ afterwards would otherwise
// go back over the backslash the first step added and double it.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// escapeLike makes a search term mean itself.
//
// Someone searching for "50%" wants the characters, not "anything ending in 50". The term
// is a bound parameter either way, so this is about meaning rather than about safety.
func escapeLike(s string) string { return likeEscaper.Replace(s) }

// listArg packs parsed values into the typed slice pgx encodes as a Postgres array.
//
// The type assertions are safe because parseValue is the only producer of these values and
// the kind that selected the parser is the kind that selects the slice here.
func listArg(kind valueKind, values []any) any {
	switch kind {
	case kindUUID:
		out := make([]uuid.UUID, len(values))
		for i, v := range values {
			out[i] = v.(uuid.UUID)
		}
		return out
	case kindInt:
		out := make([]int32, len(values))
		for i, v := range values {
			out[i] = v.(int32)
		}
		return out
	case kindDate, kindTimestamp:
		out := make([]time.Time, len(values))
		for i, v := range values {
			out[i] = v.(time.Time)
		}
		return out
	default:
		// Categories and text both arrive as strings.
		out := make([]string, len(values))
		for i, v := range values {
			out[i] = v.(string)
		}
		return out
	}
}
