#!/usr/bin/env bash
# Keep-alive launcher for the local Polaris stack.
#
#   Vite    http://localhost:5173/  and  http://127.0.0.1:5173/
#   API     http://127.0.0.1:8088/healthz
#   sync    :8089
#   worker  no port — background jobs
#
# The worker is part of the stack, not an extra. Inbox rows are not written by
# the mutation that causes them: domain.FanOutAll reads the change stream on a
# ticker in cmd/worker and nothing else calls it, so without this process the
# inbox, the unread badge and every notification setting are inert. That used to
# be the difference between a `make dev` stack and CI, which does start it — so
# the Playwright inbox specs passed there and failed here, silently, every time.
#
# Processes are daemonized into their own session (setsid) so they survive the
# agent terminal that started them. Each service runs under a supervisor that
# respawns on crash. A 10s watchdog brings Vite back if :5173 is dead, and
# restarts API/sync the same way if those ports die. The worker listens on
# nothing, so its watchdog check is its supervisor being alive.
#
# Do NOT SIGTERM these PIDs during migrate. Migrations talk to Postgres only;
# they do not need Vite, the API, or sync to stop. Restart the API by replacing
# the binary (/tmp/polaris-api) and running `scripts/dev-up.sh respawn-api` —
# never by killing Vite. `make stack` does that rebuild+respawn when keep-alive
# is already running. Intentional teardown: `scripts/dev-down.sh` / `make dev-down`.
#
# PIDs:  .dev-pids
# Logs:  .dev-logs/*.log

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export POLARIS_ROOT="$ROOT"

PIDFILE="$ROOT/.dev-pids"
STOPFILE="$ROOT/.dev-stop"
LOGDIR="$ROOT/.dev-logs"
BIN_API="${POLARIS_API_BIN:-/tmp/polaris-api}"
BIN_SYNC="${POLARIS_SYNC_BIN:-/tmp/polaris-sync}"
BIN_WORKER="${POLARIS_WORKER_BIN:-/tmp/polaris-worker}"

mkdir -p "$LOGDIR"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

DB_URL="${DATABASE_URL:-postgres://polaris:polaris@localhost:55432/polaris?sslmode=disable}"
export DATABASE_URL="$DB_URL"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*"; }

compile_in_flight() {
  pgrep -f 'go build .*/cmd/api|go build .*/cmd/sync|go build .*/cmd/worker|go build -o /tmp/polaris-api|go build -o /tmp/polaris-sync|go build -o /tmp/polaris-worker' >/dev/null 2>&1
}

wait_for_compile() {
  local n=0
  while compile_in_flight; do
    if [ "$n" -eq 0 ]; then
      log "go build of api/sync/worker already in flight — waiting rather than interrupting"
    fi
    n=$((n + 1))
    if [ "$n" -gt 90 ]; then
      log "timed out waiting for in-flight compile"
      return 1
    fi
    sleep 2
  done
}

pid_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  local key="$1"
  [ -f "$PIDFILE" ] || return 0
  awk -F= -v k="$key" '$1==k {print $2; exit}' "$PIDFILE"
}

write_pid() {
  local key="$1" val="$2"
  python3 - "$PIDFILE" "$key" "$val" <<'PY'
import pathlib, sys
path, key, val = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = path.read_text().splitlines() if path.exists() else []
out, found = [], False
for line in lines:
    if line.startswith("#") or not line.strip():
        out.append(line)
        continue
    name, _, _ = line.partition("=")
    if name == key:
        out.append(f"{key}={val}")
        found = True
    else:
        out.append(line)
if not found:
    if not any(l.startswith("#") for l in out):
        out.insert(0, "# Polaris keep-alive PIDs. Do NOT SIGTERM during migrate; use scripts/dev-down.sh.")
    out.append(f"{key}={val}")
path.write_text("\n".join(out) + "\n")
PY
}

port_up() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

http_ok() {
  local url="$1"
  curl -sf --max-time 2 -o /dev/null "$url"
}

# Daemonize: fork + setsid so SIGTERM of the calling agent session cannot
# reach the supervisor. Prints the new PID on stdout.
daemonize() {
  local logf="$1"
  shift
  POLARIS_ROOT="$ROOT" python3 - "$logf" "$@" <<'PY'
import os, sys
log, *argv = sys.argv[1:]
pid = os.fork()
if pid > 0:
    print(pid)
    raise SystemExit(0)
os.setsid()
os.umask(0)
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(fd, 1)
os.dup2(fd, 2)
os.close(fd)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
os.close(devnull)
os.chdir(os.environ.get("POLARIS_ROOT", "/"))
os.execvp(argv[0], argv)
PY
}

