#!/usr/bin/env bash
# Checks the reverse proxy against the routes the servers actually register.
#
# There are two HTTP servers behind one hostname — the API on :8088 and the sync hub on
# :8089 — and Caddy decides which one a path reaches. Nothing else in the build looks at
# both sides of that decision: the Go code compiles whatever it registers, the Caddyfile is
# not code at all, and every test in the suite talks to a handler directly rather than
# through a proxy. So a path can be registered on one server and routed to the other, and
# the entire test suite stays green.
#
# That is not hypothetical. `handle /sync*` sent `/sync/bootstrap` to the sync process,
# whose mux has `GET /healthz` and an exact-match `GET /sync` and nothing else. Every
# self-hosted install using the bundled Caddyfile got a 404 on its bootstrap. The failure
# mode is the worst available: the socket connects, the client reports itself online, and
# the workspace is simply empty — so it reads as "the product does not work" rather than as
# "one route is misconfigured".
#
# The check is deliberately crude — grep the registrations, grep the proxy, compare. A
# parser for either language would be more precise and would be the thing that rots. What
# matters is that both sides are read from source rather than from anybody's memory.
set -euo pipefail

cd "$(dirname "$0")/.."

CADDYFILE="Caddyfile"
API_UPSTREAM="api:8088"
SYNC_UPSTREAM="sync:8089"

fail=0

# Every path the API mux registers, and every path the sync mux registers. Both are
# `mux.Handle`/`mux.HandleFunc` with a "METHOD /path" pattern, which is the Go 1.22 form
# this codebase uses everywhere.
routes_of() {
  grep -hoE 'mux\.Handle(Func)?\("[A-Z]+ [^"]+"' "$@" 2>/dev/null |
    sed -E 's/.*"[A-Z]+ ([^"]+)"/\1/' | sort -u
}

api_routes=$(routes_of services/internal/httpapi/router.go)
sync_routes=$(routes_of services/cmd/sync/main.go)

# Which upstream the Caddyfile sends a path to.
#
# `handle` blocks are mutually exclusive and are matched in source order, so the first
# block whose pattern matches wins — which is exactly the property the bug above violated,
# and therefore the property this has to model rather than ignore.
upstream_for() {
  local path="$1" pattern upstream
  local current=""

  while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*handle[[:space:]]+([^[:space:]]+)[[:space:]]*\{ ]]; then
      current="${BASH_REMATCH[1]}"
      continue
    fi
    if [[ $line =~ ^[[:space:]]*handle[[:space:]]*\{ ]]; then
      current="/*"
      continue
    fi
    if [[ $line =~ ^[[:space:]]*reverse_proxy[[:space:]]+([^[:space:]]+) ]]; then
      upstream="${BASH_REMATCH[1]}"
      pattern="$current"
      # Caddy's `*` is a suffix wildcard in these patterns; without one the match is exact.
      if [[ $pattern == *"*" ]]; then
        # shellcheck disable=SC2295
        [[ $path == ${pattern%\*}* ]] && { echo "$upstream"; return 0; }
      elif [[ $path == "$pattern" ]]; then
        echo "$upstream"
        return 0
      fi
    fi
  done <"$CADDYFILE"

  echo "NONE"
}

check() {
  local path="$1" want="$2" server="$3" got
  # Health endpoints are per-process and are reached inside the compose network rather
  # than through the proxy, so the proxy has no opinion about them and should not.
  [[ $path == "/healthz" || $path == "/readyz" ]] && return 0

  # The API registers GET /sync too, but only when it is handed a sync handler — which is
  # the single-process development setup, where there is no proxy at all. In the deployed
  # topology the socket belongs to the sync hub, so this registration must not drag it
  # away. Exempted explicitly, and asserted positively at the bottom of this file, rather
  # than left to the sync loop happening to agree.
  [[ $path == "/sync" && $server == "the api" ]] && return 0

  got=$(upstream_for "$path")
  if [[ $got != "$want" ]]; then
    echo "FAIL: ${server} registers ${path}, and ${CADDYFILE} routes it to ${got} (want ${want})"
    fail=1
  fi
}

while IFS= read -r path; do
  [ -n "$path" ] && check "$path" "$API_UPSTREAM" "the api"
done <<<"$api_routes"

while IFS= read -r path; do
  [ -n "$path" ] && check "$path" "$SYNC_UPSTREAM" "the sync hub"
done <<<"$sync_routes"

# The API also registers GET /sync when it is given a sync handler, which is how the
# single-process development setup works. That is a real registration and it must NOT drag
# the socket away from the sync process in the deployed topology, so it is exempted here on
# purpose rather than by the loop above happening not to see it.
if [ "$(upstream_for /sync)" != "$SYNC_UPSTREAM" ]; then
  echo "FAIL: ${CADDYFILE} must route /sync to ${SYNC_UPSTREAM} — the socket belongs to the sync hub"
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "route parity: ok"
fi
exit $fail
