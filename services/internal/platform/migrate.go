package platform

import (
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/peixotolabs/polaris/services/migrations"
)

// newMigrator builds a migrate.Migrate over the embedded SQL and a plain database/sql
// connection. golang-migrate needs its own connection because it takes an advisory lock
// for the duration, which must not be held by a pooled pgx connection that might be
// handed to somebody else.
func newMigrator(databaseURL string) (*migrate.Migrate, error) {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return nil, fmt.Errorf("open embedded migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, normalisePostgresURL(databaseURL))
	if err != nil {
		return nil, fmt.Errorf("open migrator: %w", err)
	}
	return m, nil
}

// MigrateUp applies every pending migration. Forward-only is the house rule: migrations
// must be additive and compatible with the previously deployed revision, so that a
// rollback of the application does not require a rollback of the schema.
func MigrateUp(databaseURL string) error {
	m, err := newMigrator(databaseURL)
	if err != nil {
		return err
	}
	defer closeMigrator(m)

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// MigrateDown rolls back n migrations. Development only — production is forward-only.
func MigrateDown(databaseURL string, n int) error {
	m, err := newMigrator(databaseURL)
	if err != nil {
		return err
	}
	defer closeMigrator(m)

	if err := m.Steps(-n); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate down: %w", err)
	}
	return nil
}

// MigrationStatus reports the applied version and whether a previous run left the
// schema dirty (a migration failed part-way and needs manual attention).
func MigrationStatus(databaseURL string) (version uint, dirty bool, err error) {
	m, err := newMigrator(databaseURL)
	if err != nil {
		return 0, false, err
	}
	defer closeMigrator(m)

	version, dirty, err = m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return 0, false, nil
	}
	return version, dirty, err
}

func closeMigrator(m *migrate.Migrate) {
	// Both halves report their own errors; nothing useful can be done with them at this
	// point and the caller's error is the one that matters.
	srcErr, dbErr := m.Close()
	_, _ = srcErr, dbErr
}

// normalisePostgresURL ensures the scheme is one golang-migrate's postgres driver
// recognises. pgx accepts both postgres:// and postgresql://; migrate wants the former.
func normalisePostgresURL(u string) string {
	const long = "postgresql://"
	if len(u) > len(long) && u[:len(long)] == long {
		return "postgres://" + u[len(long):]
	}
	return u
}

// ensure the postgres driver is linked in.
var _ = postgres.Postgres{}
