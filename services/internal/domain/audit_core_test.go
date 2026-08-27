//go:build !ee

package domain

import "testing"

// The community build has no audit log, and this is the assertion that says so in code.
//
// Its twin is audit_ee_test.go, which asserts the opposite under `-tags ee`. Between them
// they pin the one property the whole licence separation rests on, at the one place a
// refactor could quietly reverse it: newAuditRecorder is a two-file pair, and nothing else
// in the package would notice if both files started returning the same thing.
//
// scripts/lint-editions.sh checks the same boundary from the outside, by reading the linked
// binaries' dependency graphs. This checks it from the inside, where the nil actually decides
// what recordAudit does. Neither replaces the other: the linter would still pass if this
// returned a no-op recorder that discarded every entry, and this would still pass if an
// unrelated file imported ee/ without a tag.
func TestCommunityBuildHasNoAuditRecorder(t *testing.T) {
	if newAuditRecorder() != nil {
		t.Fatal("the community build has an audit recorder. Either audit_core.go started " +
			"returning something, or a stub crept in — and a stub that accepts entries and " +
			"discards them is worse than no audit log, because ListAuditLog would then " +
			"answer with an empty page instead of saying the build does not contain one.")
	}
}