ensure_infra() {
  if ! lsof -nP -iTCP:55432 -sTCP:LISTEN >/dev/null 2>&1; then
    log "postgres :55432 is down — starting compose.dev (will not kill existing Docker)"
    docker compose -f "$ROOT/compose.dev.yml" up -d --wait
  fi
}

ensure_binaries() {
  wait_for_compile
  local need=0
  if [ ! -x "$BIN_API" ] || [ ! -x "$BIN_SYNC" ] || [ ! -x "$BIN_WORKER" ]; then
    need=1
  fi
  if [ "$need" -eq 1 ]; then
    log "building api, sync and worker…"
    (cd "$ROOT/services" && go build -o "$BIN_API" ./cmd/api)
    (cd "$ROOT/services" && go build -o "$BIN_SYNC" ./cmd/sync)
    (cd "$ROOT/services" && go build -o "$BIN_WORKER" ./cmd/worker)
  fi
}

# --- supervisor loops (run inside a daemonized session) -------------------

supervise_loop() {
  local name="$1"
  shift
  # Accidental SIGTERM (agent teardown, migrate wrappers) is ignored.
  # Intentional stop is .dev-stop, which makes us exit and not restart.
  trap 'if [ -f "$STOPFILE" ]; then exit 0; fi' TERM INT HUP
  log "supervisor $name starting (pid $$)"
  write_pid "${name}_SUPERVISOR" "$$"
  while [ ! -f "$STOPFILE" ]; do
    log "supervisor $name spawning: $*"
    "$@" &
    local child=$!
    write_pid "$name" "$child"
    set +e
    wait "$child"
    local code=$?
    set -e
    write_pid "$name" ""
    if [ -f "$STOPFILE" ]; then
      log "supervisor $name saw stop file; exiting"
      exit 0
    fi
    log "supervisor $name: child exited $code; respawning in 1s"
    sleep 1
  done
}

cmd_supervise_vite() {
  supervise_loop VITE pnpm -C "$ROOT/web" dev
}

cmd_supervise_api() {
  wait_for_compile
  supervise_loop API "$BIN_API"
}

cmd_supervise_sync() {
  wait_for_compile
  supervise_loop SYNC "$BIN_SYNC"
}

cmd_supervise_worker() {
  wait_for_compile
  supervise_loop WORKER "$BIN_WORKER"
}

ensure_supervisor() {
  local name="$1" sub="$2" logf="$3"
  local sup
  sup="$(read_pid "${name}_SUPERVISOR")"
  if pid_alive "$sup"; then
    return 0
  fi
  local pid
  pid="$(daemonize "$logf" /bin/bash "$ROOT/scripts/dev-up.sh" "$sub")"
  write_pid "${name}_SUPERVISOR" "$pid"
  log "started $name supervisor pid=$pid"
}

cmd_watchdog() {
  trap 'if [ -f "$STOPFILE" ]; then exit 0; fi' TERM INT HUP
  write_pid WATCHDOG "$$"
  log "watchdog starting (pid $$); checking :5173 every 10s"
  while [ ! -f "$STOPFILE" ]; do
    sleep 10
    [ -f "$STOPFILE" ] && exit 0
    if ! http_ok "http://127.0.0.1:5173/" && ! http_ok "http://localhost:5173/"; then
      log "watchdog: :5173 is dead — respawning Vite (not touching Docker, not SIGTERM-ing API)"
      # Drop a leftover listener so the new child can bind, then ensure supervisor.
      local leftover
      leftover="$(lsof -nP -tiTCP:5173 -sTCP:LISTEN 2>/dev/null || true)"
      if [ -n "$leftover" ]; then
        # Kill only the listener; supervisor loop will start a fresh one.
        kill $leftover 2>/dev/null || true
      fi
      ensure_supervisor VITE supervise-vite "$LOGDIR/vite.log"
    fi
    if ! http_ok "http://127.0.0.1:8088/healthz"; then
      if compile_in_flight; then
        log "watchdog: :8088 down but go build in flight — waiting"
        continue
      fi
      log "watchdog: :8088 is dead — respawning API"
      ensure_supervisor API supervise-api "$LOGDIR/api.log"
    fi
    if ! port_up 8089; then
      if compile_in_flight; then
        log "watchdog: :8089 down but go build in flight — waiting"
        continue
      fi
      log "watchdog: :8089 is dead — respawning sync"
      ensure_supervisor SYNC supervise-sync "$LOGDIR/sync.log"
    fi
    # The worker binds no port, so there is nothing to probe: its liveness is its
    # supervisor. A crashing child is the supervisor's job; this catches the
    # supervisor itself being gone (kill -9, a lost session), which is the case
    # where the inbox quietly stops filling and nothing on screen says so.
    if ! pid_alive "$(read_pid WORKER_SUPERVISOR)"; then
      if compile_in_flight; then
        log "watchdog: worker down but go build in flight — waiting"
        continue
      fi
      log "watchdog: worker supervisor is dead — respawning worker"
      ensure_supervisor WORKER supervise-worker "$LOGDIR/worker.log"
    fi
  done
}

