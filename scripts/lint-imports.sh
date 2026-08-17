#!/usr/bin/env bash
# Enforces the package rule from docs/05-infrastructure/02-repo-and-stack.md:
#
#   Only domain/ (and store/ itself) may import store/. Everything else — graph/, syncsrv/,
#   jobs/, integrations/, oauth/, webhookout/, and anything added later — goes through
#   domain/.
#
# This is what keeps API parity honest: if resolvers could reach the database directly, a
# mutation would eventually skip the change_log and the sync stream would lie.
#
# The check is a DENYLIST of everything except the two allowed packages, not an allowlist of
# packages to police. It used to be the latter — a fixed list of six directories — which
# enforced the rule for the packages that existed when it was written and silently exempted
# every package added afterwards. A rule stated as universal and checked selectively is worse
# than no rule, because it reads as covered.
set -euo pipefail

cd "$(dirname "$0")/.."

MODULE="github.com/peixotolabs/polaris/services"
STORE_PKG="${MODULE}/internal/store"

# The two that may. testutil is here because its whole job is handing a *store.DB to tests.
ALLOWED=(domain store testutil)

fail=0

for dir in services/internal/*/; do
  pkg=$(basename "$dir")

  skip=0
  for allowed in "${ALLOWED[@]}"; do
    [ "$pkg" = "$allowed" ] && skip=1
  done
  [ $skip -eq 1 ] && continue

  # Generated files are exempt: gqlgen writes its own imports and never reaches for store.
  hits=$(grep -rn --include='*.go' "\"${STORE_PKG}" "$dir" 2>/dev/null \
          | grep -v '_test.go' \
          | grep -v 'generated' || true)

  if [ -n "$hits" ]; then
    echo "FAIL: internal/${pkg} imports internal/store — must go through internal/domain"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

# cmd/ is the composition root and is allowed to wire a pool, but it must not run queries:
# a query here is a mutation that never reached the change_log, which is the same bug the
# rule above prevents, arriving through the back door.
for dir in services/cmd/*/; do
  hits=$(grep -rn --include='*.go' 'store\.\(New\)\?Queries\|q\.\(Create\|Update\|Delete\|Append\)' "$dir" 2>/dev/null \
          | grep -v '_test.go' || true)
  if [ -n "$hits" ]; then
    echo "FAIL: $(basename "$dir") runs queries directly — cmd/ wires, domain/ writes"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

if [ $fail -eq 0 ]; then
  echo "import-lint: ok"
fi
exit $fail
