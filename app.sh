#!/usr/bin/env bash
# Polaris service control.
#
# The house entrypoint for bringing the stack up and down on a box, matching the
# convention the other services on the fleet use so that muscle memory transfers.
#
# An override file is applied automatically when present:
#
#   docker-compose.fleet.yml   private, gitignored. Removes the published ports and the
#                              bundled proxy because the fleet has its own ingress.
#
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILES=(-f docker-compose.yml)
[ -f docker-compose.fleet.yml ] && COMPOSE_FILES+=(-f docker-compose.fleet.yml)

# Start order matters: datastores, then migrations, then the services that assume a
# migrated schema. compose's depends_on covers this, but naming it here makes `logs` and
# `restart` predictable too.
ORDER=(postgres cache migrate api sync worker web caddy)

compose() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

usage() {
  cat <<'EOF'
usage: ./app.sh <command> [service]

  start [service]     start everything, or one service
  stop [service]      stop everything, or one service
  restart [service]   restart, in dependency order
  status              what is running, and its health
  logs [service]      follow logs
  migrate             apply pending migrations
  seed [scale]        seed a realistic workspace (small | large)
  shell               a psql session on the database
  backup              dump the database to ./backups
  build               rebuild images
  pull                pull base images
EOF
}

require_env() {
  if [ ! -f .env ]; then
    echo "error: no .env — copy .env.example and fill it in" >&2
    exit 1
  fi
  # A default JWT secret in production means anybody who has read the repository can mint
  # a token for any account. Refuse to start rather than warn: a warning in a startup log
  # is a warning nobody reads.
  if grep -qE '^POLARIS_JWT_SECRET=dev-only' .env; then
    echo "error: POLARIS_JWT_SECRET is still the example value" >&2
    echo "       generate one with: openssl rand -base64 48" >&2
    exit 1
  fi
  if grep -qE '^POSTGRES_PASSWORD=$' .env; then
    echo "error: POSTGRES_PASSWORD is empty in .env" >&2
    exit 1
  fi
}

cmd="${1:-}"
svc="${2:-}"

case "$cmd" in
  start)
    require_env
    if [ -n "$svc" ]; then
      compose up -d "$svc"
    else
      compose up -d --wait
    fi
    compose ps
    ;;

  stop)
    if [ -n "$svc" ]; then compose stop "$svc"; else compose down; fi
    ;;

  restart)
    require_env
    if [ -n "$svc" ]; then
      compose restart "$svc"
    else
      for s in "${ORDER[@]}"; do
        compose restart "$s" 2>/dev/null || true
      done
    fi
    compose ps
    ;;

  status)
    compose ps
    ;;

  logs)
    if [ -n "$svc" ]; then compose logs -f --tail=200 "$svc"; else compose logs -f --tail=200; fi
    ;;

  migrate)
    require_env
    compose run --rm migrate
    ;;

  seed)
    require_env
    compose run --rm --entrypoint /usr/local/bin/polarisctl api seed --scale="${svc:-small}"
    ;;

  shell)
    compose exec postgres psql -U polaris -d polaris
    ;;

  backup)
    mkdir -p backups
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    # Custom format, not plain SQL: it restores selectively and in parallel, which is what
    # you want at 3am when only one table is wrong.
    compose exec -T postgres pg_dump -U polaris -d polaris -Fc \
      > "backups/polaris-${stamp}.dump"
    echo "wrote backups/polaris-${stamp}.dump"
    # A backup nobody prunes fills the disk, and a full disk takes the database with it.
    find backups -name 'polaris-*.dump' -mtime +30 -delete
    ;;

  build)
    compose build --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    ;;

  pull)
    compose pull
    ;;

  *)
    usage
    exit 1
    ;;
esac
