// Package tools is the provider-neutral tool registry every agent surface shares.
//
// It exists because the tool catalogue was previously a switch statement inside the MCP
// server, which made the set of things an agent can do a property of one transport. A
// second caller — an in-process planner, a different protocol — had to either re-implement
// the catalogue or import an HTTP handler to reach it, and the two copies drift the first
// time somebody adds a verb to one of them.
//
// Every tool goes through *domain.Service with the caller's own *authz.Principal. Nothing
// here elevates, and nothing here reaches the database: a tool that could would be a
// mutation that never entered the change log, which is the same bug internal/store's
// import rule exists to prevent.
package tools

import (
	"context"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Tool is one callable verb.
//
// Run takes the service and the principal as arguments rather than closing over them, so a
// Registry is built once at start-up and shared by every request. A registry that captured
// a principal would be a per-request allocation and, worse, an object whose identity says
// nothing about whose permissions it carries.
type Tool struct {
	Name        string
	Description string
	// InputSchema is a JSON Schema object. MCP hands it to clients verbatim.
	InputSchema map[string]any
	// ReadOnly marks a tool that cannot change state, which is what a read-only
	// connection is allowed to call.
	ReadOnly bool
	Run      func(ctx context.Context, svc *domain.Service, p *authz.Principal, args map[string]any) (any, error)
}

type Registry struct {
	ordered []Tool
	byName  map[string]Tool
}

// New builds the registry. Order is fixed at construction: reads first, then writes, each
// group in the order it is declared.
//
// Deterministic on purpose. A client caches the tool list it was handed at connect time,
// and a catalogue that came back in map order would reshuffle between two connections to
// the same server for no reason a reader could explain.
func New() *Registry {
	defs := make([]Tool, 0, len(readTools)+len(writeTools))
	defs = append(defs, readTools...)
	defs = append(defs, writeTools...)

	r := &Registry{ordered: defs, byName: make(map[string]Tool, len(defs))}
	for _, t := range defs {
		r.byName[t.Name] = t
	}
	return r
}

// All returns every tool, reads before writes.
func (r *Registry) All() []Tool {
	out := make([]Tool, len(r.ordered))
	copy(out, r.ordered)
	return out
}

// Reads returns the read-only subset, in the same relative order as All.
func (r *Registry) Reads() []Tool {
	out := make([]Tool, 0, len(r.ordered))
	for _, t := range r.ordered {
		if t.ReadOnly {
			out = append(out, t)
		}
	}
	return out
}

func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.byName[name]
	return t, ok
}
