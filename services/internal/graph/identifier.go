package graph

import (
	"strconv"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Helpers live here rather than in schema.resolvers.go.
//
// gqlgen owns that file and rewrites it on every `make generate`, moving anything it does
// not recognise into a commented "one last chance to save this" block at the bottom — at
// which point the package stops compiling. Its own warning says to keep helpers out, and
// it means it.

// parseIdentifier splits a human issue reference — ENG-123 — into a team key and a number.
//
// The identifier is not stored: it is derived from the team's key and the issue's number,
// because team keys are mutable and a stored identifier would mean rewriting every issue
// in a team to fix a typo. Reading one back therefore means taking it apart again.
func parseIdentifier(identifier string) (string, int64, error) {
	const malformed = "an issue identifier looks like ENG-123"

	s := strings.TrimSpace(identifier)

	// LastIndex, not Index: a team key cannot contain a hyphen today, but being explicit
	// about which separator matters costs nothing and survives that rule changing.
	sep := strings.LastIndex(s, "-")
	if sep <= 0 || sep == len(s)-1 {
		return "", 0, platform.Validation("identifier", malformed)
	}

	key := strings.ToUpper(s[:sep])
	number, err := strconv.ParseInt(s[sep+1:], 10, 64)
	if err != nil || number <= 0 {
		return "", 0, platform.Validation("identifier", malformed)
	}
	for _, c := range key {
		if (c < 'A' || c > 'Z') && (c < '0' || c > '9') {
			return "", 0, platform.Validation("identifier", malformed)
		}
	}
	return key, number, nil
}
