// Command polaris-runner claims issues delegated to an app user and runs them
// through a local coding CLI.
//
// The built-in Polaris agent lives in the worker. Every other agent is an OAuth
// app user whose runner process polls /runner/v1. This binary is that process.
// It does not open the database, and it does not run git: committing, pushing
// and merging stay inside the agent's own CLI, in the workdir it was given.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// runnerVersion is what claim reports. A release build can stamp it with
// -X main.runnerVersion=<tag>; an unstamped build says so plainly.
var runnerVersion = "dev"

// A runner that waits a full interval before its first heartbeat looks idle to
// the server, which only knows the timestamp we last wrote. The first beat goes
// out as soon as the child is started; this is the gap after that.
const heartbeatEvery = 30 * time.Second

// COPY: recorded on the run when the operator stops the process.
const reasonStopped = "runner stopped"

// COPY: recorded on the run when Polaris reports the run cancelled.
const reasonCancelled = "run cancelled"

// COPY: recorded on the run when the claim no longer belongs to this agent.
const reasonNotFound = "run not found"

// COPY: recorded when the agent exits without a result and without an error text.
const reasonAgentFailed = "agent failed"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := parseArgs(args)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return loop(ctx, cfg)
}

type config struct {
	url      string
	token    string
	preset   string
	workdir  string
	once     bool
	poll     time.Duration
	maxTurns int
	unsafe   bool
}

