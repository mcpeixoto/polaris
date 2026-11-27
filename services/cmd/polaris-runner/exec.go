package main

import (
	"bufio"
	"context"
	"io"
	"os/exec"
	"time"
)

func startChild(ctx context.Context, ln launch, prompt, workdir string) (*exec.Cmd, io.Reader, error) {
	cmd := exec.CommandContext(ctx, ln.bin, ln.args...)
	cmd.Dir = workdir
	// SIGTERM first, so a CLI can shut down. WaitDelay is the stdlib's own
	// timer for the SIGKILL that follows, bound to this process rather than a
	// goroutine that might still be sleeping after the pid has been reused.
	cmd.Cancel = func() error { return interruptChild(cmd) }
	cmd.WaitDelay = 2 * time.Second
	prepareChild(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	var stdin io.WriteCloser
	if ln.promptVia == viaStdin {
		stdin, err = cmd.StdinPipe()
		if err != nil {
			return nil, nil, err
		}
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	if stdin != nil {
		// Closed so the child sees EOF. A prompt larger than the pipe buffer
		// blocks this goroutine until the child reads, which is why it is not
		// the goroutine that also reads stdout.
		go func() {
			_, _ = io.WriteString(stdin, prompt)
			_ = stdin.Close()
		}()
	}
	return cmd, stdout, nil
}

func waitAgent(cmd *exec.Cmd, stdout io.Reader, parse func([]byte, *outcome), mirror io.Writer) (outcome, error) {
	var o outcome
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if mirror != nil {
			_, _ = mirror.Write(line)
			_, _ = mirror.Write([]byte("\n"))
		}
		if parse != nil {
			parse(line, &o)
		}
	}
	scanErr := sc.Err()
	waitErr := cmd.Wait()
	if waitErr == nil && scanErr != nil {
		return o, scanErr
	}
	return o, waitErr
}
