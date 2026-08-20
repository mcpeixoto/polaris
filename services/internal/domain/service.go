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
	"time"

	"github.com/peixotolabs/polaris/services/internal/store"
)

// Service is the domain API. One instance per process, safe for concurrent use.
type Service struct {
	db *store.DB
	em Emitter

	// PublicURL is the install's externally-correct base, used to mint issue URLs in
	// GitHub linkback comments. Empty is valid in tests: the comment then carries a
	// path, not a host.
	PublicURL string

	githubComments GitHubCommentPoster
	gitlabComments GitLabCommentPoster

	// now is the clock the filter grammar's relative tokens resolve against.
	//
	// A field rather than a call to time.Now at the point of use, because "today" has to be
	// answerable at a boundary. A filter saying `createdAt gte -10d` is only correct
	// relative to an instant, the conformance fixture pins that instant so both languages
	// answer the same question, and a test that had to wait for a real day to pass could
	// not check it at all. Nothing else in the package needs it: every other timestamp here
	// is written by the database's own now().
	now func() time.Time
}

func NewService(db *store.DB) *Service {
	return &Service{db: db, now: time.Now}
}

// SetGitHubCommentPoster is how the API process posts linkbacks. Tests inject a recorder.
func (s *Service) SetGitHubCommentPoster(p GitHubCommentPoster) {
	s.githubComments = p
}

// SetGitLabCommentPoster is how the API process posts GitLab linkbacks. Tests inject a recorder.
func (s *Service) SetGitLabCommentPoster(p GitLabCommentPoster) {
	s.gitlabComments = p
}

// DB exposes the pool for the read-only paths that legitimately need it — the bootstrap
// snapshot streams inside its own REPEATABLE READ transaction, and the sync hub reads
// change_log directly. Neither writes, so neither can bypass the emitter.
func (s *Service) DB() *store.DB { return s.db }