ensure_watchdog() {
  local wd
  wd="$(read_pid WATCHDOG)"
  if pid_alive "$wd"; then
    return 0
  fi
  local pid
  pid="$(daemonize "$LOGDIR/watchdog.log" /bin/bash "$ROOT/scripts/dev-up.sh" watchdog)"
  write_pid WATCHDOG "$pid"
  log "started watchdog pid=$pid"
}

kill_child_only() {
  local key="$1"
  local pid
  pid="$(read_pid "$key")"
  if pid_alive "$pid"; then
    log "respawning $key child pid=$pid (supervisor stays; Vite is not touched)"
    kill "$pid" 2>/dev/null || true
  fi
}

cmd_respawn_api() {
  kill_child_only API
}

# Every Go process the stack owns, replaced from the binaries on disk. The worker
# is in here for the same reason it is in `up`: a rebuild that leaves it running
# the previous binary is a stack that is not the code you just wrote.
cmd_respawn_services() {
  kill_child_only API
  kill_child_only SYNC
  kill_child_only WORKER
}

wait_healthy() {
  local i
  for i in $(seq 1 60); do
    # The worker answers no request, so "healthy" for it is a running child. It is
    # checked here rather than assumed: a worker that crash-loops on boot leaves a
    # stack where everything looks up and no notification ever arrives.
    if http_ok "http://127.0.0.1:5173/" \
      && http_ok "http://localhost:5173/" \
      && http_ok "http://127.0.0.1:8088/healthz" \
      && pid_alive "$(read_pid WORKER)"; then
      return 0
    fi
    sleep 1
  done
  log "stack did not become healthy in 60s — see $LOGDIR"
  return 1
}

cmd_up() {
  rm -f "$STOPFILE"
  ensure_infra
  ensure_binaries
  ensure_supervisor VITE supervise-vite "$LOGDIR/vite.log"
  ensure_supervisor API supervise-api "$LOGDIR/api.log"
  ensure_supervisor SYNC supervise-sync "$LOGDIR/sync.log"
  ensure_supervisor WORKER supervise-worker "$LOGDIR/worker.log"
  ensure_watchdog
  wait_healthy
  log "stack up"
  echo
  echo "  Vite    http://localhost:5173/   http://127.0.0.1:5173/"
  echo "  API     http://127.0.0.1:8088/healthz"
  echo "  sync    :8089"
  echo "  worker  no port — notifications, cycles, digests, webhooks"
  echo "  PIDs    $PIDFILE"
  echo "  logs    $LOGDIR/"
  echo "  login   dev@polaris.local / polaris-dev-password"
  echo
  echo "  Keep-alive: supervisors ignore SIGTERM unless $STOPFILE exists."
  echo "  Migrate without killing anything. Restart API: make stack (rebuild + respawn-api)."
}

cmd_status() {
  echo "PID file: $PIDFILE"
  [ -f "$PIDFILE" ] && cat "$PIDFILE"
  echo
  printf "5173 "; http_ok "http://127.0.0.1:5173/" && echo ok || echo down
  printf "8088 "; http_ok "http://127.0.0.1:8088/healthz" && echo ok || echo down
  printf "8089 "; port_up 8089 && echo listen || echo down
  printf "worker "; pid_alive "$(read_pid WORKER)" && echo running || echo down
}

# Exit 0 if this keep-alive stack still owns the processes (Makefile uses this
# so `make stack` / `make stack-stop` do not SIGTERM Vite).
cmd_keepalive_running() {
  local key pid
  for key in WATCHDOG VITE_SUPERVISOR API_SUPERVISOR SYNC_SUPERVISOR WORKER_SUPERVISOR; do
    pid="$(read_pid "$key")"
    if pid_alive "$pid"; then
      exit 0
    fi
  done
  exit 1
}

case "${1:-up}" in
  up) cmd_up ;;
  status) cmd_status ;;
  keepalive-running) cmd_keepalive_running ;;
  watchdog) cmd_watchdog ;;
  supervise-vite) cmd_supervise_vite ;;
  supervise-api) cmd_supervise_api ;;
  supervise-sync) cmd_supervise_sync ;;
  supervise-worker) cmd_supervise_worker ;;
  respawn-api) cmd_respawn_api ;;
  # respawn-api-sync is the old name, kept so an older Makefile or a shell someone
  # still has open keeps working; it does what respawn-services does.
  respawn-services | respawn-api-sync) cmd_respawn_services ;;
  *)
    echo "usage: $0 [up|status|keepalive-running|respawn-api|respawn-services]" >&2
    exit 2
    ;;
esac