func parseArgs(args []string) (config, error) {
	fs := flag.NewFlagSet("polaris-runner", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	// COPY: usage. The token is not a flag default: Flag prints defaults in the
	// help text, and a token that arrived through the environment would then be
	// written to the terminal by --help.
	fs.Usage = func() {
		fmt.Fprint(os.Stderr, `polaris-runner claims issues delegated to this agent and runs them with a local coding CLI.

  polaris-runner --url https://polaris.example.com --preset claude --workdir DIR

The token is an API key or OAuth token for an app user. Prefer POLARIS_RUNNER_TOKEN
so it does not land in the shell history.

Flags:
  --url URL                 Polaris base URL
  --token TOKEN             bearer token, or POLARIS_RUNNER_TOKEN
  --preset NAME             claude, codex, or opencode
  --workdir DIR             directory the agent runs in
  --once                    claim once and exit; exit 0 if nothing is due
  --poll DURATION           wait between empty claims (default 5s)
  --max-turns N             turn cap, passed through when the preset supports it
  --unsafe-auto-approve     append the preset's permission-skip flag

The runner does not commit, push, or merge. SIGINT and SIGTERM stop the child
and mark the run failed.
`)
	}

	url := fs.String("url", "", "Polaris base URL")
	tokenFlag := fs.String("token", "", "bearer token, or POLARIS_RUNNER_TOKEN")
	presetName := fs.String("preset", "", "claude, codex, or opencode")
	workdir := fs.String("workdir", "", "directory the agent runs in")
	once := fs.Bool("once", false, "claim once and exit")
	poll := fs.Duration("poll", 5*time.Second, "wait between empty claims")
	maxTurns := fs.Int("max-turns", 0, "turn cap, passed through when the preset supports it")
	unsafe := fs.Bool("unsafe-auto-approve", false, "append the preset's permission-skip flag")
	if err := fs.Parse(args); err != nil {
		return config{}, err
	}
	if fs.NArg() != 0 {
		return config{}, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}

	token := *tokenFlag
	if token == "" {
		token = os.Getenv("POLARIS_RUNNER_TOKEN")
	}
	cfg := config{
		url:      *url,
		token:    token,
		preset:   *presetName,
		workdir:  *workdir,
		once:     *once,
		poll:     *poll,
		maxTurns: *maxTurns,
		unsafe:   *unsafe,
	}
	switch {
	case cfg.url == "":
		fs.Usage()
		return config{}, errors.New("no url: pass --url")
	case cfg.token == "":
		fs.Usage()
		return config{}, errors.New("no token: pass --token or set POLARIS_RUNNER_TOKEN")
	case cfg.preset == "":
		fs.Usage()
		return config{}, errors.New("no preset: pass --preset claude, codex, or opencode")
	case cfg.workdir == "":
		fs.Usage()
		return config{}, errors.New("no workdir: pass --workdir")
	case cfg.poll <= 0:
		return config{}, errors.New("--poll must be greater than zero")
	}
	return cfg, nil
}

func loop(ctx context.Context, cfg config) error {
	p, err := lookupPreset(cfg.preset)
	if err != nil {
		return err
	}
	if err := checkWorkdir(cfg.workdir); err != nil {
		return err
	}
	a := newAPI(cfg.url, cfg.token)

	for {
		if ctx.Err() != nil {
			return nil
		}
		code, body, err := a.claim(ctx, runnerVersion)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		switch code {
		case 204:
			if cfg.once {
				return nil
			}
			if err := sleepCtx(ctx, cfg.poll); err != nil {
				return nil
			}
			continue
		case 200:
		default:
			return fmt.Errorf("claim: %s", statusLine(code, body))
		}

		cl, err := decodeClaim(body)
		if err != nil {
			// A claim we cannot read is still a claim. Leaving it sitting until
			// the stale sweep re-runs an issue this process already failed to
			// understand.
			if cl.runID != "" {
				// COPY: recorded on the run when the claim body cannot be read.
				_ = a.finish(context.WithoutCancel(ctx), cl.runID, finishRequest{
					Status: "failed",
					Error:  "could not read the claimed issue",
				})
			}
			return err
		}
		if cl.runID == "" {
			return errors.New("claim: response had no run id")
		}

		err = perform(ctx, a, p, cfg, cl)
		if err != nil {
			var recorded *recordedFailure
			if errors.As(err, &recorded) && !cfg.once {
				fmt.Fprintf(os.Stderr, "error: %v\n", err)
				continue
			}
			return err
		}
		if cfg.once {
			return nil
		}
	}
}

// recordedFailure means the run was already reported to Polaris. --once exits
// non-zero so a supervisor notices; a long-running poll keeps going, because
// one bad issue is not a reason to abandon the queue.
type recordedFailure struct{ msg string }

func (e *recordedFailure) Error() string { return e.msg }

func perform(ctx context.Context, a *api, p preset, cfg config, cl claimed) error {
	// COPY: operator log lines.
	fmt.Fprintf(os.Stderr, "claimed %s (%s)\n", cl.issue.identifier, cl.runID)

	prompt := buildPrompt(cl.issue)
	ln, err := p.launch(cl.session, prompt, cfg.maxTurns, cfg.unsafe)
	if err != nil {
		return finishRecorded(ctx, a, cl.runID, finishRequest{Status: "failed", Error: err.Error()})
	}

	// runCtx is a child of the signal context, so SIGINT cancels it and
	// CommandContext stops the child. A 409 does the same via cancel.
	var box reasonBox
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	cmd, stdout, err := startChild(runCtx, ln, prompt, cfg.workdir)
	if err != nil {
		return finishRecorded(ctx, a, cl.runID, finishRequest{Status: "failed", Error: err.Error()})
	}

	hbDone := make(chan struct{})
	go func() {
		defer close(hbDone)
		a.beat(runCtx, cl.runID, func(reason string) {
			box.set(reason)
			cancel()
		})
	}()

	out, waitErr := waitAgent(cmd, stdout, p.parse, os.Stdout)
	cancel()
	<-hbDone

	req := decide(ctx.Err() != nil, box.get(), out, waitErr)
	return finishRecorded(ctx, a, cl.runID, req)
}

func finishRecorded(ctx context.Context, a *api, id string, req finishRequest) error {
	err := a.finish(context.WithoutCancel(ctx), id, req)
	fmt.Fprintf(os.Stderr, "finished %s %s\n", id, req.Status)
	if err != nil {
		return err
	}
	if req.Status != "done" {
		msg := req.Error
		if msg == "" {
			msg = reasonAgentFailed
		}
		return &recordedFailure{msg: msg}
	}
	return nil
}

func decide(parentDone bool, stopReason string, o outcome, waitErr error) finishRequest {
	req := finishRequest{
		SessionRef:   o.session,
		InputTokens:  o.input,
		OutputTokens: o.output,
	}
	switch {
	case stopReason == reasonCancelled || stopReason == reasonNotFound:
		req.Status = "failed"
		req.Error = stopReason
	case parentDone || stopReason == reasonStopped:
		req.Status = "failed"
		req.Error = reasonStopped
	case waitErr != nil || o.isError:
		req.Status = "failed"
		req.Error = failureText(o, waitErr)
	default:
		req.Status = "done"
		req.Summary = o.text
	}
	return req
}

func failureText(o outcome, waitErr error) string {
	if o.text != "" && o.isError {
		return o.text
	}
	if waitErr != nil && o.text != "" {
		return o.text + ": " + waitErr.Error()
	}
	if waitErr != nil {
		return waitErr.Error()
	}
	if o.text != "" {
		return o.text
	}
	return reasonAgentFailed
}

func checkWorkdir(path string) error {
	fi, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("workdir: %w", err)
	}
	if !fi.IsDir() {
		return fmt.Errorf("workdir %s is not a directory", path)
	}
	return nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// reasonBox keeps the first reason a run stopped. Heartbeat and the signal
// handler both write it, and the one that arrives second must not overwrite a
// cancel with "runner stopped" just because the parent context also ends.
type reasonBox struct {
	mu sync.Mutex
	v  string
}

func (b *reasonBox) set(reason string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.v == "" {
		b.v = reason
	}
}

func (b *reasonBox) get() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.v
}
