//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

func prepareChild(cmd *exec.Cmd) {
	// Own process group, so the signal reaches the CLI and the tools it
	// spawned. Signalling only the leader leaves those tools writing into a
	// workdir the next run will also use.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func interruptChild(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		return nil
	}
	// The group, not only the leader: see prepareChild.
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
}
