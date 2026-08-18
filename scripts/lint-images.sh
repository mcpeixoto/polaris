#!/usr/bin/env bash
# Every binary a compose service asks for is one the image actually builds, and can be
# reached once it is there.
#
# services/Dockerfile ships four binaries — api, sync, worker, polarisctl — so that the three
# services and the migration tool can never disagree about a schema version. Selecting among
# them is `command:` in docker-compose.yml, and that only works if the image leaves the
# choice open.
#
# It did not. The Dockerfile ended `ENTRYPOINT ["/usr/local/bin/api"]`, and Docker APPENDS
# `command:` to an ENTRYPOINT rather than replacing it — so `command: ["/usr/local/bin/sync"]`
# ran `api /usr/local/bin/sync`, and api ignores arguments it does not know. Every service in
# the file started the API. The migrate service ran an API that never exits, so the
# `service_completed_successfully` gate on it was never satisfied, and api, sync and worker
# never started: `docker compose up` deadlocked on a container doing the wrong job, on any
# machine, for anyone.
#
# Nothing noticed for the life of the project, because nothing runs `docker compose up`
# except a person deploying, and nobody had.
#
# Two checks, then: the image must not pin an entrypoint that swallows the choice, and every
# binary a service names must exist.
set -euo pipefail

cd "$(dirname "$0")/.."

dockerfile=services/Dockerfile
compose=docker-compose.yml
fail=0

# 1. No ENTRYPOINT naming one of the shipped binaries.
#
# An ENTRYPOINT is not wrong in general — it is wrong for an image whose whole point is that
# it holds several programs. A wrapper entrypoint (tini, an exec shim) would be fine and is
# why this looks for the binary path rather than for the word.
if grep -qE '^\s*ENTRYPOINT.*\/usr\/local\/bin\/' "$dockerfile"; then
  echo "FAIL: $dockerfile pins an ENTRYPOINT to one of its own binaries:"
  grep -nE '^\s*ENTRYPOINT.*\/usr\/local\/bin\/' "$dockerfile" | sed 's/^/      /'
  echo "      Docker appends \`command:\` to an ENTRYPOINT instead of replacing it, so every"
  echo "      service in $compose would run that one binary whatever its command says."
  echo "      Use CMD: it is a default that \`command:\` replaces."
  fail=1
fi

# 2. Every /usr/local/bin/<name> a compose command names is built by the Dockerfile.
built=$(grep -oE '\-o /out/[a-z]+' "$dockerfile" | sed 's|.*/||' | sort -u)
if [ -z "$built" ]; then
  echo "FAIL: found no \`-o /out/<binary>\` build lines in $dockerfile; this check cannot be"
  echo "      passing for the right reason."
  exit 1
fi

wanted=$(grep -oE '/usr/local/bin/[a-z]+' "$compose" | sed 's|.*/||' | sort -u)
for binary in $wanted; do
  if ! echo "$built" | grep -qx "$binary"; then
    echo "FAIL: $compose runs /usr/local/bin/$binary and $dockerfile does not build it."
    echo "      The container would exit immediately with \"no such file or directory\"."
    fail=1
  fi
done

if [ $fail -eq 0 ]; then
  echo "image entrypoints: ok ($(echo "$built" | tr '\n' ' ' | sed 's/ $//'))"
fi
exit $fail
