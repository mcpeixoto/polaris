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
	"github.com/peixotolabs/polaris/services/internal/mailer"
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

	// Mail is optional, and this is the one line an install with no relay ever sees about it.
	//
	// The alternative — registering the job unconditionally and letting it discover on every
	// tick that it cannot send — turns a supported configuration into an hourly warning, and
	// an hourly warning that is expected is one that trains everybody to ignore the log.
	mail, err := mailer.New(mailer.Config{
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		Username: cfg.SMTPUsername,
		Password: cfg.SMTPPassword,
		From:     mailer.Address{Name: cfg.MailFromName, Email: cfg.MailFrom},
		Timeout:  cfg.SMTPTimeout,
	})
	if err != nil {
		return err
	}

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
		{
			// The trash's retention sweep: issues soft-deleted longer ago than the restore
			// window, removed for real.
			//
			// Logged at info even though it destroys data, and deliberately so — this is the
			// only routine job in the product whose effect cannot be undone, and a line
			// saying how many rows went is what makes "where did that issue go" answerable
			// six weeks later. The window is the same constant the restore path refuses
			// outside of, so nothing this deletes was still restorable.
			name:  "purge expired issues",
			every: 24 * time.Hour,
			run: func(ctx context.Context) error {
				n, err := svc.PurgeExpiredIssues(ctx)
				if err == nil && n > 0 {
					log.Info("purged issues past the restore window", "issues", n)
				}
				return err
			},
		},
	}

	if cfg.MailEnabled() {
		jobs = append(jobs, job{
			// Hourly, and the interval is the cadence's resolution rather than the cadence.
			//
			// Each recipient's own preference decides whether they are due — daily by default,
			// hourly or weekly if they asked, one message per notification if they asked for
			// that — so this period only bounds how late a digest can be. An hour is small
			// enough that "hourly" means hourly and that a per-notification email arrives while
			// the thing it is about is still current, and large enough that a self-hosted
			// install is not opening an SMTP connection every few minutes to discover there is
			// nothing to send. Anything shorter buys a resolution nobody asked for; anything
			// longer makes the shortest cadence a lie.
			//
			// atBoot is deliberately off, unlike the partition job, which needs it because a
			// process starting on the 1st must not wait six hours to find out that this month
			// has nowhere to write. Nothing is at stake here in the first hour: a digest is by
			// definition not urgent, and the claim would make a boot pass safe in any case.
			// What a boot pass would do is move people's digests. Each recipient's next one is
			// due a fixed interval after their last, so a pass at deploy time re-anchors that
			// interval to the deploy — and a fleet that ships at 16:00 on a Tuesday quietly
			// walks everybody's morning digest into the afternoon, permanently, for a reason
			// nobody would ever connect to a release.
			name:  "deliver notification digests",
			every: time.Hour,
			run: func(ctx context.Context) error {
				n, err := svc.DeliverNotificationDigests(ctx, mail, domain.DigestOptions{
					BaseURL: cfg.PublicURL,
					Tick:    time.Hour,
				})
				if n > 0 {
					// A count, never an address. The log is shipped somewhere with a much
					// wider audience than any of these mailboxes has.
					log.Info("sent notification digests", "messages", n)
				}
				return err
			},
			// Not critical. A relay being down, an address bouncing or a certificate expiring
			// are all real and all recoverable by themselves on the next pass, and none of them
			// is the class of problem — the disk filling, a partition missing — that the error
			// level in this process is reserved for. Paging somebody at 03:00 because Postmark
			// had a bad minute is how an on-call rotation learns to mute the channel.
			critical: false,
		})
	} else {
		log.Info("email delivery is not configured; notification digests will not be sent",
			"hint", "set POLARIS_SMTP_HOST to enable them")
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
