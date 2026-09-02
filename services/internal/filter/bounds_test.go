package filter

import (
	"strings"
	"testing"
)

// A filter document is written by a UI out of a handful of clauses. These bounds exist for
// the document that was not.
//
// Node.UnmarshalJSON, Node.Validate and the compiler's group() are mutually recursive over
// Nodes, and SearchInput.filter is a free JSON scalar that reached Parse bounded only by
// the 1 MiB request body — roughly eighty thousand nesting levels. A Go stack overflow is
// a fatal runtime error, not a panic: the Recover middleware and gqlgen's RecoverFunc
// cannot catch it, so one query killed the API process and every request in flight with
// it. That is why the check runs before the unmarshaller, not after.

// nest builds {"conj":"and","nodes":[ … ]} nested depth levels deep.
func nest(depth int) []byte {
	var b strings.Builder
	for range depth {
		b.WriteString(`{"conj":"and","nodes":[`)
	}
	b.WriteString(`{"conj":"and","nodes":[]}`)
	for range depth {
		b.WriteString(`]}`)
	}
	return []byte(b.String())
}

func TestParse_RefusesATreeDeeperThanMaxDepth(t *testing.T) {
	if _, err := Parse(nest(MaxDepth - 2)); err != nil {
		t.Fatalf("a filter within the depth limit was refused: %v", err)
	}

	_, err := Parse(nest(MaxDepth + 5))
	if err == nil {
		t.Fatal("a filter nested past MaxDepth was accepted")
	}
	if !strings.Contains(err.Error(), "nests more than") {
		t.Fatalf("error = %q, want it to name the nesting limit", err)
	}
}

// The one that used to kill the process. It must return an error, and the test process
// must still be alive to read it — a stack overflow would take the test binary with it.
func TestParse_SurvivesAPathologicallyDeepDocument(t *testing.T) {
	// Well past anything MaxBytes admits, so the size check answers first; the point is
	// that neither check recurses.
	_, err := Parse(nest(50_000))
	if err == nil {
		t.Fatal("a fifty-thousand-level filter was accepted")
	}
}

func TestParse_RefusesADocumentOverMaxBytes(t *testing.T) {
	// A flat, legal, enormous document: depth 2, far too many bytes.
	var b strings.Builder
	b.WriteString(`{"conj":"and","nodes":[`)
	for i := range 4000 {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"field":"title","op":"contains","values":["aaaaaaaaaaaaaaaaaaaaaaaa"]}`)
	}
	b.WriteString(`]}`)

	_, err := Parse([]byte(b.String()))
	if err == nil {
		t.Fatal("a filter over MaxBytes was accepted")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Fatalf("error = %q, want it to say the filter is too large", err)
	}
}

// Depth is not size: one group holding a million clauses is two levels deep and compiles
// to a million SQL fragments.
func TestParse_RefusesTooManyNodes(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"conj":"and","nodes":[`)
	for i := range MaxNodes + 50 {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"field":"title","op":"eq","values":["a"]}`)
	}
	b.WriteString(`]}`)

	if _, err := Parse([]byte(b.String())); err == nil {
		t.Fatal("a filter over MaxNodes was accepted")
	}
}

// A tree assembled in Go never passes through Parse, so Validate carries the ceiling too.
func TestValidate_RefusesADeepTreeBuiltInGo(t *testing.T) {
	n := Node{Conj: "and"}
	for range MaxDepth + 5 {
		n = Node{Conj: "and", Nodes: []Node{n}}
	}
	if err := n.Validate(); err == nil {
		t.Fatal("a Go-built tree past MaxDepth validated")
	}
}

// The bounds must not have narrowed what a real filter can say.
func TestParse_StillAcceptsAnOrdinaryFilter(t *testing.T) {
	const ordinary = `{"conj":"and","nodes":[
		{"field":"title","op":"contains","values":["login"]},
		{"conj":"or","nodes":[
			{"field":"priority","op":"eq","values":["1"]},
			{"field":"priority","op":"eq","values":["2"]}
		]}
	]}`
	if _, err := Parse([]byte(ordinary)); err != nil {
		t.Fatalf("an ordinary filter was refused: %v", err)
	}
}
