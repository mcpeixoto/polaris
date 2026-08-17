package syncsrv

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

// The client's store version and the server's must be the same number.
//
// This test exists because they were not, and the failure was total rather than partial.
// The client was bumped to 2 so that replicas built before the M1 entity types would be
// discarded; this package's constant stayed at 1. Every bootstrap then failed the meta
// check, and the message the user was shown — "this version of the app is out of date,
// reload to update" — described a situation that did not exist and prescribed an action
// that could not help. Reloading re-fetches a bundle; it does not change a constant in
// somebody's source tree.
//
// Nothing else caught it. Both sides compile, both sides' tests pass, and the client's own
// suite has no server to disagree with. A constant shared across two languages has no
// compiler to hold it together, so it needs a test that reads both.
//
// Read out of the TypeScript source rather than duplicated here, because a copy of the
// number in a Go test is a third place to forget.
func TestClientSchemaMatchesTheClient(t *testing.T) {
	const relative = "../../../web/src/store/db.ts"

	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// A hard failure, not a skip. A skip here would be silent in CI on the day
		// somebody moved the file, which is exactly when the pin stops holding.
		t.Fatalf("cannot read the client's store definition at %s: %v", relative, err)
	}

	pattern := regexp.MustCompile(`(?m)^export const CLIENT_SCHEMA\s*=\s*(\d+)`)
	match := pattern.FindSubmatch(source)
	if match == nil {
		t.Fatalf("no `export const CLIENT_SCHEMA = <n>` in %s — if it was renamed, this "+
			"test has to be taught the new name rather than deleted", relative)
	}

	client, err := strconv.Atoi(string(match[1]))
	if err != nil {
		t.Fatalf("CLIENT_SCHEMA is not a number: %v", err)
	}

	if client != ClientSchema {
		t.Fatalf(
			"schema versions have drifted: the client is v%d and this server is v%d.\n\n"+
				"Every bootstrap will fail while these disagree, and the client will tell the "+
				"user to reload — which cannot fix it. Bump whichever side is behind:\n"+
				"  server: internal/syncsrv/protocol.go ClientSchema\n"+
				"  client: web/src/store/db.ts CLIENT_SCHEMA",
			client, ClientSchema,
		)
	}
}
