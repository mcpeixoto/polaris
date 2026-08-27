//go:build ee

package domain

import "testing"

// The enterprise build has one. The twin of TestCommunityBuildHasNoAuditRecorder.
//
// This is the direction that fails silently. A build tag that stops matching — renamed,
// misspelled, moved to a file the compiler skips — produces an enterprise binary with the
// community's nil recorder, in which every audited mutation succeeds while writing nothing.
// Nothing else notices: the mutations pass their own tests, the screen renders, and the audit
// log is simply empty, which is indistinguishable from a quiet week.
func TestEnterpriseBuildHasAnAuditRecorder(t *testing.T) {
	if newAuditRecorder() == nil {
		t.Fatal("the enterprise build has no audit recorder, so every audited event is " +
			"being dropped and the audit log will read as though nothing happened")
	}
}

// The seam is satisfied by what audit_ee.go actually returns, checked here rather than only
// by assignment in the source. A compile-time assertion would be enough today; this also
// survives someone changing newAuditRecorder to return a different type.
func TestTheEnterpriseRecorderSatisfiesTheSeam(t *testing.T) {
	var _ auditRecorder = eeRecorder{}
}
