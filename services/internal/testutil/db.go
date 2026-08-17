// Package testutil provides a real Postgres for integration tests.
//
// Tests run against actual SQL rather than mocks. The filter grammar, the partial unique
// indexes, the row-lock ordering in the version counter and the CHECK constraints are
// the parts most likely to be wrong, and a mock asserts only that the code called the
// function the author expected — which is exactly the assumption under test.
//
// Each test package gets its own database, created from a migrated template. Template
// cloning makes setup ~20ms instead of re-running every migration per package.
package testutil

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/migrations"
)

const defaultURL = "postgres://polaris:polaris@localhost:55432/polaris?sslmode=disable"

// templateLockID namespaces the advisory lock taken while the template is built.
//
// `go test ./...` runs one process per package, in parallel. Without the lock they race:
// one drops the template while another is cloning from it, and the failure surfaces as
// "template database does not exist" in whichever package happened to lose — a test
// failure with nothing to do with the code under test.
const templateLockID = 0x504f4c41 // "POLA"

var (
	templateOnce sync.Once
	templateErr  error
	templateName string
)

// templateNameFor derives the template's name from the migrations themselves.
//
// Deterministic, so every package in a run shares one template and pays for the
// migrations once. Content-addressed, so editing a migration produces a different name
// and the stale template is simply never used again — which removes the failure mode
// where a template built from last week's schema silently backs today's tests and the
// resulting errors look like application bugs.
func templateNameFor() (string, error) {
	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return "", err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	h := sha256.New()
	for _, name := range names {
		b, err := migrations.FS.ReadFile(name)
		if err != nil {
			return "", err
		}
		_, _ = h.Write([]byte(name))
		_, _ = h.Write(b)
	}
	return fmt.Sprintf("polaris_test_tmpl_%x", h.Sum(nil)[:6]), nil
}

// adminURL returns a connection string pointing at the maintenance database, used to
// CREATE and DROP the per-test databases.
func adminURL(t *testing.T) string {
	base := os.Getenv("DATABASE_URL")
	if base == "" {
		base = defaultURL
	}
	return replaceDBName(base, "postgres")
}

// NewDB returns a migrated, empty database scoped to this test, and registers cleanup.
//
// Set POLARIS_TEST_KEEP_DB=1 to skip the drop when you need to inspect the state a
// failing test left behind.
func NewDB(t *testing.T) *store.DB {
	t.Helper()

	base := os.Getenv("DATABASE_URL")
	if base == "" {
		base = defaultURL
	}

	if err := ensureTemplate(base); err != nil {
		t.Skipf("no test database available (%v); start one with `make up`", err)
	}

	name := uniqueDBName(t)
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, adminURL(t))
	if err != nil {
		t.Fatalf("connect to maintenance database: %v", err)
	}
	// CREATE DATABASE ... TEMPLATE copies the already-migrated schema, which is far
	// cheaper than running eleven migrations for every package.
	if _, err := admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q TEMPLATE %q`, name, templateName)); err != nil {
		_ = admin.Close(ctx)
		t.Fatalf("create test database %s: %v", name, err)
	}
	_ = admin.Close(ctx)

	db, err := store.Open(ctx, store.PoolConfig{
		URL:      replaceDBName(base, name),
		MaxConns: 4,
		MinConns: 1,
	})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}

	t.Cleanup(func() {
		db.Close()
		if os.Getenv("POLARIS_TEST_KEEP_DB") != "" {
			t.Logf("kept test database %s", name)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		admin, err := pgx.Connect(ctx, adminURL(t))
		if err != nil {
			return
		}
		defer func() { _ = admin.Close(ctx) }()
		// FORCE disconnects any connection the test left open; without it the drop
		// fails and test databases accumulate until the disk fills.
		_, _ = admin.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name))
	})

	return db
}

// ensureTemplate creates and migrates the template database once per process.
func ensureTemplate(base string) error {
	templateOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()

		name, err := templateNameFor()
		if err != nil {
			templateErr = fmt.Errorf("derive template name: %w", err)
			return
		}
		templateName = name

		admin, err := pgx.Connect(ctx, replaceDBName(base, "postgres"))
		if err != nil {
			templateErr = fmt.Errorf("connect: %w", err)
			return
		}
		defer func() { _ = admin.Close(ctx) }()

		// Held until this connection closes. Whoever gets it builds the template; the
		// others block here and then find it already present.
		if _, err := admin.Exec(ctx, "SELECT pg_advisory_lock($1)", int64(templateLockID)); err != nil {
			templateErr = fmt.Errorf("take template lock: %w", err)
			return
		}
		defer func() { _, _ = admin.Exec(ctx, "SELECT pg_advisory_unlock($1)", int64(templateLockID)) }()

		var exists bool
		if err := admin.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", templateName,
		).Scan(&exists); err != nil {
			templateErr = fmt.Errorf("look up template: %w", err)
			return
		}
		if exists {
			return
		}

		if _, err := admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, templateName)); err != nil {
			templateErr = fmt.Errorf("create template: %w", err)
			return
		}
		if err := platform.MigrateUp(replaceDBName(base, templateName)); err != nil {
			// A half-migrated template would back every later test in the run. Remove it
			// so the next attempt rebuilds rather than cloning something broken.
			_, _ = admin.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, templateName))
			templateErr = fmt.Errorf("migrate template: %w", err)
			return
		}
	})
	return templateErr
}

func uniqueDBName(t *testing.T) string {
	// Test names contain slashes and spaces; keep only what Postgres tolerates and cap
	// the length so the 63-byte identifier limit is never hit.
	var b strings.Builder
	b.WriteString("polaris_t_")
	for _, r := range strings.ToLower(t.Name()) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	name := b.String()
	if len(name) > 40 {
		name = name[:40]
	}
	return fmt.Sprintf("%s_%d", name, time.Now().UnixNano()%1_000_000)
}

func replaceDBName(url, name string) string {
	// postgres://user:pass@host:port/DBNAME?params
	q := ""
	if i := strings.Index(url, "?"); i >= 0 {
		q = url[i:]
		url = url[:i]
	}
	if i := strings.LastIndex(url, "/"); i >= 0 {
		url = url[:i]
	}
	return url + "/" + name + q
}
