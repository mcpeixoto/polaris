// Command polarisctl is the admin CLI: migrations, partition maintenance, retention
// pruning and seed data.
//
// It is built from the same image as the services so an operator on the box is always
// running the tool that matches the deployed schema.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return fmt.Errorf("no command given")
	}

	switch args[0] {
	case "migrate":
		return migrateCmd(args[1:])
	case "seed":
		return seedCmd(args[1:])
	case "partitions":
		return partitionsCmd(args[1:])
	case "prune":
		return pruneCmd(args[1:])
	case "help", "-h", "--help":
		usage()
		return nil
	default:
		usage()
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `polarisctl — Polaris administration

  migrate up                 apply pending migrations
  migrate down --steps N     roll back N migrations (development only)
  migrate status             show the applied version
  partitions ensure          create change_log partitions for the coming months
  prune change-log           delete change rows past the retention window
  seed --scale small|large   generate a realistic workspace

Flags:
  --database URL   defaults to $DATABASE_URL
`)
}

func databaseFlag(fs *flag.FlagSet) *string {
	return fs.String("database", os.Getenv("DATABASE_URL"), "PostgreSQL connection string")
}

func migrateCmd(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("migrate needs a subcommand: up, down or status")
	}
	fs := flag.NewFlagSet("migrate", flag.ExitOnError)
	db := databaseFlag(fs)
	steps := fs.Int("steps", 1, "how many migrations to roll back")
	_ = fs.Parse(args[1:])

	if *db == "" {
		return fmt.Errorf("no database: pass --database or set DATABASE_URL")
	}

	switch args[0] {
	case "up":
		if err := platform.MigrateUp(*db); err != nil {
			return err
		}
		v, dirty, err := platform.MigrationStatus(*db)
		if err != nil {
			return err
		}
		fmt.Printf("migrated to version %d (dirty=%v)\n", v, dirty)
		return nil

	case "down":
		// Production is forward-only: migrations must be additive and compatible with the
		// previously deployed revision, so that rolling the application back never
		// requires rolling the schema back. This exists for local iteration.
		if os.Getenv("POLARIS_ENV") == "production" {
			return fmt.Errorf("refusing to roll back migrations in production; write a forward migration instead")
		}
		if err := platform.MigrateDown(*db, *steps); err != nil {
			return err
		}
		fmt.Printf("rolled back %d migration(s)\n", *steps)
		return nil

	case "status":
		v, dirty, err := platform.MigrationStatus(*db)
		if err != nil {
			return err
		}
		fmt.Printf("version=%d dirty=%v\n", v, dirty)
		if dirty {
			// A dirty schema means a migration failed part-way. Continuing to deploy over
			// it compounds the damage, so say so loudly.
			fmt.Fprintln(os.Stderr,
				"WARNING: the schema is dirty — a migration failed part-way and must be resolved by hand")
		}
		return nil

	default:
		return fmt.Errorf("unknown migrate subcommand %q", args[0])
	}
}

func partitionsCmd(args []string) error {
	fs := flag.NewFlagSet("partitions", flag.ExitOnError)
	db := databaseFlag(fs)
	if len(args) > 0 {
		_ = fs.Parse(args[1:])
	}

	svc, closeFn, err := openService(*db)
	if err != nil {
		return err
	}
	defer closeFn()

	if err := svc.EnsureChangeLogPartitions(context.Background()); err != nil {
		return err
	}
	fmt.Println("change_log partitions ensured for the next four months")
	return nil
}

func pruneCmd(args []string) error {
	fs := flag.NewFlagSet("prune", flag.ExitOnError)
	db := databaseFlag(fs)
	if len(args) > 0 {
		_ = fs.Parse(args[1:])
	}

	svc, closeFn, err := openService(*db)
	if err != nil {
		return err
	}
	defer closeFn()

	n, err := svc.PruneChangeLog(context.Background())
	if err != nil {
		return err
	}
	fmt.Printf("pruned %d change rows older than %s\n", n, domain.ChangeLogRetention)
	return nil
}

func openService(dbURL string) (*domain.Service, func(), error) {
	if dbURL == "" {
		return nil, nil, fmt.Errorf("no database: pass --database or set DATABASE_URL")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, store.PoolConfig{URL: dbURL, MaxConns: 4, MinConns: 1})
	if err != nil {
		return nil, nil, err
	}
	return domain.NewService(db), db.Close, nil
}
