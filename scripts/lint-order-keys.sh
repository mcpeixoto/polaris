#!/usr/bin/env bash
# Refuses a linguistic comparison of a fractional order key.
#
# `position` and `sortOrder` are base-62 strings minted by services/internal/fractional over
# the alphabet 0-9A-Za-z. The columns are declared `text COLLATE "C"`, so Postgres orders
# them byte by byte, and that package's contract is that every reader does the same: the
# order a client computes while dragging, the order the server stores and the order the index
# hands back are one order only for as long as that holds.
#
# `String.prototype.localeCompare` is not that comparison. Under the ICU root collation
# letters sort by letter first and case second, so 'a' < 'V' — while byte order puts 'V'
# (0x56) before 'a' (0x61).
#
# The reason this needs a linter rather than a code review is that it is invisible in every
# fixture. `fractional.First()` is "V" and appending steps one digit at a time, so keys run
# V, W, X, Y, Z, a, b … : the first five entries sort identically under both rules and the
# SIXTH is the one that jumps. A fresh workspace has five project statuses; a fresh test has
# one or two saved views; CI has never built a list long enough to cross 'Z' to 'a'. It
# appears on somebody's sixth saved view, months in, and it never goes away.
#
# Fourteen call sites had it at once, written independently, every one of them reading
# perfectly. Use `compareOrderKeys` / `byOrderKey` / `byOrderKeyThen` from `~/store` instead.
set -euo pipefail

cd "$(dirname "$0")/.."

# Fields that hold a fractional key. Anything else — a name, a title, a display name — is
# prose and SHOULD be compared linguistically, which is exactly the mix that made the wrong
# call look right at each of those fourteen sites.
FIELDS='position|sortOrder'

hits=$(grep -rnE "\.(${FIELDS})\.localeCompare\(" web/src web/e2e 2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "Fractional order keys must be compared byte by byte, not linguistically." >&2
  echo "Use compareOrderKeys / byOrderKey / byOrderKeyThen from '~/store'." >&2
  echo >&2
  echo "$hits" >&2
  exit 1
fi

echo "order keys: no linguistic comparisons"
