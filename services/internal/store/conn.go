package store

// Conn returns the handle these queries run on — the pool, or the transaction they were
// bound to by InTx.
//
// It exists for exactly one caller: the enterprise build's audit recorder, which lives in a
// separate Go module under ee/ and therefore cannot name anything in
// services/internal/store at all. Go's internal-package rule is by import path, and
// `github.com/peixotolabs/polaris/ee` is not under `.../services/`, so the ee module
// declares its own structurally identical DBTX and is handed this value through it.
//
// That indirection is the price of putting the commercial code under the directory whose
// licence covers it (see ee/LICENSE), and it is worth stating why the obvious alternatives
// were not taken: generating sqlc queries for audit_log would put the enterprise read and
// write paths in the community binary, which is the precise claim ee/README.md makes that
// the build must not contain — and moving the code to services/ee/ would leave it under the
// AGPL, because the directory decides.
//
// It returns the interface rather than the concrete type deliberately. A caller that could
// reach the *pgxpool.Pool could start a transaction of its own beside the one it was given,
// and a write that commits outside the caller's transaction is how an audit row survives a
// mutation that rolled back — a log describing something that never happened.
func (q *Queries) Conn() DBTX { return q.db }
