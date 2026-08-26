//go:build !ee

package domain

// The community half of the audit-log seam. AGPL, and it is the whole of what an AGPL build
// contains on the subject.
//
// There is no no-op recorder object here, deliberately. A stub type implementing the
// interface and discarding every entry would be "present and disabled" — the arrangement
// ee/README.md refuses — and worse, it would be a thing a future reader could mistake for a
// working audit log while reading the code that calls it. nil is unambiguous: the build has
// no audit log, recordAudit returns immediately, and ListAuditLog says so in words.
//
// Its counterpart is audit_ee.go, which is the only file in the core module that names the
// commercial module at all. scripts/lint-editions.sh asserts that this pairing actually
// holds in the linked binaries rather than only in the tags.

// newAuditRecorder returns nothing to record with.
//
// The signature has to match audit_ee.go's exactly — one of these two files is compiled,
// never both, and a mismatch is a compile error in whichever edition is not being built
// today. That is the intended failure: it is loud, immediate, and in CI, because CI builds
// both.
func newAuditRecorder() auditRecorder { return nil }
