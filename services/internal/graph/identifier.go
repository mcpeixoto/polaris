package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Helpers live here rather than in schema.resolvers.go.
//
// gqlgen owns that file and rewrites it on every `make generate`, moving anything it does
// not recognise into a commented "one last chance to save this" block at the bottom — at
// which point the package stops compiling. Its own warning says to keep helpers out, and
// it means it.

// parseIdentifier splits a human issue reference — ENG-123 or eng123 — into a team key
// and a number. The identifier is not stored: it is derived from the team's key and the
// issue's number, because team keys are mutable and a stored identifier would mean rewriting
// every issue in a team to fix a typo. Reading one back therefore means taking it apart
// again.
func parseIdentifier(identifier string) (string, int64, error) {
	key, number, err := domain.ParseIssueIdentifier(identifier)
	if err != nil {
		return "", 0, platform.Validation("identifier", "an issue identifier looks like ENG-123")
	}
	return key, number, nil
}
