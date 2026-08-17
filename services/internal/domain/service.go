// Package domain is the only place in the codebase that writes to the database.
//
// GraphQL resolvers, the sync hub, job handlers, integrations and the admin CLI all call
// into here; none of them may import internal/store (scripts/lint-imports.sh enforces
// it). That single rule is what guarantees the invariant the whole product rests on:
// every mutation emits a change_log row in the same transaction as the entity write, so
// the sync stream, outbound webhooks, the activity feed and the audit log can never
// disagree about what happened.
//
// The package is deliberately flat — one file per entity rather than one sub-package.
// Issues need teams, teams need workflow states, and comments need issues; sub-packages
// would spend their time working around import cycles for no benefit.
package domain

import (
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Service is the domain API. One instance per process, safe for concurrent use.
type Service struct {
	db *store.DB
	em Emitter
}

func NewService(db *store.DB) *Service {
	return &Service{db: db}
}

// DB exposes the pool for the read-only paths that legitimately need it — the bootstrap
// snapshot streams inside its own REPEATABLE READ transaction, and the sync hub reads
// change_log directly. Neither writes, so neither can bypass the emitter.
func (s *Service) DB() *store.DB { return s.db }
