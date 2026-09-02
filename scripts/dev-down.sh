#!/usr/bin/env bash
# Intentional teardown of the keep-alive stack started by scripts/dev-up.sh.
# Does NOT stop Docker. For migrate you should not run this — leave Vite up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.dev-pids"
STOPFILE="$ROOT/.dev-stop"

touch "$STOPFILE"

read_pid() {
  local key="$1"
  [ -f "$PIDFILE" ] || return 0
  awk -F= -v k="$key" '$1==k {print $2; exit}' "$PIDFILE"
}

kill_pid() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
}

# Supervisors honor SIGTERM only when the stop file exists.
for key in WATCHDOG VITE_SUPERVISOR API_SUPERVISOR SYNC_SUPERVISOR WORKER_SUPERVISOR VITE API SYNC WORKER; do
  kill_pid "$(read_pid "$key")"
done

for i in 1 2 3 4 5 6 7 8 9 10; do
  alive=0
  for key in WATCHDOG VITE_SUPERVISOR API_SUPERVISOR SYNC_SUPERVISOR WORKER_SUPERVISOR VITE API SYNC WORKER; do
    pid="$(read_pid "$key")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      alive=1
    fi
  done
  [ "$alive" -eq 0 ] && break
  sleep 0.2
done

for key in WATCHDOG VITE_SUPERVISOR API_SUPERVISOR SYNC_SUPERVISOR WORKER_SUPERVISOR VITE API SYNC WORKER; do
  pid="$(read_pid "$key")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
done

rm -f "$STOPFILE" "$PIDFILE"
echo "keep-alive stopped (Docker left running)"
