#!/bin/sh
# Fake `claude` for polaris-runner tests. Reads the prompt on stdin, records the
# invocation, and prints one canned stream-json transcript.
#
# POLARIS_FAKE_CLAUDE_ARGV   file receiving the arguments, one per line
# POLARIS_FAKE_CLAUDE_STDIN  file receiving the prompt
# POLARIS_FAKE_CLAUDE_MARKER file receiving started, then killed or exited
# POLARIS_FAKE_CLAUDE_HOLD   seconds to stay alive after the transcript, so a
#                            heartbeat can land while the process is still running
set -u

if [ -n "${POLARIS_FAKE_CLAUDE_ARGV:-}" ]; then
  printf '%s\n' "$@" > "$POLARIS_FAKE_CLAUDE_ARGV"
fi

if [ -n "${POLARIS_FAKE_CLAUDE_STDIN:-}" ]; then
  cat > "$POLARIS_FAKE_CLAUDE_STDIN"
else
  cat >/dev/null
fi

if [ -n "${POLARIS_FAKE_CLAUDE_MARKER:-}" ]; then
  printf '%s\n' started > "$POLARIS_FAKE_CLAUDE_MARKER"
  # `wait` is interruptible; a trap installed around a foreground sleep is not,
  # because the shell defers the trap until sleep returns.
  trap 'printf "%s\n" killed > "$POLARIS_FAKE_CLAUDE_MARKER"; exit 0' TERM INT
fi

printf '%s\n' '{"type":"system","subtype":"init","session_id":"ses_fake"}'
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"fixed the login button","session_id":"ses_fake","usage":{"input_tokens":120,"output_tokens":45}}'

if [ -n "${POLARIS_FAKE_CLAUDE_HOLD:-}" ]; then
  sleep "$POLARIS_FAKE_CLAUDE_HOLD" &
  wait $!
fi

if [ -n "${POLARIS_FAKE_CLAUDE_MARKER:-}" ]; then
  printf '%s\n' exited > "$POLARIS_FAKE_CLAUDE_MARKER"
fi
