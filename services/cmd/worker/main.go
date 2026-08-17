// Command worker runs the background maintenance the product depends on but nobody sees.
//
// Everything here is idempotent and safe to run twice: the deploy model restarts
// processes freely, and a job that only works if it runs exactly once will eventually not.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

var revision = "dev"

func main() {
	if err := run(); err != nil {
		platform.Log(context.Background()).Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := platform.LoadConfig()
	if err != nil {
		return err
	}
	log := platform.NewLogger(cfg).With("service", "worker", "revision", revision)
	ctx, cancel := context.WithCancel(platform.WithLogger(context.Background(), log))
	defer cancel()

	db, err := store.Open(ctx, store.PoolConfig{
		URL:      cfg.DatabaseURL,
		MaxConns: 4,
		MinConns: 1,
	})
	if err != nil {
		return err
	}
	defer db.Close()

	svc := domain.NewService(db)

	jobs := []job{
		{
			name:     "ensure change_log partitions",
			every:    6 * time.Hour,
			atBoot:   true,
			run:      func(ctx context.Context) error { return svc.EnsureChangeLogPartitions(ctx) },
			critical: true,
		},
		{
			name:  "prune change_log",
			every: 24 * time.Hour,
			run: func(ctx context.Context) error {
				n, err := svc.PruneChangeLog(ctx)
				if err == nil && n > 0 {
					log.Info("pruned change rows", "rows", n)
				}
				return err
			},
		},
		{
			// Hourly rather than daily: these rows are only useful for the 24 hours a
			// client might retry within, and the table is written on every mutation, so
			// letting a day's worth accumulate makes the lookup on the retry path slower
			// exactly when it matters.
			name:  "prune idempotency keys",
			every: time.Hour,
			run: func(ctx context.Context) error {
				n, err := svc.PruneIdempotencyKeys(ctx)
				if err == nil && n > 0 {
					log.Debug("pruned idempotency keys", "rows", n)
				}
				return err
			},
		},
		{
			name:  "prune expired sessions",
			every: 24 * time.Hour,
			run: func(ctx context.Context) error {
				n, err := svc.PruneExpiredSessions(ctx)
				if err == nil && n > 0 {
					log.Info("pruned expired sessions", "rows", n)
				}
				return err
			},
		},
	}

	for _, j := range jobs {
		go j.loop(ctx, log)
	}

	log.Info("worker started", "jobs", len(jobs))

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	sig := <-stop
	log.Info("shutting down", "signal", sig.String())
	cancel()

	// A short grace so a job mid-statement finishes rather than leaving a transaction to
	// time out on the database side.
	time.Sleep(min(cfg.ShutdownGrace, 5*time.Second))
	return nil
}

type job struct {
	name  string
	every time.Duration
	// atBoot runs the job immediately on start as well as on the interval. Partition
	// creation needs this: a process starting on the 1st of the month must not wait six
	// hours to find out that this month has nowhere to write.
	atBoot bool
	run    func(context.Context) error
	// critical jobs log at error level on failure; the rest are warnings, so that alert
	// rules can distinguish "the disk will fill" from "cleanup was skipped once".
	critical bool
}

func (j job) loop(ctx context.Context, log *slog.Logger) {
	l := log.With("job", j.name)

	exec := func() {
		start := time.Now()
		// Bounded so a job that hangs on a lock does not silently stop running forever.
		runCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()

		if err := j.run(runCtx); err != nil {
			if j.critical {
				l.Error("job failed", "error", err, "duration_ms", time.Since(start).Milliseconds())
			} else {
				l.Warn("job failed", "error", err, "duration_ms", time.Since(start).Milliseconds())
			}
			return
		}
		l.Debug("job ok", "duration_ms", time.Since(start).Milliseconds())
	}

	if j.atBoot {
		exec()
	}

	ticker := time.NewTicker(j.every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			exec()
		}
	}
}
