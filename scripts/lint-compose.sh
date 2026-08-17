#!/usr/bin/env bash
# Forbids a required-variable guard inside an opt-in compose service.
#
# Compose interpolates the entire file before it decides which profiles are active, so
# `${FOO:?message}` in a service behind `profiles:` fires for everybody — including people
# who never asked for that service. It is not a warning and it is not scoped: the command
# exits non-zero and does nothing.
#
# That bricked the default self-hosted install. `minio` (profile "s3") and `meilisearch`
# (profile "search") each guarded a password with `:?`, so `docker compose up` with no
# profile at all failed with "set S3_SECRET_KEY in .env" — as did `ps`, `logs` and `config`.
# The product could not be started by following its own instructions, and the error pointed
# at object storage, which this build does not even implement.
#
# The fix is `:-` plus a service that fails closed on its own: MinIO refuses to boot with a
# root password under eight characters, Meilisearch refuses to start in production without a
# master key. The enforcement survives and it happens when the service starts, which is when
# it is somebody's problem.
#
# A `:?` in a DEFAULT-profile service is correct and stays allowed — POSTGRES_PASSWORD is
# exactly that, and failing before it starts is much better than a database with no password.
#
# Text rather than `docker compose config`, on purpose: this has to run in CI, and CI here
# has no Docker. A check that quietly skips is a check that stops holding on the day it
# matters.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

for file in docker-compose*.yml; do
  [ -e "$file" ] || continue

  # Walk the services block, tracking whether the service we are inside is behind a profile.
  # Service keys are at exactly two spaces of indentation, which is this file's shape.
  awk -v file="$file" '
    /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ { service = $1; sub(/:$/, "", service); profiled = 0; next }
    /^  [a-zA-Z0-9_-]+:/              { service = $1; sub(/:$/, "", service); profiled = 0; next }
    /^    profiles:/                  { profiled = 1; next }
    /\$\{[A-Za-z_][A-Za-z0-9_]*:\?/ {
      if (profiled) {
        printf "FAIL: %s: service \"%s\" is behind a profile and uses a `:?` required-variable guard\n", file, service
        printf "      %s\n", $0
        printf "      Compose interpolates every service regardless of profile, so this fails for people who did not enable it.\n"
        bad = 1
      }
    }
    END { exit bad }
  ' "$file" || fail=1
done

if [ $fail -eq 0 ]; then
  echo "compose profiles: ok"
fi
exit $fail
