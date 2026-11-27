//go:build windows

package main

import "os/exec"

func prepareChild(cmd *exec.Cmd) {}

func interruptChild(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
